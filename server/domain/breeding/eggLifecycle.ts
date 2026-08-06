import {
  POKEMON_EGG_ACTIVE_STATUSES,
  POKEMON_EGG_REVISION_MAXIMUM,
  POKEMON_EGG_SETTLED_STATUSES,
  parsePokemonEggDocumentV1,
  type PokemonEggDocumentV1,
  type PokemonEggSpecialStateId,
  type PokemonEggStatus,
} from '#shared/breeding/egg'

export const POKEMON_EGG_TRANSITIONS: Readonly<Record<PokemonEggStatus, readonly PokemonEggStatus[]>> = Object.freeze({
  incubating: Object.freeze(['ready', 'cancelled', 'invalidated-by-gm']),
  ready: Object.freeze(['awaiting-special-adjudication', 'hatching', 'cancelled', 'invalidated-by-gm']),
  'awaiting-special-adjudication': Object.freeze(['hatching', 'cancelled', 'invalidated-by-gm']),
  hatching: Object.freeze(['hatched', 'invalidated-by-gm']),
  hatched: Object.freeze([]),
  cancelled: Object.freeze([]),
  'invalidated-by-gm': Object.freeze([]),
})
export const POKEMON_EGG_SPECIAL_TRANSITIONS: Readonly<Record<PokemonEggSpecialStateId, readonly PokemonEggSpecialStateId[]>> = Object.freeze({
  'not-rolled': Object.freeze(['normal', 'pending-adjudication']),
  normal: Object.freeze([]),
  'pending-adjudication': Object.freeze(['resolved']),
  resolved: Object.freeze([]),
})
export type PokemonEggTransitionCode =
  | 'breeding.egg.invalid-transition'
  | 'breeding.egg.stale-revision'
  | 'breeding.egg.immutable-field'
export class PokemonEggTransitionError extends Error {
  readonly code: PokemonEggTransitionCode
  readonly path: string
  constructor(code: PokemonEggTransitionCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'PokemonEggTransitionError'
    this.code = code
    this.path = path
  }
}
const fail = (code: PokemonEggTransitionCode, path: string, message: string): never => {
  throw new PokemonEggTransitionError(code, path, message)
}
const active = new Set<string>(POKEMON_EGG_ACTIVE_STATUSES)
const settled = new Set<string>(POKEMON_EGG_SETTLED_STATUSES)
const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)
const unchanged = (condition: boolean, path: string): void => {
  if (!condition) fail('breeding.egg.immutable-field', path, 'cannot change after Egg acceptance.')
}
export const isPokemonEggStatusTransitionAllowed = (from: PokemonEggStatus, to: PokemonEggStatus): boolean => (
  from !== to && POKEMON_EGG_TRANSITIONS[from].includes(to)
)
const specialTransitionAllowed = (from: PokemonEggSpecialStateId, to: PokemonEggSpecialStateId): boolean => (
  from === to || POKEMON_EGG_SPECIAL_TRANSITIONS[from].includes(to)
)

/** Validate one server-planned Egg successor without authorizing or persisting it. */
export const validatePokemonEggRevisionSuccessor = (currentValue: unknown, nextValue: unknown): PokemonEggDocumentV1 => {
  const current = parsePokemonEggDocumentV1(currentValue, 'currentEgg')
  const next = parsePokemonEggDocumentV1(nextValue, 'nextEgg')
  if (settled.has(current.status)) fail('breeding.egg.invalid-transition', 'currentEgg.status', 'settled Eggs cannot produce another revision.')
  if (current.revision >= POKEMON_EGG_REVISION_MAXIMUM || next.revision !== current.revision + 1) {
    fail('breeding.egg.stale-revision', 'nextEgg.revision', 'must be exactly current revision plus one.')
  }
  if (next.updatedAtCampaignMinute < current.updatedAtCampaignMinute) fail('breeding.egg.invalid-transition', 'nextEgg.updatedAtCampaignMinute', 'cannot move campaign time backward.')
  if (next.lastOperationId === current.lastOperationId) fail('breeding.egg.invalid-transition', 'nextEgg.lastOperationId', 'must identify a new committed operation.')
  if (next.status === current.status) {
    if (!active.has(current.status) || next.statusChangedAtCampaignMinute !== current.statusChangedAtCampaignMinute) {
      fail('breeding.egg.invalid-transition', 'nextEgg.statusChangedAtCampaignMinute', 'same-status active revisions retain status-change time.')
    }
  }
  else {
    if (!isPokemonEggStatusTransitionAllowed(current.status, next.status)) fail('breeding.egg.invalid-transition', 'nextEgg.status', `${current.status} cannot transition to ${next.status}.`)
    if (next.statusChangedAtCampaignMinute !== next.updatedAtCampaignMinute) fail('breeding.egg.invalid-transition', 'nextEgg.statusChangedAtCampaignMinute', 'status transitions are timestamped at update time.')
  }

  unchanged(next.schemaVersion === current.schemaVersion, 'nextEgg.schemaVersion')
  unchanged(next.eggId === current.eggId, 'nextEgg.eggId')
  unchanged(sameJson(next.source, current.source), 'nextEgg.source')
  unchanged(sameJson(next.ruleset, current.ruleset), 'nextEgg.ruleset')
  unchanged(sameJson(next.definitionHashes, current.definitionHashes), 'nextEgg.definitionHashes')
  unchanged(sameJson(next.parents, current.parents), 'nextEgg.parents')
  unchanged(sameJson(next.breeder, current.breeder), 'nextEgg.breeder')
  unchanged(sameJson(next.offspring, current.offspring), 'nextEgg.offspring')
  unchanged(next.createdAtCampaignMinute === current.createdAtCampaignMinute, 'nextEgg.createdAtCampaignMinute')

  if (next.ownerTrainerSlug !== current.ownerTrainerSlug) {
    if (!['incubating', 'ready'].includes(current.status) || next.status !== current.status || current.hatchOperationId !== null) {
      fail('breeding.egg.invalid-transition', 'nextEgg.ownerTrainerSlug', 'ownership transfer is allowed only before a hatch operation in a same-status transfer revision.')
    }
    unchanged(sameJson(next.incubation, current.incubation), 'nextEgg.incubation')
    unchanged(sameJson(next.special, current.special), 'nextEgg.special')
    unchanged(next.hatchOperationId === current.hatchOperationId, 'nextEgg.hatchOperationId')
    unchanged(next.childSheetSlug === current.childSheetSlug, 'nextEgg.childSheetSlug')
    unchanged(sameJson(next.terminal, current.terminal), 'nextEgg.terminal')
  }
  unchanged(next.incubation.averageCampaignMinutes === current.incubation.averageCampaignMinutes, 'nextEgg.incubation.averageCampaignMinutes')
  unchanged(next.incubation.targetCampaignMinutes === current.incubation.targetCampaignMinutes, 'nextEgg.incubation.targetCampaignMinutes')
  unchanged(next.incubation.variationPolicyId === current.incubation.variationPolicyId, 'nextEgg.incubation.variationPolicyId')
  unchanged(next.incubation.durationResultDefinitionSha256 === current.incubation.durationResultDefinitionSha256, 'nextEgg.incubation.durationResultDefinitionSha256')
  if (next.incubation.accumulatedCampaignMinutes < current.incubation.accumulatedCampaignMinutes) {
    fail('breeding.egg.invalid-transition', 'nextEgg.incubation.accumulatedCampaignMinutes', 'incubation progress cannot decrease.')
  }
  if (next.incubation.lastAppliedClockRevision < current.incubation.lastAppliedClockRevision
    || next.incubation.lastAppliedClockMinute < current.incubation.lastAppliedClockMinute) {
    fail('breeding.egg.invalid-transition', 'nextEgg.incubation.lastAppliedClockRevision', 'campaign-clock checkpoints must be monotonic.')
  }
  const currentReady = current.incubation.readinessKind !== null
  const nextReady = next.incubation.readinessKind !== null
  if (currentReady) {
    unchanged(next.incubation.readyAtCampaignMinute === current.incubation.readyAtCampaignMinute, 'nextEgg.incubation.readyAtCampaignMinute')
    unchanged(next.incubation.readinessKind === current.incubation.readinessKind, 'nextEgg.incubation.readinessKind')
    unchanged(next.incubation.readyOperationId === current.incubation.readyOperationId, 'nextEgg.incubation.readyOperationId')
    unchanged(next.incubation.accumulatedCampaignMinutes === current.incubation.accumulatedCampaignMinutes, 'nextEgg.incubation.accumulatedCampaignMinutes')
  }
  else if (nextReady && next.status !== 'ready') {
    fail('breeding.egg.invalid-transition', 'nextEgg.incubation.readinessKind', 'first readiness must atomically transition to ready.')
  }
  if ((next.incubation.paused !== current.incubation.paused
    || next.incubation.pauseReasonId !== current.incubation.pauseReasonId
    || next.incubation.pauseOperationId !== current.incubation.pauseOperationId)
    && (current.status !== 'incubating' || next.status !== 'incubating')) {
    fail('breeding.egg.invalid-transition', 'nextEgg.incubation.paused', 'pause changes require a same-status incubating operation.')
  }

  if (!specialTransitionAllowed(current.special.state, next.special.state)) {
    fail('breeding.egg.invalid-transition', 'nextEgg.special.state', `${current.special.state} cannot transition to ${next.special.state}.`)
  }
  if (current.special.rollRecordId !== null) {
    unchanged(next.special.rollRecordId === current.special.rollRecordId, 'nextEgg.special.rollRecordId')
    unchanged(next.special.rollTotal === current.special.rollTotal, 'nextEgg.special.rollTotal')
    unchanged(sameJson(next.special.triggerIds, current.special.triggerIds), 'nextEgg.special.triggerIds')
  }
  if (current.special.state === 'resolved') unchanged(sameJson(next.special, current.special), 'nextEgg.special')
  if (current.hatchOperationId !== null) unchanged(next.hatchOperationId === current.hatchOperationId, 'nextEgg.hatchOperationId')
  if (current.childSheetSlug !== null) unchanged(next.childSheetSlug === current.childSheetSlug, 'nextEgg.childSheetSlug')
  return next
}
