import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parsePokemonEggDocumentV1, type PokemonEggDocumentV1 } from '#shared/breeding/egg'
import {
  parsePokemonEggExternalLifecycleEvaluationV1,
  parsePokemonEggExternalLifecycleObservationV1,
  parsePokemonEggLifecycleProjectionV1,
  type PokemonEggExternalLifecycleEvaluationV1,
  type PokemonEggLifecycleProjectionV1,
} from '#shared/breeding/eggLifecycle'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import { validatePokemonEggRevisionSuccessor } from './eggLifecycle'

export const POKEMON_EGG_LIFECYCLE_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1,
  policyId: 'pokemon-egg-lifecycle-policy-v1',
  readiness: Object.freeze({
    incubating: 'not-ready',
    ready: 'may-begin-hatch',
    hatchStarted: 'cannot-begin-second-hatch',
    settled: 'cannot-begin-hatch',
  }),
  transfer: Object.freeze({
    allowedStatuses: Object.freeze(['incubating', 'ready']),
    requiresNoHatchOperation: true,
    changesOnly: Object.freeze(['ownerTrainerSlug', 'revision', 'updatedAtCampaignMinute', 'lastOperationId']),
    incubation: 'continues-with-unchanged-progress-pause-and-clock-checkpoint',
    readiness: 'preserved',
    executionAuthorityOwner: 'BR-064',
  }),
  storage: Object.freeze({
    aggregateMutation: 'none',
    incubation: 'continues-current-explicit-state',
    readiness: 'preserved',
    executionAuthorityOwner: 'BR-064',
  }),
  facility: Object.freeze({
    canonicalRegistryCount: 0,
    baselineIncubation: 'continues-current-explicit-state',
    contribution: 'unavailable-until-reviewed-provider-integration',
    executionAuthorityOwner: 'BR-061',
  }),
  sourceLoss: Object.freeze({
    acceptedBlueprint: 'immutable',
    acceptedSnapshots: 'authoritative',
    aggregateMutation: 'none',
    incubation: 'continues-current-explicit-state',
    readiness: 'preserved',
    hatchEligibility: 'status-derived-not-source-derived',
    integrationAuthorityOwners: Object.freeze(['BR-063', 'BR-065', 'BR-066']),
  }),
  clocks: Object.freeze({ lifecycle: 'campaign-minute-only', wallBrowserProcessMapEncounter: 'never-authority' }),
})

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

export const POKEMON_EGG_LIFECYCLE_POLICY_DEFINITION_SHA256 = sha256(POKEMON_EGG_LIFECYCLE_POLICY_DEFINITION)

export type PokemonEggLifecyclePolicyErrorCode =
  | 'breeding.egg-lifecycle.wrong-command'
  | 'breeding.egg-lifecycle.stale-authority'
  | 'breeding.egg-lifecycle.unavailable'
  | 'breeding.egg-lifecycle.invalid-observation'

export class PokemonEggLifecyclePolicyError extends Error {
  readonly code: PokemonEggLifecyclePolicyErrorCode
  readonly path: string

  constructor(code: PokemonEggLifecyclePolicyErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'PokemonEggLifecyclePolicyError'
    this.code = code
    this.path = path
  }
}

const fail = (code: PokemonEggLifecyclePolicyErrorCode, path: string, message: string): never => {
  throw new PokemonEggLifecyclePolicyError(code, path, message)
}
const campaignMinute = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return fail('breeding.egg-lifecycle.stale-authority', path, 'must be a non-negative safe campaign minute.')
  }
  return value as number
}

/**
 * Project the lifecycle-only eligibility used by hatch offer planning.
 * This does not confer actor, destination, consent, provider, or command authority.
 */
export const projectPokemonEggLifecycleV1 = (input: {
  readonly egg: unknown
  readonly audience: 'gm' | 'owner'
  readonly generatedAtCampaignMinute: unknown
}): PokemonEggLifecycleProjectionV1 => {
  const egg = parsePokemonEggDocumentV1(input.egg)
  const generatedAt = campaignMinute(input.generatedAtCampaignMinute, 'generatedAtCampaignMinute')
  if (generatedAt < egg.updatedAtCampaignMinute) {
    return fail('breeding.egg-lifecycle.stale-authority', 'generatedAtCampaignMinute', 'cannot predate the authoritative Egg revision.')
  }
  const readiness = egg.status === 'incubating'
    ? {
        state: 'not-ready' as const,
        disposition: egg.incubation.paused ? 'explicitly-paused' as const : 'active' as const,
        canTransfer: true,
        canBeginHatch: false,
        blockers: ['breeding.egg-lifecycle.not-ready'] as const,
      }
    : egg.status === 'ready'
      ? {
          state: 'ready' as const,
          disposition: 'complete' as const,
          canTransfer: true,
          canBeginHatch: true,
          blockers: [] as const,
        }
      : egg.status === 'awaiting-special-adjudication' || egg.status === 'hatching'
        ? {
            state: 'hatch-started' as const,
            disposition: 'complete' as const,
            canTransfer: false,
            canBeginHatch: false,
            blockers: ['breeding.egg-lifecycle.hatch-already-started'] as const,
          }
        : egg.status === 'hatched'
          ? {
              state: 'hatched' as const,
              disposition: 'settled' as const,
              canTransfer: false,
              canBeginHatch: false,
              blockers: ['breeding.egg-lifecycle.already-hatched'] as const,
            }
          : {
              state: 'terminal' as const,
              disposition: 'settled' as const,
              canTransfer: false,
              canBeginHatch: false,
              blockers: [egg.status === 'cancelled'
                ? 'breeding.egg-lifecycle.cancelled' as const
                : 'breeding.egg-lifecycle.invalidated-by-gm' as const],
            }
  return parsePokemonEggLifecycleProjectionV1({
    schemaVersion: 1,
    audience: input.audience,
    eggId: egg.eggId,
    revision: egg.revision,
    status: egg.status,
    readinessState: readiness.state,
    incubationDisposition: readiness.disposition,
    canTransferBeforeHatch: readiness.canTransfer,
    canBeginHatch: readiness.canBeginHatch,
    transferPolicy: 'continues-incubation-and-preserves-readiness',
    storagePolicy: 'continues-incubation-and-preserves-readiness',
    facilityPolicy: 'base-rate-continues-provider-contribution-required',
    sourceLossPolicy: 'frozen-snapshot-continues',
    blockerReasonIds: readiness.blockers,
    generatedAtCampaignMinute: generatedAt,
  })
}

/**
 * Evaluate a custody, facility, or accepted-source continuity observation. These
 * observations are diagnostic/provider inputs only and never write an Egg revision.
 */
export const evaluatePokemonEggExternalLifecycleObservationV1 = (input: {
  readonly egg: unknown
  readonly observation: unknown
  readonly observedAtCampaignMinute: unknown
}): PokemonEggExternalLifecycleEvaluationV1 => {
  const egg = parsePokemonEggDocumentV1(input.egg)
  const observation = parsePokemonEggExternalLifecycleObservationV1(input.observation)
  const observedAt = campaignMinute(input.observedAtCampaignMinute, 'observedAtCampaignMinute')
  if (observedAt < egg.updatedAtCampaignMinute) {
    return fail('breeding.egg-lifecycle.stale-authority', 'observedAtCampaignMinute', 'cannot predate the authoritative Egg revision.')
  }
  if (observation.kind === 'source-continuity-loss') {
    const allowed = egg.source.kind === 'breeding'
      ? ['origin', 'parent-0', 'parent-1', 'breeder']
      : ['origin']
    if (!allowed.includes(observation.sourceRole)) {
      return fail('breeding.egg-lifecycle.invalid-observation', 'observation.sourceRole', 'must name a source role present in the accepted Egg source family.')
    }
  }
  const facilityClaimed = observation.kind === 'facility-change' && observation.facilityId !== null
  const reasonId = observation.kind === 'custody-change'
    ? 'breeding.egg-lifecycle.storage-continues' as const
    : observation.kind === 'source-continuity-loss'
      ? 'breeding.egg-lifecycle.source-loss-snapshot-preserved' as const
      : facilityClaimed
        ? 'breeding.egg-lifecycle.facility-unsupported' as const
        : 'breeding.egg-lifecycle.facility-removed-base-rate-continues' as const
  return parsePokemonEggExternalLifecycleEvaluationV1({
    schemaVersion: 1,
    eggId: egg.eggId,
    eggRevision: egg.revision,
    observationKind: observation.kind,
    mutationRequired: false,
    incubationDisposition: 'preserve-current-explicit-state',
    readinessDisposition: 'preserve',
    hatchEligibilityDisposition: 'preserve-status-derived-eligibility',
    facilityContributionDisposition: facilityClaimed ? 'unavailable' : 'none',
    reasonId,
    observedAtCampaignMinute: observedAt,
  })
}

/**
 * Pure transfer reduction for use after BR-064 supplies exact owner, recipient,
 * consent, destination, and command authorization. It intentionally cannot
 * validate those external authorities itself.
 */
export const planPokemonEggOwnershipTransferV1 = (input: {
  readonly egg: unknown
  readonly command: unknown
  readonly atCampaignMinute: unknown
}): PokemonEggDocumentV1 => {
  const egg = parsePokemonEggDocumentV1(input.egg)
  const command = parseBreedingOperationCommandV1(input.command)
  const atCampaignMinute = campaignMinute(input.atCampaignMinute, 'atCampaignMinute')
  if (command.commandKind !== 'transfer-egg') {
    return fail('breeding.egg-lifecycle.wrong-command', 'command.commandKind', 'ownership transfer requires transfer-egg.')
  }
  const scope = command.scopes[0]
  if (command.payload.eggId !== egg.eggId
    || scope?.kind !== 'pokemon-egg'
    || scope.eggId !== egg.eggId
    || scope.expectedRevision !== egg.revision
    || command.ruleset.rulesetId !== egg.ruleset.rulesetId
    || command.ruleset.definitionSha256 !== egg.ruleset.definitionSha256) {
    return fail('breeding.egg-lifecycle.stale-authority', 'command', 'must bind the exact current Egg identity, revision, and ruleset.')
  }
  if (atCampaignMinute < egg.updatedAtCampaignMinute) {
    return fail('breeding.egg-lifecycle.stale-authority', 'atCampaignMinute', 'cannot move campaign time backward.')
  }
  if (!['incubating', 'ready'].includes(egg.status) || egg.hatchOperationId !== null) {
    return fail('breeding.egg-lifecycle.unavailable', 'egg.status', 'transfer is available only before a hatch operation on an incubating or ready Egg.')
  }
  if (command.payload.destinationTrainerSlug === egg.ownerTrainerSlug) {
    return fail('breeding.egg-lifecycle.unavailable', 'command.payload.destinationTrainerSlug', 'must identify a different destination Trainer.')
  }
  return validatePokemonEggRevisionSuccessor(egg, {
    ...egg,
    revision: egg.revision + 1,
    ownerTrainerSlug: command.payload.destinationTrainerSlug,
    updatedAtCampaignMinute: atCampaignMinute,
    statusChangedAtCampaignMinute: egg.statusChangedAtCampaignMinute,
    lastOperationId: command.operationId,
  })
}

export const pokemonEggLifecycleDocumentDefinitionSha256 = (eggValue: unknown): string => (
  sha256(parsePokemonEggDocumentV1(eggValue))
)
