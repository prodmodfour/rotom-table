import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingInitialProgressProjectionV1,
  parseBreedingInitialProgressSegmentAuthorityV1,
  type BreedingInitialProgressProjectionV1,
  type BreedingInitialProgressSegmentAuthorityV1,
} from '#shared/breeding/projectInitialProgress'
import {
  BREEDING_PROJECT_ADDITIONAL_REQUIRED_CAMPAIGN_MINUTES,
  BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES,
  parseBreedingProjectDocumentV1,
  type BreedingProjectDocumentV1,
} from '#shared/breeding/project'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import {
  parseAuthoritativeBreedingParentControlEvidenceV1,
} from './authorization'
import { createBreedingOperationCommandHash } from './operations'
import { validateBreedingProjectRevisionSuccessor } from './projectLifecycle'
import { parseAuthoritativeBreedingProjectSetupValidationV1 } from './projectSetupValidation'

export const BREEDING_INITIAL_PROGRESS_SEGMENT_PROVIDER_ID = 'breeding-initial-progress-segment-authority-v1' as const
export const BREEDING_INITIAL_PROGRESS_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-initial-progress-v1' as const,
  requiredCampaignMinutes: BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES,
  timeAuthority: 'campaign-clock' as const,
  accumulation: 'bounded-cumulative' as const,
  interruption: 'preserve-progress-and-skip-paused-segments' as const,
  completion: 'check-ready' as const,
})
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
export const BREEDING_INITIAL_PROGRESS_POLICY_DEFINITION_SHA256 = sha256(
  BREEDING_INITIAL_PROGRESS_POLICY_DEFINITION,
)

export type BreedingInitialProgressAuthorityErrorCode =
  | 'breeding.initial-progress.hash-mismatch'
  | 'breeding.initial-progress.stale-authority'
  | 'breeding.initial-progress.wrong-command'
  | 'breeding.initial-progress.unavailable'
export class BreedingInitialProgressAuthorityError extends Error {
  readonly code: BreedingInitialProgressAuthorityErrorCode
  constructor(code: BreedingInitialProgressAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingInitialProgressAuthorityError'
    this.code = code
  }
}
const fail = (code: BreedingInitialProgressAuthorityErrorCode, message: string): never => {
  throw new BreedingInitialProgressAuthorityError(code, message)
}
const withoutHash = <Value extends { readonly definitionSha256: string }>(
  value: Value,
): Omit<Value, 'definitionSha256'> => {
  const { definitionSha256: _hash, ...definition } = value
  return definition
}
export const breedingProjectDocumentDefinitionSha256 = (value: unknown): string => (
  sha256(parseBreedingProjectDocumentV1(value))
)
export const parseAuthoritativeBreedingInitialProgressSegmentAuthorityV1 = (
  value: unknown,
): BreedingInitialProgressSegmentAuthorityV1 => {
  const parsed = parseBreedingInitialProgressSegmentAuthorityV1(value)
  if (sha256(withoutHash(parsed)) !== parsed.definitionSha256) {
    return fail('breeding.initial-progress.hash-mismatch', 'Initial-progress segment authority hash does not match its exact definition.')
  }
  return parsed
}
export type BreedingInitialProgressSegmentAuthorityDefinitionV1 = Omit<
  BreedingInitialProgressSegmentAuthorityV1,
  'definitionSha256' | 'schemaVersion'
>
export const createBreedingInitialProgressSegmentAuthorityV1 = (
  value: BreedingInitialProgressSegmentAuthorityDefinitionV1,
): BreedingInitialProgressSegmentAuthorityV1 => {
  const definition = Object.freeze({ schemaVersion: 1 as const, ...value })
  return parseAuthoritativeBreedingInitialProgressSegmentAuthorityV1({
    ...definition,
    definitionSha256: sha256(definition),
  })
}

export const createBreedingProjectFromSetupValidationV1 = (input: {
  readonly command: unknown
  readonly setupValidation: unknown
  readonly parentControls: readonly [unknown, unknown]
  readonly campaignClockRevision: number
}): BreedingProjectDocumentV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'create-breeding-project') {
    return fail('breeding.initial-progress.wrong-command', 'Project creation requires create-breeding-project.')
  }
  const setup = parseAuthoritativeBreedingProjectSetupValidationV1(input.setupValidation)
  if (setup.status === 'unavailable' || (setup.status !== 'ready' && setup.status !== 'awaiting-consent')) {
    return fail('breeding.initial-progress.unavailable', 'Only ready or awaiting-consent setup authority may create a project.')
  }
  const commandHash = createBreedingOperationCommandHash(command)
  if (setup.operationId !== command.operationId || setup.commandSha256 !== commandHash
    || setup.commandKind !== command.commandKind
    || setup.campaignOptionSnapshotDefinitionSha256 !== command.payload.optionSnapshotDefinitionSha256) {
    return fail('breeding.initial-progress.stale-authority', 'Setup validation must bind the exact creation command and option snapshot.')
  }
  if (!Number.isSafeInteger(input.campaignClockRevision) || input.campaignClockRevision < 0
    || input.campaignClockRevision > 2_147_483_647) {
    return fail('breeding.initial-progress.stale-authority', 'Campaign clock revision must be a nonnegative bounded integer.')
  }
  const parents = input.parentControls.map((value, index) => {
    const control = parseAuthoritativeBreedingParentControlEvidenceV1(value, `parentControls[${index}]`)
    const commandParent = command.payload.parentRefs[index]!
    if (control.parentSheetSlug !== commandParent.pokemonSheetSlug
      || control.parentSheetRevision !== commandParent.expectedSheetRevision
      || control.evaluatedAtCampaignMinute !== setup.evaluatedAtCampaignMinute) {
      return fail('breeding.initial-progress.stale-authority', 'Parent controls must match both command-ordered creation revisions at the setup campaign minute.')
    }
    return Object.freeze({
      pokemonSheetSlug: control.parentSheetSlug,
      ownerTrainerSlug: control.ownerTrainerSlug,
      expectedSheetRevision: control.parentSheetRevision,
    })
  }) as unknown as BreedingProjectDocumentV1['parentRefs']
  const ready = setup.status === 'ready'
  return parseBreedingProjectDocumentV1({
    schemaVersion: 1,
    projectId: command.payload.projectId,
    revision: 0,
    status: ready ? 'initial-time-in-progress' : 'awaiting-parent-consent',
    ruleset: command.ruleset,
    projectCreationOptionSnapshotSha256: command.payload.optionSnapshotDefinitionSha256,
    ownerTrainerSlug: command.payload.ownerTrainerSlug,
    breederTrainerSlug: command.payload.breederTrainerSlug,
    parentRefs: parents,
    consentPolicy: command.payload.consentPolicy,
    timeline: {
      initialRequiredCampaignMinutes: BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES,
      initialAccumulatedCampaignMinutes: 0,
      additionalRequiredCampaignMinutes: BREEDING_PROJECT_ADDITIONAL_REQUIRED_CAMPAIGN_MINUTES,
      additionalAccumulatedCampaignMinutes: 0,
      initialStartedAtCampaignMinute: ready ? setup.evaluatedAtCampaignMinute : null,
      checkReadyAtCampaignMinute: null,
      additionalStartedAtCampaignMinute: null,
      readyToProduceAtCampaignMinute: null,
      eggProducedAtCampaignMinute: null,
      lastAppliedClockRevision: ready ? input.campaignClockRevision : null,
      lastAppliedClockMinute: ready ? setup.evaluatedAtCampaignMinute : null,
    },
    check: null,
    producedEggId: null,
    terminal: null,
    createdAtCampaignMinute: setup.evaluatedAtCampaignMinute,
    updatedAtCampaignMinute: setup.evaluatedAtCampaignMinute,
    statusChangedAtCampaignMinute: setup.evaluatedAtCampaignMinute,
    lastOperationId: command.operationId,
  })
}

const sameParentIdentities = (
  current: BreedingProjectDocumentV1['parentRefs'],
  proposed: BreedingInitialProgressSegmentAuthorityV1['parentRefs'],
): boolean => current.every((parent, index) => (
  parent.pokemonSheetSlug === proposed[index]!.pokemonSheetSlug
  && parent.ownerTrainerSlug === proposed[index]!.ownerTrainerSlug
))
const sameParentRefs = (
  current: BreedingProjectDocumentV1['parentRefs'],
  proposed: BreedingInitialProgressSegmentAuthorityV1['parentRefs'],
): boolean => sameParentIdentities(current, proposed) && current.every((parent, index) => (
  parent.expectedSheetRevision === proposed[index]!.expectedSheetRevision
))

export interface PlanBreedingInitialProgressResultV1 {
  readonly kind: 'unchanged' | 'updated'
  readonly project: BreedingProjectDocumentV1
}
export const planBreedingInitialProgressSegmentV1 = (input: {
  readonly project: unknown
  readonly command: unknown
  readonly segmentAuthority: unknown
}): PlanBreedingInitialProgressResultV1 => {
  const project = parseBreedingProjectDocumentV1(input.project)
  const command = parseBreedingOperationCommandV1(input.command)
  const segment = parseAuthoritativeBreedingInitialProgressSegmentAuthorityV1(input.segmentAuthority)
  if (command.commandKind !== 'advance-breeding-project-time') {
    return fail('breeding.initial-progress.wrong-command', 'Initial progress accepts only advance-breeding-project-time.')
  }
  const commandHash = createBreedingOperationCommandHash(command)
  const scope = command.scopes[0]
  if (scope?.kind !== 'breeding-project' || scope.projectId !== project.projectId
    || scope.expectedRevision !== project.revision || command.payload.projectId !== project.projectId
    || command.ruleset.rulesetId !== project.ruleset.rulesetId
    || command.ruleset.definitionSha256 !== project.ruleset.definitionSha256
    || segment.operationId !== command.operationId || segment.commandSha256 !== commandHash
    || segment.projectId !== project.projectId || segment.projectRevision !== project.revision
    || segment.projectDefinitionSha256 !== breedingProjectDocumentDefinitionSha256(project)
    || segment.throughClockRevision !== command.payload.throughClockRevision
    || segment.throughCampaignMinute !== command.payload.throughCampaignMinute
    || !sameParentIdentities(project.parentRefs, segment.parentRefs)) {
    return fail('breeding.initial-progress.stale-authority', 'Segment, command, scope, and exact current project authority must match.')
  }
  if (project.status !== 'draft' && project.status !== 'awaiting-parent-consent'
    && project.status !== 'initial-time-in-progress' && project.status !== 'check-ready') {
    return fail('breeding.initial-progress.unavailable', 'Initial progress is unavailable after the check phase or terminal settlement.')
  }
  if (segment.throughCampaignMinute < project.updatedAtCampaignMinute
    || (project.timeline.lastAppliedClockRevision !== null
      && (segment.throughClockRevision < project.timeline.lastAppliedClockRevision
        || segment.throughCampaignMinute < project.timeline.lastAppliedClockMinute!))) {
    return fail('breeding.initial-progress.stale-authority', 'Campaign clock segment cannot move backward from the durable Project checkpoint.')
  }
  if (project.timeline.lastAppliedClockRevision !== null
    && segment.throughClockRevision === project.timeline.lastAppliedClockRevision
    && segment.throughCampaignMinute !== project.timeline.lastAppliedClockMinute) {
    return fail('breeding.initial-progress.stale-authority', 'One campaign-clock revision cannot identify a different campaign minute.')
  }
  const parentRevisionRegressed = project.parentRefs.some((parent, index) => (
    segment.parentRefs[index]!.expectedSheetRevision < parent.expectedSheetRevision
  ))
  if (parentRevisionRegressed) {
    return fail('breeding.initial-progress.stale-authority', 'Parent revisions cannot move backward at an interruption checkpoint.')
  }
  if (segment.mode === 'accrue' && !sameParentRefs(project.parentRefs, segment.parentRefs)) {
    return fail('breeding.initial-progress.stale-authority', 'Accrual requires unchanged current parent revisions; revision drift must interrupt first.')
  }
  const previousCheckpoint = project.timeline.lastAppliedClockMinute
  if (segment.interruptedAtCampaignMinute !== null
    && segment.interruptedAtCampaignMinute < (previousCheckpoint ?? project.updatedAtCampaignMinute)) {
    return fail('breeding.initial-progress.stale-authority', 'Interruption cannot predate the durable Project checkpoint.')
  }

  if (project.status === 'check-ready' && segment.mode === 'accrue' && sameParentRefs(project.parentRefs, segment.parentRefs)) {
    return Object.freeze({ kind: 'unchanged', project })
  }

  let accumulated = project.timeline.initialAccumulatedCampaignMinutes
  let initialStartedAt = project.timeline.initialStartedAtCampaignMinute
  let checkReadyAt = project.timeline.checkReadyAtCampaignMinute
  let lastClockRevision = project.timeline.lastAppliedClockRevision
  let lastClockMinute = project.timeline.lastAppliedClockMinute
  let nextStatus: BreedingProjectDocumentV1['status'] = project.status

  if (segment.mode === 'interrupt') {
    if (previousCheckpoint !== null && project.status === 'initial-time-in-progress') {
      const accrualThrough = segment.interruptedAtCampaignMinute!
      const elapsed = accrualThrough - previousCheckpoint
      const remaining = BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES - accumulated
      const credited = Math.min(elapsed, remaining)
      if (credited > 0) {
        accumulated += credited
        if (accumulated === BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES) {
          checkReadyAt = previousCheckpoint + remaining
        }
      }
    }
    nextStatus = 'awaiting-parent-consent'
    if (initialStartedAt !== null) {
      lastClockRevision = segment.throughClockRevision
      lastClockMinute = segment.throughCampaignMinute
    }
  }
  else if (project.status === 'draft' || project.status === 'awaiting-parent-consent') {
    if (initialStartedAt === null) initialStartedAt = segment.throughCampaignMinute
    lastClockRevision = segment.throughClockRevision
    lastClockMinute = segment.throughCampaignMinute
    nextStatus = accumulated === BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES
      ? 'check-ready'
      : 'initial-time-in-progress'
  }
  else if (project.status === 'initial-time-in-progress') {
    if (previousCheckpoint === null || initialStartedAt === null) {
      return fail('breeding.initial-progress.stale-authority', 'Started initial progress must retain its prior campaign-clock checkpoint.')
    }
    const elapsed = segment.throughCampaignMinute - previousCheckpoint
    const remaining = BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES - accumulated
    const credited = Math.min(elapsed, remaining)
    accumulated += credited
    if (accumulated === BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES) {
      checkReadyAt = previousCheckpoint + remaining
      nextStatus = 'check-ready'
    }
    lastClockRevision = segment.throughClockRevision
    lastClockMinute = segment.throughCampaignMinute
  }

  const parentChanged = !sameParentRefs(project.parentRefs, segment.parentRefs)
  const clockChanged = lastClockRevision !== project.timeline.lastAppliedClockRevision
    || lastClockMinute !== project.timeline.lastAppliedClockMinute
  const stateChanged = parentChanged || clockChanged || accumulated !== project.timeline.initialAccumulatedCampaignMinutes
    || initialStartedAt !== project.timeline.initialStartedAtCampaignMinute
    || checkReadyAt !== project.timeline.checkReadyAtCampaignMinute || nextStatus !== project.status
  if (!stateChanged) return Object.freeze({ kind: 'unchanged', project })

  const next = parseBreedingProjectDocumentV1({
    ...project,
    revision: project.revision + 1,
    status: nextStatus,
    parentRefs: segment.parentRefs,
    timeline: {
      ...project.timeline,
      initialAccumulatedCampaignMinutes: accumulated,
      initialStartedAtCampaignMinute: initialStartedAt,
      checkReadyAtCampaignMinute: checkReadyAt,
      lastAppliedClockRevision: lastClockRevision,
      lastAppliedClockMinute: lastClockMinute,
    },
    updatedAtCampaignMinute: segment.throughCampaignMinute,
    statusChangedAtCampaignMinute: nextStatus === project.status
      ? project.statusChangedAtCampaignMinute
      : segment.throughCampaignMinute,
    lastOperationId: command.operationId,
  })
  return Object.freeze({
    kind: 'updated',
    project: validateBreedingProjectRevisionSuccessor(project, next),
  })
}

export const projectBreedingInitialProgressV1 = (input: {
  readonly project: unknown
  readonly audience: 'gm' | 'owner'
}): BreedingInitialProgressProjectionV1 => {
  const project = parseBreedingProjectDocumentV1(input.project)
  if (project.status !== 'awaiting-parent-consent' && project.status !== 'check-ready'
    && project.status !== 'initial-time-in-progress') {
    return fail('breeding.initial-progress.unavailable', 'Initial-progress projection is unavailable outside its three project states.')
  }
  return parseBreedingInitialProgressProjectionV1({
    schemaVersion: 1,
    audience: input.audience,
    status: project.status,
    initialRequiredCampaignMinutes: BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES,
    initialAccumulatedCampaignMinutes: project.timeline.initialAccumulatedCampaignMinutes,
    initialRemainingCampaignMinutes: BREEDING_PROJECT_INITIAL_REQUIRED_CAMPAIGN_MINUTES
      - project.timeline.initialAccumulatedCampaignMinutes,
    interrupted: project.status === 'awaiting-parent-consent',
    checkReadyAtCampaignMinute: project.timeline.checkReadyAtCampaignMinute,
  })
}
