import {
  BREEDING_PROJECT_ACTIVE_STATUSES,
  BREEDING_PROJECT_REVISION_MAXIMUM,
  BREEDING_PROJECT_SETTLED_STATUSES,
  parseBreedingProjectDocumentV1,
  type BreedingProjectDocumentV1,
  type BreedingProjectStatus,
} from '#shared/breeding/project'

export const BREEDING_PROJECT_TRANSITIONS: Readonly<Record<BreedingProjectStatus, readonly BreedingProjectStatus[]>> = Object.freeze({
  draft: Object.freeze(['awaiting-parent-consent', 'initial-time-in-progress', 'cancelled', 'expired', 'abandoned', 'conflicted']),
  'awaiting-parent-consent': Object.freeze(['initial-time-in-progress', 'check-ready', 'cancelled', 'expired', 'abandoned', 'conflicted']),
  'initial-time-in-progress': Object.freeze(['awaiting-parent-consent', 'check-ready', 'cancelled', 'expired', 'abandoned', 'conflicted']),
  'check-ready': Object.freeze(['awaiting-parent-consent', 'additional-time-in-progress', 'check-failed', 'cancelled', 'expired', 'abandoned', 'conflicted']),
  'additional-time-in-progress': Object.freeze(['ready-to-produce', 'cancelled', 'expired', 'abandoned', 'conflicted']),
  'ready-to-produce': Object.freeze(['egg-produced', 'cancelled', 'expired', 'abandoned', 'conflicted']),
  'egg-produced': Object.freeze([]),
  'check-failed': Object.freeze([]),
  cancelled: Object.freeze([]),
  expired: Object.freeze([]),
  abandoned: Object.freeze([]),
  conflicted: Object.freeze([]),
} satisfies Record<BreedingProjectStatus, readonly BreedingProjectStatus[]>)

export type BreedingProjectTransitionCode =
  | 'breeding.project.invalid-transition'
  | 'breeding.project.stale-revision'
  | 'breeding.project.immutable-field'
export class BreedingProjectTransitionError extends Error {
  readonly code: BreedingProjectTransitionCode
  readonly path: string
  constructor(code: BreedingProjectTransitionCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingProjectTransitionError'
    this.code = code
    this.path = path
  }
}
const fail = (code: BreedingProjectTransitionCode, path: string, message: string): never => {
  throw new BreedingProjectTransitionError(code, path, message)
}
const settled = new Set<string>(BREEDING_PROJECT_SETTLED_STATUSES)
const active = new Set<string>(BREEDING_PROJECT_ACTIVE_STATUSES)
const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

export const isBreedingProjectStatusTransitionAllowed = (
  from: BreedingProjectStatus,
  to: BreedingProjectStatus,
): boolean => from !== to && BREEDING_PROJECT_TRANSITIONS[from].includes(to)

const unchanged = (condition: boolean, path: string): void => {
  if (!condition) fail('breeding.project.immutable-field', path, 'cannot change across project revisions.')
}
const nullableMonotonic = (before: number | null, after: number | null, path: string): void => {
  if (before !== null && after !== before) fail('breeding.project.immutable-field', path, 'cannot change after it is first recorded.')
}

/**
 * Validate one parsed aggregate successor. This does not authorize the actor or
 * perform mechanics; owning use cases must do both before persistence.
 */
export const validateBreedingProjectRevisionSuccessor = (
  currentValue: unknown,
  nextValue: unknown,
): BreedingProjectDocumentV1 => {
  const current = parseBreedingProjectDocumentV1(currentValue, 'currentProject')
  const next = parseBreedingProjectDocumentV1(nextValue, 'nextProject')
  if (settled.has(current.status)) {
    return fail('breeding.project.invalid-transition', 'currentProject.status', 'settled projects cannot produce another revision.')
  }
  if (current.revision >= BREEDING_PROJECT_REVISION_MAXIMUM || next.revision !== current.revision + 1) {
    return fail('breeding.project.stale-revision', 'nextProject.revision', 'must be exactly current revision plus one.')
  }
  if (next.updatedAtCampaignMinute < current.updatedAtCampaignMinute) {
    fail('breeding.project.invalid-transition', 'nextProject.updatedAtCampaignMinute', 'cannot move campaign time backward.')
  }
  if (next.lastOperationId === current.lastOperationId) {
    fail('breeding.project.invalid-transition', 'nextProject.lastOperationId', 'must identify the new committed operation.')
  }
  if (next.status === current.status) {
    if (!active.has(current.status) || next.statusChangedAtCampaignMinute !== current.statusChangedAtCampaignMinute) {
      fail('breeding.project.invalid-transition', 'nextProject.statusChangedAtCampaignMinute', 'same-status revisions retain their prior status-change time.')
    }
  }
  else {
    if (!isBreedingProjectStatusTransitionAllowed(current.status, next.status)) {
      fail('breeding.project.invalid-transition', 'nextProject.status', `${current.status} cannot transition to ${next.status}.`)
    }
    if (next.statusChangedAtCampaignMinute !== next.updatedAtCampaignMinute) {
      fail('breeding.project.invalid-transition', 'nextProject.statusChangedAtCampaignMinute', 'a status transition is timestamped at the update campaign minute.')
    }
  }

  unchanged(next.schemaVersion === current.schemaVersion, 'nextProject.schemaVersion')
  unchanged(next.projectId === current.projectId, 'nextProject.projectId')
  unchanged(sameJson(next.ruleset, current.ruleset), 'nextProject.ruleset')
  unchanged(next.projectCreationOptionSnapshotSha256 === current.projectCreationOptionSnapshotSha256, 'nextProject.projectCreationOptionSnapshotSha256')
  unchanged(next.ownerTrainerSlug === current.ownerTrainerSlug, 'nextProject.ownerTrainerSlug')
  unchanged(next.breederTrainerSlug === current.breederTrainerSlug, 'nextProject.breederTrainerSlug')
  unchanged(next.consentPolicy === current.consentPolicy, 'nextProject.consentPolicy')
  unchanged(next.createdAtCampaignMinute === current.createdAtCampaignMinute, 'nextProject.createdAtCampaignMinute')
  unchanged(next.timeline.initialRequiredCampaignMinutes === current.timeline.initialRequiredCampaignMinutes, 'nextProject.timeline.initialRequiredCampaignMinutes')
  unchanged(next.timeline.additionalRequiredCampaignMinutes === current.timeline.additionalRequiredCampaignMinutes, 'nextProject.timeline.additionalRequiredCampaignMinutes')
  for (let index = 0; index < 2; index += 1) {
    const nextParent = next.parentRefs[index]!
    const currentParent = current.parentRefs[index]!
    unchanged(nextParent.pokemonSheetSlug === currentParent.pokemonSheetSlug, `nextProject.parentRefs[${index}].pokemonSheetSlug`)
    unchanged(nextParent.ownerTrainerSlug === currentParent.ownerTrainerSlug, `nextProject.parentRefs[${index}].ownerTrainerSlug`)
  }
  const parentRevisionChanged = next.parentRefs.some((parent, index) => (
    parent.expectedSheetRevision !== current.parentRefs[index]!.expectedSheetRevision
  ))
  if (parentRevisionChanged) {
    const refreshableStatus = ['draft', 'awaiting-parent-consent', 'initial-time-in-progress', 'check-ready'].includes(current.status)
    if (!refreshableStatus || next.status !== 'awaiting-parent-consent' || next.check !== null) {
      fail('breeding.project.immutable-field', 'nextProject.parentRefs', 'parent revisions may refresh only by returning a pre-check project to awaiting consent.')
    }
  }

  if (next.timeline.initialAccumulatedCampaignMinutes < current.timeline.initialAccumulatedCampaignMinutes
    || next.timeline.additionalAccumulatedCampaignMinutes < current.timeline.additionalAccumulatedCampaignMinutes) {
    fail('breeding.project.invalid-transition', 'nextProject.timeline', 'project progress cannot decrease.')
  }
  nullableMonotonic(current.timeline.initialStartedAtCampaignMinute, next.timeline.initialStartedAtCampaignMinute, 'nextProject.timeline.initialStartedAtCampaignMinute')
  nullableMonotonic(current.timeline.checkReadyAtCampaignMinute, next.timeline.checkReadyAtCampaignMinute, 'nextProject.timeline.checkReadyAtCampaignMinute')
  nullableMonotonic(current.timeline.additionalStartedAtCampaignMinute, next.timeline.additionalStartedAtCampaignMinute, 'nextProject.timeline.additionalStartedAtCampaignMinute')
  nullableMonotonic(current.timeline.readyToProduceAtCampaignMinute, next.timeline.readyToProduceAtCampaignMinute, 'nextProject.timeline.readyToProduceAtCampaignMinute')
  nullableMonotonic(current.timeline.eggProducedAtCampaignMinute, next.timeline.eggProducedAtCampaignMinute, 'nextProject.timeline.eggProducedAtCampaignMinute')
  if (current.timeline.lastAppliedClockRevision !== null) {
    if (next.timeline.lastAppliedClockRevision === null
      || next.timeline.lastAppliedClockRevision < current.timeline.lastAppliedClockRevision!
      || next.timeline.lastAppliedClockMinute! < current.timeline.lastAppliedClockMinute!) {
      fail('breeding.project.invalid-transition', 'nextProject.timeline.lastAppliedClockRevision', 'campaign-clock checkpoints must be monotonic.')
    }
  }
  if (current.check && !sameJson(current.check, next.check)) {
    fail('breeding.project.immutable-field', 'nextProject.check', 'a persisted project check reference is immutable.')
  }
  if (current.producedEggId !== null && next.producedEggId !== current.producedEggId) {
    fail('breeding.project.immutable-field', 'nextProject.producedEggId', 'the produced Egg identity is immutable.')
  }
  return next
}
