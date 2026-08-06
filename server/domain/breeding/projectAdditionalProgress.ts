import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingAdditionalProgressProjectionV1,
  parseBreedingAdditionalProgressSegmentAuthorityV1,
  type BreedingAdditionalProgressProjectionV1,
  type BreedingAdditionalProgressSegmentAuthorityV1,
} from '#shared/breeding/projectAdditionalProgress'
import type { BreedingCheckRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1 } from '#shared/breeding/operations'
import {
  BREEDING_PROJECT_ADDITIONAL_REQUIRED_CAMPAIGN_MINUTES,
  parseBreedingProjectDocumentV1,
  type BreedingProjectDocumentV1,
} from '#shared/breeding/project'
import { parseAuthoritativeBreedingCheckRecordV1 } from './ledgers'
import { createBreedingOperationCommandHash } from './operations'
import { breedingProjectDocumentDefinitionSha256 } from './projectInitialProgress'
import { validateBreedingProjectRevisionSuccessor } from './projectLifecycle'

export const BREEDING_ADDITIONAL_PROGRESS_SEGMENT_PROVIDER_ID = 'breeding-additional-progress-segment-authority-v1' as const
export const BREEDING_ADDITIONAL_PROGRESS_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-additional-progress-v1' as const,
  requiredCampaignMinutes: BREEDING_PROJECT_ADDITIONAL_REQUIRED_CAMPAIGN_MINUTES,
  timeAuthority: 'campaign-clock' as const,
  accumulation: 'bounded-cumulative-authorized-segments' as const,
  skippedIntervals: 'explicit-credited-from-checkpoint' as const,
  completion: 'ready-to-produce' as const,
})
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
export const BREEDING_ADDITIONAL_PROGRESS_POLICY_DEFINITION_SHA256 = sha256(
  BREEDING_ADDITIONAL_PROGRESS_POLICY_DEFINITION,
)

export type BreedingAdditionalProgressAuthorityErrorCode =
  | 'breeding.additional-progress.hash-mismatch'
  | 'breeding.additional-progress.stale-authority'
  | 'breeding.additional-progress.unavailable'
  | 'breeding.additional-progress.wrong-command'
export class BreedingAdditionalProgressAuthorityError extends Error {
  readonly code: BreedingAdditionalProgressAuthorityErrorCode
  constructor(code: BreedingAdditionalProgressAuthorityErrorCode, message: string) {
    super(message)
    this.name = 'BreedingAdditionalProgressAuthorityError'
    this.code = code
  }
}
const fail = (code: BreedingAdditionalProgressAuthorityErrorCode, message: string): never => {
  throw new BreedingAdditionalProgressAuthorityError(code, message)
}
const withoutHash = <Value extends { readonly definitionSha256: string }>(value: Value): Omit<Value, 'definitionSha256'> => {
  const { definitionSha256: _hash, ...definition } = value
  return definition
}
export const parseAuthoritativeBreedingAdditionalProgressSegmentAuthorityV1 = (
  value: unknown,
): BreedingAdditionalProgressSegmentAuthorityV1 => {
  const parsed = parseBreedingAdditionalProgressSegmentAuthorityV1(value)
  if (sha256(withoutHash(parsed)) !== parsed.definitionSha256) {
    return fail('breeding.additional-progress.hash-mismatch', 'Additional-progress segment authority hash does not match its exact definition.')
  }
  return parsed
}
export type BreedingAdditionalProgressSegmentAuthorityDefinitionV1 = Omit<
  BreedingAdditionalProgressSegmentAuthorityV1,
  'definitionSha256' | 'schemaVersion'
>
export const createBreedingAdditionalProgressSegmentAuthorityV1 = (
  value: BreedingAdditionalProgressSegmentAuthorityDefinitionV1,
): BreedingAdditionalProgressSegmentAuthorityV1 => {
  const definition = Object.freeze({ schemaVersion: 1 as const, ...value })
  return parseAuthoritativeBreedingAdditionalProgressSegmentAuthorityV1({
    ...definition,
    definitionSha256: sha256(definition),
  })
}
const sameParentRefs = (
  project: BreedingProjectDocumentV1,
  segment: BreedingAdditionalProgressSegmentAuthorityV1,
): boolean => project.parentRefs.every((parent, index) => (
  parent.pokemonSheetSlug === segment.parentRefs[index]!.pokemonSheetSlug
  && parent.ownerTrainerSlug === segment.parentRefs[index]!.ownerTrainerSlug
  && parent.expectedSheetRevision === segment.parentRefs[index]!.expectedSheetRevision
))

export interface PlanBreedingAdditionalProgressResultV1 {
  readonly kind: 'unchanged' | 'updated'
  readonly project: BreedingProjectDocumentV1
}
export const planBreedingAdditionalProgressSegmentV1 = (input: {
  readonly project: unknown
  readonly check: unknown
  readonly command: unknown
  readonly segmentAuthority: unknown
}): PlanBreedingAdditionalProgressResultV1 => {
  const project = parseBreedingProjectDocumentV1(input.project)
  const check = parseAuthoritativeBreedingCheckRecordV1(input.check)
  const command = parseBreedingOperationCommandV1(input.command)
  const segment = parseAuthoritativeBreedingAdditionalProgressSegmentAuthorityV1(input.segmentAuthority)
  if (command.commandKind !== 'advance-breeding-project-time') {
    return fail('breeding.additional-progress.wrong-command', 'Additional progress accepts only advance-breeding-project-time.')
  }
  const commandSha256 = createBreedingOperationCommandHash(command)
  const scope = command.scopes[0]
  if (scope?.kind !== 'breeding-project' || scope.projectId !== project.projectId
    || scope.expectedRevision !== project.revision || command.payload.projectId !== project.projectId
    || command.ruleset.rulesetId !== project.ruleset.rulesetId
    || command.ruleset.definitionSha256 !== project.ruleset.definitionSha256
    || segment.operationId !== command.operationId || segment.commandSha256 !== commandSha256
    || segment.projectId !== project.projectId || segment.projectRevision !== project.revision
    || segment.projectDefinitionSha256 !== breedingProjectDocumentDefinitionSha256(project)
    || segment.throughClockRevision !== command.payload.throughClockRevision
    || segment.throughCampaignMinute !== command.payload.throughCampaignMinute
    || !sameParentRefs(project, segment)) {
    return fail('breeding.additional-progress.stale-authority', 'Segment, command, ruleset, parents, scope, and exact current Project authority must match.')
  }
  if (project.status !== 'additional-time-in-progress' && project.status !== 'ready-to-produce') {
    return fail('breeding.additional-progress.unavailable', 'Additional progress requires one successful check and an active additional-time phase.')
  }
  if (project.check?.checkRecordId !== check.checkRecordId || project.check.outcome !== 'success'
    || project.check.resolvedAtCampaignMinute !== check.resolvedAtCampaignMinute
    || check.projectId !== project.projectId || check.outcome !== 'success'
    || project.timeline.additionalStartedAtCampaignMinute === null
    || project.timeline.lastAppliedClockRevision === null
    || project.timeline.lastAppliedClockMinute === null) {
    return fail('breeding.additional-progress.stale-authority', 'Project must retain its exact successful check and additional-time start checkpoint.')
  }
  const previousCheckpoint = project.timeline.lastAppliedClockMinute
  if (segment.throughClockRevision < project.timeline.lastAppliedClockRevision
    || segment.throughCampaignMinute < previousCheckpoint
    || segment.creditedFromCampaignMinute < previousCheckpoint
    || (segment.throughClockRevision === project.timeline.lastAppliedClockRevision
      && segment.throughCampaignMinute !== previousCheckpoint)) {
    return fail('breeding.additional-progress.stale-authority', 'Additional segment cannot move backward or reinterpret one campaign-clock revision.')
  }
  if (project.status === 'ready-to-produce') return Object.freeze({ kind: 'unchanged', project })
  const remaining = BREEDING_PROJECT_ADDITIONAL_REQUIRED_CAMPAIGN_MINUTES
    - project.timeline.additionalAccumulatedCampaignMinutes
  const credited = Math.min(segment.throughCampaignMinute - segment.creditedFromCampaignMinute, remaining)
  const accumulated = project.timeline.additionalAccumulatedCampaignMinutes + credited
  const readyAt = accumulated === BREEDING_PROJECT_ADDITIONAL_REQUIRED_CAMPAIGN_MINUTES
    ? segment.creditedFromCampaignMinute + remaining
    : null
  const nextStatus = readyAt === null ? 'additional-time-in-progress' as const : 'ready-to-produce' as const
  const clockChanged = segment.throughClockRevision !== project.timeline.lastAppliedClockRevision
    || segment.throughCampaignMinute !== previousCheckpoint
  if (!clockChanged && credited === 0) return Object.freeze({ kind: 'unchanged', project })
  const next = parseBreedingProjectDocumentV1({
    ...project,
    revision: project.revision + 1,
    status: nextStatus,
    timeline: {
      ...project.timeline,
      additionalAccumulatedCampaignMinutes: accumulated,
      readyToProduceAtCampaignMinute: readyAt,
      lastAppliedClockRevision: segment.throughClockRevision,
      lastAppliedClockMinute: segment.throughCampaignMinute,
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

export const projectBreedingAdditionalProgressV1 = (input: {
  readonly project: unknown
  readonly check: unknown
  readonly audience: 'gm' | 'owner'
}): BreedingAdditionalProgressProjectionV1 => {
  const project = parseBreedingProjectDocumentV1(input.project)
  const check = parseAuthoritativeBreedingCheckRecordV1(input.check)
  if ((project.status !== 'additional-time-in-progress' && project.status !== 'ready-to-produce')
    || project.check?.checkRecordId !== check.checkRecordId || check.outcome !== 'success') {
    return fail('breeding.additional-progress.unavailable', 'Additional-progress projection requires the exact successful Project check.')
  }
  return parseBreedingAdditionalProgressProjectionV1({
    schemaVersion: 1,
    audience: input.audience,
    status: project.status,
    additionalRequiredCampaignMinutes: BREEDING_PROJECT_ADDITIONAL_REQUIRED_CAMPAIGN_MINUTES,
    additionalAccumulatedCampaignMinutes: project.timeline.additionalAccumulatedCampaignMinutes,
    additionalRemainingCampaignMinutes: BREEDING_PROJECT_ADDITIONAL_REQUIRED_CAMPAIGN_MINUTES
      - project.timeline.additionalAccumulatedCampaignMinutes,
    readyToProduceAtCampaignMinute: project.timeline.readyToProduceAtCampaignMinute,
  })
}

export const assertSuccessfulBreedingCheckForAdditionalProgress = (
  project: BreedingProjectDocumentV1,
  check: BreedingCheckRecordV1,
): BreedingCheckRecordV1 => {
  if (project.check?.checkRecordId !== check.checkRecordId || check.projectId !== project.projectId
    || project.check.outcome !== 'success' || check.outcome !== 'success') {
    return fail('breeding.additional-progress.stale-authority', 'Additional progress requires one exact persisted successful check.')
  }
  return check
}
