import { createHash } from 'node:crypto'
import hatchDurationPolicyJson from '../../../data/breeding-automation/hatch-duration-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_INCUBATION_PAUSE_REASON_IDS,
  parseBreedingIncubationModifierContributionsV1,
  parseBreedingIncubationProgressProjectionV1,
  parseBreedingIncubationSegmentResultV1,
  type BreedingIncubationModifierContributionV1,
  type BreedingIncubationProgressProjectionV1,
  type BreedingIncubationSegmentResultV1,
} from '#shared/breeding/incubation'
import { parsePokemonEggDocumentV1, type PokemonEggDocumentV1 } from '#shared/breeding/egg'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { BreedingDependencyEvidenceV1 } from '#shared/breeding/readSets'
import { validatePokemonEggRevisionSuccessor } from './eggLifecycle'
import { BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256 } from './eggRuleHelpers'
import { pokemonEggDocumentDefinitionSha256 } from './lineage'
import {
  BREEDING_EGG_WARMER_ITEM_PROVIDER_ID,
  parseAuthoritativeBreedingModifierProviderHandoffV1,
} from './modifierProviderHandoff'

export const BREEDING_INCUBATION_BASE_RATE_PROVIDER_ID = 'breeding-incubation-base-rate-v1' as const
export const BREEDING_INCUBATION_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-incubation-v1' as const,
  hatchDurationPolicyDefinitionSha256: BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256,
  timeAuthority: 'campaign-clock-only' as const,
  progress: 'clamp-zero-through-frozen-target' as const,
  overflow: 'operation-result-only' as const,
  transferPolicy: 'continues' as const,
  storagePolicy: 'continues' as const,
  parentOrBreederLossPolicy: 'continues' as const,
  pausePolicy: 'explicit-audited-operation-only' as const,
  pauseReasonIds: BREEDING_INCUBATION_PAUSE_REASON_IDS,
  modifierCheckpoints: Object.freeze(['snapshot', 'continuous', 'operation'] as const),
  modifierMode: 'base-rate-or-authoritative-continuous-rate' as const,
  integrationGates: Object.freeze({
    featureAndFacilityReducers: false,
    itemAbilityCapabilityMoveNatureAndOverrideReducers: true,
  }),
  activeModifierPolicies: Object.freeze({
    eggWarmerItem: Object.freeze({ checkpoint: 'campaign-clock-segment', capacity: 4, progressRateNumerator: 2, progressRateDenominator: 1 }),
    eggWarmerCapability: Object.freeze({ checkpoint: 'incubation-operation', effect: 'one-time-target-reduction', reducerOwner: 'br-062-capability-operation' }),
  }),
})

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

export const BREEDING_INCUBATION_POLICY_DEFINITION_SHA256 = sha256(BREEDING_INCUBATION_POLICY_DEFINITION)
export const BREEDING_INCUBATION_BASE_RATE_EVIDENCE_DEFINITION_SHA256 = sha256({
  schemaVersion: 1,
  providerId: BREEDING_INCUBATION_BASE_RATE_PROVIDER_ID,
  policyDefinitionSha256: BREEDING_INCUBATION_POLICY_DEFINITION_SHA256,
  modifierContributions: [],
})

export type BreedingIncubationAuthorityErrorCode =
  | 'breeding.incubation.hash-mismatch'
  | 'breeding.incubation.invalid-authority'
  | 'breeding.incubation.stale-authority'
  | 'breeding.incubation.unavailable'
  | 'breeding.incubation.unsupported-provider'
  | 'breeding.incubation.wrong-command'

export class BreedingIncubationAuthorityError extends Error {
  readonly code: BreedingIncubationAuthorityErrorCode
  readonly path: string

  constructor(code: BreedingIncubationAuthorityErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingIncubationAuthorityError'
    this.code = code
    this.path = path
  }
}

const fail = (code: BreedingIncubationAuthorityErrorCode, path: string, message: string): never => {
  throw new BreedingIncubationAuthorityError(code, path, message)
}
const withoutHash = <Value extends { readonly definitionSha256: string }>(
  value: Value,
): Omit<Value, 'definitionSha256'> => {
  const { definitionSha256: _definitionSha256, ...definition } = value
  return definition
}

export const parseAuthoritativeBreedingIncubationModifierContributionsV1 = (
  value: unknown,
): readonly BreedingIncubationModifierContributionV1[] => {
  const contributions = parseBreedingIncubationModifierContributionsV1(value)
  for (let index = 0; index < contributions.length; index += 1) {
    const contribution = contributions[index]!
    if (sha256(withoutHash(contribution)) !== contribution.definitionSha256) {
      return fail('breeding.incubation.hash-mismatch', `modifierContributions[${index}].definitionSha256`, 'must match the exact server-owned contribution.')
    }
  }
  return contributions
}

export interface ResolvedBreedingIncubationModifierContributionsV1 {
  readonly contributions: readonly BreedingIncubationModifierContributionV1[]
  readonly dependencyEvidence: readonly BreedingDependencyEvidenceV1[]
  readonly rateNumerator: 1 | 2
  readonly rateDenominator: 1
  readonly modifierMode: 'base-rate-only' | 'authoritative-rate'
}

export const resolveBreedingIncubationModifierContributionsV1 = (input: {
  readonly egg: unknown
  readonly contributions: unknown
}): ResolvedBreedingIncubationModifierContributionsV1 => {
  parsePokemonEggDocumentV1(input.egg)
  if (Array.isArray(input.contributions)) {
    const contributions = parseAuthoritativeBreedingIncubationModifierContributionsV1(input.contributions)
    if (contributions.length !== 0) {
      return fail('breeding.incubation.unsupported-provider', 'modifierContributions', 'Raw provider contributions are never current server authority.')
    }
    return Object.freeze({
      contributions: Object.freeze([]),
      dependencyEvidence: Object.freeze([]),
      rateNumerator: 1,
      rateDenominator: 1,
      modifierMode: 'base-rate-only',
    })
  }
  const handoff = parseAuthoritativeBreedingModifierProviderHandoffV1(input.contributions, 'modifierProviderHandoff')
  const capacity = handoff.evidence.filter(entry => entry.contribution.contributionId === 'egg-capacity-4')
  const rates = handoff.evidence.filter(entry => entry.contribution.contributionId === 'incubation-rate-times-2')
  const rate = rates[0]?.contribution
  if (handoff.checkpoint !== 'campaign-clock-segment' || handoff.evidence.length !== 2
    || handoff.dependencyEvidence.length !== 1 || capacity.length !== 1 || rates.length !== 1
    || rate?.providerKind !== 'item' || rate.providerId !== BREEDING_EGG_WARMER_ITEM_PROVIDER_ID
    || rate.subjectKind !== 'trainer-sheet' || rate.value.kind !== 'ratio'
    || rate.value.numerator !== 2 || rate.value.denominator !== 1
    || capacity[0]!.contribution.providerId !== rate.providerId
    || capacity[0]!.contribution.subjectId !== rate.subjectId
    || capacity[0]!.contribution.subjectRevision !== rate.subjectRevision
    || capacity[0]!.contribution.effectiveEvidenceSha256 !== rate.effectiveEvidenceSha256) {
    return fail('breeding.incubation.unsupported-provider', 'modifierProviderHandoff', 'Only one exact current Egg Warmer item custody handoff may modify a campaign-clock segment.')
  }
  const definition = Object.freeze({
    schemaVersion: 1 as const,
    providerKind: 'item' as const,
    providerId: rate.providerId,
    checkpoint: 'continuous' as const,
    effect: 'progress-rate-multiplier' as const,
    numerator: 2,
    denominator: 1,
    subjectKind: 'trainer-sheet' as const,
    subjectId: rate.subjectId,
    subjectRevision: rate.subjectRevision,
    providerDefinitionSha256: rate.providerDefinitionSha256,
    effectiveEvidenceSha256: rate.effectiveEvidenceSha256,
  })
  const contribution = parseAuthoritativeBreedingIncubationModifierContributionsV1([
    { ...definition, definitionSha256: sha256(definition) },
  ])[0]!
  return Object.freeze({
    contributions: Object.freeze([contribution]),
    dependencyEvidence: handoff.dependencyEvidence,
    rateNumerator: 2,
    rateDenominator: 1,
    modifierMode: 'authoritative-rate',
  })
}

const validateFrozenDuration = (egg: PokemonEggDocumentV1): void => {
  const duration = egg.incubation
  const minimum = Math.ceil(duration.averageCampaignMinutes / 2)
  const maximum = duration.averageCampaignMinutes * 2
  const validTarget = duration.variationPolicyId === 'fixed-average'
    ? duration.targetCampaignMinutes === duration.averageCampaignMinutes
    : duration.targetCampaignMinutes >= minimum && duration.targetCampaignMinutes <= maximum
  const validPause = !duration.paused || BREEDING_INCUBATION_PAUSE_REASON_IDS.includes(
    duration.pauseReasonId as typeof BREEDING_INCUBATION_PAUSE_REASON_IDS[number],
  )
  if (egg.ruleset.rulesetId !== hatchDurationPolicyJson.rulesetId
    || egg.ruleset.definitionSha256 !== hatchDurationPolicyJson.rulesetDefinitionSha256
    || !egg.definitionHashes.includes(BREEDING_HATCH_DURATION_POLICY_DEFINITION_SHA256)
    || !egg.definitionHashes.includes(duration.durationResultDefinitionSha256)
    || !validTarget || !validPause) {
    fail('breeding.incubation.invalid-authority', 'egg.incubation', 'must retain one bounded immutable duration result and its authoritative hatch-duration policy.')
  }
}

interface CampaignClockCheckpoint {
  readonly revision: number
  readonly campaignMinute: number
  readonly lastOperationId: string | null
}

const parseClock = (value: CampaignClockCheckpoint): CampaignClockCheckpoint => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision > 2_147_483_647
    || !Number.isSafeInteger(value.campaignMinute) || value.campaignMinute < 0
    || (value.lastOperationId !== null && typeof value.lastOperationId !== 'string')) {
    return fail('breeding.incubation.stale-authority', 'campaignClock', 'must be a bounded authoritative campaign-clock checkpoint.')
  }
  return value
}

const validateCommon = (input: {
  readonly egg: unknown
  readonly command: unknown
  readonly campaignClock: CampaignClockCheckpoint
}): {
  readonly egg: PokemonEggDocumentV1
  readonly command: ReturnType<typeof parseBreedingOperationCommandV1>
  readonly clock: CampaignClockCheckpoint
} => {
  const egg = parsePokemonEggDocumentV1(input.egg)
  const command = parseBreedingOperationCommandV1(input.command)
  const clock = parseClock(input.campaignClock)
  if (command.commandKind !== 'advance-egg-incubation' && command.commandKind !== 'set-egg-incubation-pause') {
    return fail('breeding.incubation.wrong-command', 'command.commandKind', 'incubation accepts only progress or pause commands.')
  }
  const scope = command.scopes[0]
  if (scope?.kind !== 'pokemon-egg' || scope.eggId !== egg.eggId || scope.expectedRevision !== egg.revision
    || command.payload.eggId !== egg.eggId
    || command.ruleset.rulesetId !== egg.ruleset.rulesetId
    || command.ruleset.definitionSha256 !== egg.ruleset.definitionSha256) {
    return fail('breeding.incubation.stale-authority', 'command', 'must bind the exact current Egg revision, identity, and ruleset.')
  }
  if (egg.status !== 'incubating' || egg.incubation.readinessKind !== null) {
    return fail('breeding.incubation.unavailable', 'egg.status', 'incubation mutation is available only before readiness on an incubating Egg.')
  }
  if (clock.revision < egg.incubation.lastAppliedClockRevision
    || clock.campaignMinute < egg.incubation.lastAppliedClockMinute
    || clock.campaignMinute < egg.updatedAtCampaignMinute
    || (clock.revision === egg.incubation.lastAppliedClockRevision
      && clock.campaignMinute !== egg.incubation.lastAppliedClockMinute)
    || (clock.revision > egg.incubation.lastAppliedClockRevision
      && clock.campaignMinute <= egg.incubation.lastAppliedClockMinute)) {
    return fail('breeding.incubation.stale-authority', 'campaignClock', 'cannot precede or contradict the durable Egg clock checkpoint.')
  }
  validateFrozenDuration(egg)
  return Object.freeze({ egg, command, clock })
}

export const parseAuthoritativeBreedingIncubationSegmentResultV1 = (
  value: unknown,
  path = 'segmentResult',
): BreedingIncubationSegmentResultV1 => {
  const segment = parseBreedingIncubationSegmentResultV1(value, path)
  if (sha256(withoutHash(segment)) !== segment.definitionSha256) {
    return fail('breeding.incubation.hash-mismatch', `${path}.definitionSha256`, 'must match the exact incubation segment result.')
  }
  return segment
}

const segmentResult = (input: Omit<BreedingIncubationSegmentResultV1, 'schemaVersion' | 'definitionSha256'>): BreedingIncubationSegmentResultV1 => {
  const definition = Object.freeze({ schemaVersion: 1 as const, ...input })
  return parseAuthoritativeBreedingIncubationSegmentResultV1({
    ...definition,
    definitionSha256: sha256(definition),
  })
}

export interface PlanBreedingIncubationResultV1 {
  readonly egg: PokemonEggDocumentV1
  readonly segment: BreedingIncubationSegmentResultV1
}

export const planBreedingIncubationAdvanceV1 = (input: {
  readonly egg: unknown
  readonly command: unknown
  readonly campaignClock: CampaignClockCheckpoint
  readonly modifierContributions: unknown
}): PlanBreedingIncubationResultV1 => {
  const current = validateCommon(input)
  if (current.command.commandKind !== 'advance-egg-incubation') {
    return fail('breeding.incubation.wrong-command', 'command.commandKind', 'progress requires advance-egg-incubation.')
  }
  const modifiers = resolveBreedingIncubationModifierContributionsV1({ egg: current.egg, contributions: input.modifierContributions })
  if (current.clock.revision <= current.egg.incubation.lastAppliedClockRevision
    || current.command.payload.throughClockRevision !== current.clock.revision
    || current.command.payload.throughCampaignMinute !== current.clock.campaignMinute) {
    return fail('breeding.incubation.stale-authority', 'command.payload', 'must advance through one exact newer campaign-clock revision.')
  }
  const fromMinute = current.egg.incubation.lastAppliedClockMinute
  const elapsed = current.clock.campaignMinute - fromMinute
  const accumulatedBefore = current.egg.incubation.accumulatedCampaignMinutes
  const remainingBefore = current.egg.incubation.targetCampaignMinutes - accumulatedBefore
  const availableProgress = elapsed * modifiers.rateNumerator / modifiers.rateDenominator
  if (!Number.isSafeInteger(availableProgress)) return fail('breeding.incubation.invalid-authority', 'modifierContributions', 'must produce exact integral campaign progress.')
  const credited = current.egg.incubation.paused ? 0 : Math.min(availableProgress, remainingBefore)
  const skipped = current.egg.incubation.paused ? elapsed : 0
  const overflow = current.egg.incubation.paused ? 0 : Math.max(0, availableProgress - remainingBefore)
  const accumulatedAfter = accumulatedBefore + credited
  const reachedReady = accumulatedAfter === current.egg.incubation.targetCampaignMinutes
  const readyAtCampaignMinute = reachedReady ? fromMinute + Math.ceil(remainingBefore * modifiers.rateDenominator / modifiers.rateNumerator) : null
  const next = validatePokemonEggRevisionSuccessor(current.egg, {
    ...current.egg,
    revision: current.egg.revision + 1,
    status: reachedReady ? 'ready' : 'incubating',
    incubation: {
      ...current.egg.incubation,
      accumulatedCampaignMinutes: accumulatedAfter,
      lastAppliedClockRevision: current.clock.revision,
      lastAppliedClockMinute: current.clock.campaignMinute,
      readyAtCampaignMinute,
      readinessKind: reachedReady ? 'incubation-complete' : null,
      readyOperationId: reachedReady ? current.command.operationId : null,
    },
    updatedAtCampaignMinute: current.clock.campaignMinute,
    statusChangedAtCampaignMinute: reachedReady
      ? current.clock.campaignMinute
      : current.egg.statusChangedAtCampaignMinute,
    lastOperationId: current.command.operationId,
  })
  const segment = segmentResult({
    operationId: current.command.operationId,
    commandKind: current.command.commandKind,
    eggId: current.egg.eggId,
    eggRevisionBefore: current.egg.revision,
    eggRevisionAfter: next.revision,
    fromClockRevision: current.egg.incubation.lastAppliedClockRevision,
    fromCampaignMinute: fromMinute,
    throughClockRevision: current.clock.revision,
    throughCampaignMinute: current.clock.campaignMinute,
    elapsedCampaignMinutes: elapsed,
    creditedCampaignMinutes: credited,
    skippedCampaignMinutes: skipped,
    overflowCampaignMinutes: overflow,
    targetCampaignMinutes: current.egg.incubation.targetCampaignMinutes,
    accumulatedBeforeCampaignMinutes: accumulatedBefore,
    accumulatedAfterCampaignMinutes: accumulatedAfter,
    reachedReady,
    readyAtCampaignMinute,
    pausedDuringSegment: current.egg.incubation.paused,
    pauseMutation: 'none',
    modifierMode: modifiers.modifierMode,
  })
  return Object.freeze({ egg: next, segment })
}

export const planBreedingIncubationPauseV1 = (input: {
  readonly egg: unknown
  readonly command: unknown
  readonly campaignClock: CampaignClockCheckpoint
  readonly modifierContributions: unknown
}): PlanBreedingIncubationResultV1 => {
  const current = validateCommon(input)
  if (current.command.commandKind !== 'set-egg-incubation-pause') {
    return fail('breeding.incubation.wrong-command', 'command.commandKind', 'pause control requires set-egg-incubation-pause.')
  }
  const modifiers = resolveBreedingIncubationModifierContributionsV1({ egg: current.egg, contributions: input.modifierContributions })
  if (current.command.payload.paused === current.egg.incubation.paused) {
    return fail('breeding.incubation.unavailable', 'command.payload.paused', 'must change the current explicit pause state.')
  }
  if (current.command.payload.paused
    && !BREEDING_INCUBATION_PAUSE_REASON_IDS.includes(current.command.payload.reasonId as typeof BREEDING_INCUBATION_PAUSE_REASON_IDS[number])) {
    return fail('breeding.incubation.unavailable', 'command.payload.reasonId', 'must be a closed audited incubation pause reason.')
  }
  const fromMinute = current.egg.incubation.lastAppliedClockMinute
  const elapsed = current.clock.campaignMinute - fromMinute
  const accumulatedBefore = current.egg.incubation.accumulatedCampaignMinutes
  const remainingBefore = current.egg.incubation.targetCampaignMinutes - accumulatedBefore
  const pausedDuringSegment = current.egg.incubation.paused
  const availableProgress = elapsed * modifiers.rateNumerator / modifiers.rateDenominator
  if (!Number.isSafeInteger(availableProgress)) return fail('breeding.incubation.invalid-authority', 'modifierContributions', 'must produce exact integral campaign progress.')
  const credited = pausedDuringSegment ? 0 : Math.min(availableProgress, remainingBefore)
  if (!pausedDuringSegment && credited === remainingBefore) {
    return fail('breeding.incubation.unavailable', 'egg.incubation', 'the Egg reached its target before this pause; advance incubation to settle readiness first.')
  }
  const skipped = pausedDuringSegment ? elapsed : 0
  const accumulatedAfter = accumulatedBefore + credited
  const next = validatePokemonEggRevisionSuccessor(current.egg, {
    ...current.egg,
    revision: current.egg.revision + 1,
    incubation: {
      ...current.egg.incubation,
      accumulatedCampaignMinutes: accumulatedAfter,
      lastAppliedClockRevision: current.clock.revision,
      lastAppliedClockMinute: current.clock.campaignMinute,
      paused: current.command.payload.paused,
      pauseReasonId: current.command.payload.reasonId,
      pauseOperationId: current.command.payload.paused ? current.command.operationId : null,
    },
    updatedAtCampaignMinute: current.clock.campaignMinute,
    lastOperationId: current.command.operationId,
  })
  const segment = segmentResult({
    operationId: current.command.operationId,
    commandKind: current.command.commandKind,
    eggId: current.egg.eggId,
    eggRevisionBefore: current.egg.revision,
    eggRevisionAfter: next.revision,
    fromClockRevision: current.egg.incubation.lastAppliedClockRevision,
    fromCampaignMinute: fromMinute,
    throughClockRevision: current.clock.revision,
    throughCampaignMinute: current.clock.campaignMinute,
    elapsedCampaignMinutes: elapsed,
    creditedCampaignMinutes: credited,
    skippedCampaignMinutes: skipped,
    overflowCampaignMinutes: 0,
    targetCampaignMinutes: current.egg.incubation.targetCampaignMinutes,
    accumulatedBeforeCampaignMinutes: accumulatedBefore,
    accumulatedAfterCampaignMinutes: accumulatedAfter,
    reachedReady: false,
    readyAtCampaignMinute: null,
    pausedDuringSegment,
    pauseMutation: current.command.payload.paused ? 'paused' : 'resumed',
    modifierMode: modifiers.modifierMode,
  })
  return Object.freeze({ egg: next, segment })
}

export const projectBreedingIncubationProgressV1 = (input: {
  readonly egg: unknown
  readonly audience: 'gm' | 'owner'
  readonly generatedAtCampaignMinute: number
}): BreedingIncubationProgressProjectionV1 => {
  const egg = parsePokemonEggDocumentV1(input.egg)
  validateFrozenDuration(egg)
  return parseBreedingIncubationProgressProjectionV1({
    schemaVersion: 1,
    audience: input.audience,
    eggId: egg.eggId,
    revision: egg.revision,
    status: egg.status,
    targetCampaignMinutes: egg.incubation.targetCampaignMinutes,
    accumulatedCampaignMinutes: egg.incubation.accumulatedCampaignMinutes,
    remainingCampaignMinutes: egg.incubation.targetCampaignMinutes - egg.incubation.accumulatedCampaignMinutes,
    progressBasisPoints: Math.floor(egg.incubation.accumulatedCampaignMinutes * 10_000 / egg.incubation.targetCampaignMinutes),
    paused: egg.incubation.paused,
    readyAtCampaignMinute: egg.incubation.readyAtCampaignMinute,
    readinessKind: egg.incubation.readinessKind,
    lastAppliedClockRevision: egg.incubation.lastAppliedClockRevision,
    lastAppliedClockMinute: egg.incubation.lastAppliedClockMinute,
    modifierMode: 'base-rate-only',
    availableActions: egg.status === 'incubating'
      ? [
          'advance-egg-incubation',
          'set-egg-incubation-pause',
          ...(input.audience === 'gm' && !egg.incubation.paused ? ['mark-egg-ready'] : []),
        ]
      : [],
    generatedAtCampaignMinute: input.generatedAtCampaignMinute,
  })
}

export const pokemonEggIncubationDocumentDefinitionSha256 = (egg: PokemonEggDocumentV1): string => (
  pokemonEggDocumentDefinitionSha256(parsePokemonEggDocumentV1(egg))
)
