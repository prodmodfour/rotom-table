import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseCampaignClockV1 } from '#shared/campaignClock'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import {
  BREEDING_EGG_READY_CORRECTION_REASON_IDS,
  parseBreedingEggReadyCorrectionProjectionV1,
  type BreedingEggReadyCorrectionProjectionV1,
  type BreedingEggReadyCorrectionReasonId,
} from '#shared/breeding/readinessCorrection'
import type { PokemonEggDocumentV1 } from '#shared/breeding/egg'
import { validatePokemonEggRevisionSuccessor } from './eggLifecycle'
import { parseAuthoritativePokemonEggDocumentV1 } from './lineage'

export const BREEDING_READINESS_CORRECTION_PROVIDER_ID = 'breeding-egg-readiness-correction-v1' as const
export const BREEDING_READINESS_CORRECTION_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-egg-readiness-correction-v1' as const,
  commandKind: 'mark-egg-ready' as const,
  authority: 'authenticated-gm-plus-command-bound-operation-recovery-override' as const,
  reasonIds: BREEDING_EGG_READY_CORRECTION_REASON_IDS,
  sourceStatus: 'incubating' as const,
  targetStatus: 'ready' as const,
  readinessKind: 'gm-mark-ready' as const,
  correctionTime: 'current-campaign-clock-minute' as const,
  progressMutation: 'forbidden' as const,
  targetMutation: 'forbidden' as const,
  clockCheckpointMutation: 'forbidden' as const,
  pausedEggPolicy: 'explicit-resume-required' as const,
  reverseCorrection: 'unavailable' as const,
  directFieldEditing: 'forbidden' as const,
})

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
export const BREEDING_READINESS_CORRECTION_POLICY_DEFINITION_SHA256 = sha256(
  BREEDING_READINESS_CORRECTION_POLICY_DEFINITION,
)
export const BREEDING_READINESS_CORRECTION_EVIDENCE_DEFINITION_SHA256 = sha256({
  schemaVersion: 1,
  providerId: BREEDING_READINESS_CORRECTION_PROVIDER_ID,
  policyDefinitionSha256: BREEDING_READINESS_CORRECTION_POLICY_DEFINITION_SHA256,
})

export type BreedingReadinessCorrectionAuthorityErrorCode =
  | 'breeding.readiness-correction.invalid-authority'
  | 'breeding.readiness-correction.stale-authority'
  | 'breeding.readiness-correction.unavailable'
  | 'breeding.readiness-correction.wrong-command'

export class BreedingReadinessCorrectionAuthorityError extends Error {
  readonly code: BreedingReadinessCorrectionAuthorityErrorCode
  readonly path: string

  constructor(code: BreedingReadinessCorrectionAuthorityErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingReadinessCorrectionAuthorityError'
    this.code = code
    this.path = path
  }
}

const fail = (
  code: BreedingReadinessCorrectionAuthorityErrorCode,
  path: string,
  message: string,
): never => { throw new BreedingReadinessCorrectionAuthorityError(code, path, message) }
const validReason = (value: string): value is BreedingEggReadyCorrectionReasonId => (
  BREEDING_EGG_READY_CORRECTION_REASON_IDS.includes(
    value as BreedingEggReadyCorrectionReasonId,
  )
)

export const planBreedingEggReadinessCorrectionV1 = (input: {
  readonly egg: unknown
  readonly command: unknown
  readonly campaignClock: unknown
}): PokemonEggDocumentV1 => {
  const egg = parseAuthoritativePokemonEggDocumentV1(input.egg)
  const command = parseBreedingOperationCommandV1(input.command)
  const clock = parseCampaignClockV1(input.campaignClock)
  if (command.commandKind !== 'mark-egg-ready') {
    return fail('breeding.readiness-correction.wrong-command', 'command.commandKind', 'must be mark-egg-ready.')
  }
  const scope = command.scopes[0]
  if (scope?.kind !== 'pokemon-egg' || scope.eggId !== egg.eggId
    || scope.expectedRevision !== egg.revision || command.payload.eggId !== egg.eggId
    || command.ruleset.rulesetId !== egg.ruleset.rulesetId
    || command.ruleset.definitionSha256 !== egg.ruleset.definitionSha256) {
    return fail(
      'breeding.readiness-correction.stale-authority',
      'command',
      'must bind the exact current Egg revision, identity, and ruleset.',
    )
  }
  if (!validReason(command.payload.reasonId)) {
    return fail(
      'breeding.readiness-correction.invalid-authority',
      'command.payload.reasonId',
      'must be one closed readiness correction reason.',
    )
  }
  if (egg.status !== 'incubating' || egg.incubation.readinessKind !== null) {
    return fail(
      'breeding.readiness-correction.unavailable',
      'egg.status',
      'only an incubating not-ready Egg can receive its first readiness correction.',
    )
  }
  if (egg.incubation.paused) {
    return fail(
      'breeding.readiness-correction.unavailable',
      'egg.incubation.paused',
      'a paused Egg must be explicitly resumed before readiness correction.',
    )
  }
  if (clock.revision < egg.incubation.lastAppliedClockRevision
    || clock.campaignMinute < egg.incubation.lastAppliedClockMinute
    || clock.campaignMinute < egg.updatedAtCampaignMinute
    || (clock.revision === egg.incubation.lastAppliedClockRevision
      && clock.campaignMinute !== egg.incubation.lastAppliedClockMinute)
    || (clock.revision > egg.incubation.lastAppliedClockRevision
      && clock.campaignMinute <= egg.incubation.lastAppliedClockMinute)) {
    return fail(
      'breeding.readiness-correction.stale-authority',
      'campaignClock',
      'must be the exact current campaign clock at or after the durable Egg checkpoint.',
    )
  }
  return validatePokemonEggRevisionSuccessor(egg, {
    ...egg,
    revision: egg.revision + 1,
    status: 'ready',
    incubation: {
      ...egg.incubation,
      readyAtCampaignMinute: clock.campaignMinute,
      readinessKind: 'gm-mark-ready',
      readyOperationId: command.operationId,
    },
    updatedAtCampaignMinute: clock.campaignMinute,
    statusChangedAtCampaignMinute: clock.campaignMinute,
    lastOperationId: command.operationId,
  })
}

export const projectBreedingEggReadinessCorrectionV1 = (input: {
  readonly egg: unknown
  readonly operationId: string
  readonly acceptedEggRevision: number
  readonly reasonId: string
  readonly committedAtCampaignMinute: number
}): BreedingEggReadyCorrectionProjectionV1 => {
  const egg = parseAuthoritativePokemonEggDocumentV1(input.egg)
  if (egg.incubation.readinessKind !== 'gm-mark-ready'
    || egg.incubation.readyOperationId !== input.operationId
    || egg.incubation.readyAtCampaignMinute !== input.committedAtCampaignMinute
    || !validReason(input.reasonId)) {
    return fail(
      'breeding.readiness-correction.invalid-authority',
      'egg.incubation',
      'must retain the exact accepted GM readiness correction.',
    )
  }
  return parseBreedingEggReadyCorrectionProjectionV1({
    schemaVersion: 1,
    audience: 'gm',
    operationId: input.operationId,
    eggId: egg.eggId,
    acceptedEggRevision: input.acceptedEggRevision,
    currentEggRevision: egg.revision,
    currentStatus: egg.status,
    reasonId: input.reasonId,
    readinessKind: 'gm-mark-ready',
    readyAtCampaignMinute: egg.incubation.readyAtCampaignMinute,
    targetCampaignMinutes: egg.incubation.targetCampaignMinutes,
    accumulatedCampaignMinutes: egg.incubation.accumulatedCampaignMinutes,
    committedAtCampaignMinute: input.committedAtCampaignMinute,
  })
}

export const breedingReadinessCorrectionDefinitionSha256 = sha256
