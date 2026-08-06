import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingProjectLifecycleControlProjectionV1,
  parseBreedingOperationRecoveryProjectionV1,
  type BreedingLifecycleConsentStatus,
  type BreedingOperationRecoveryProjectionV1,
  type BreedingProjectLifecycleControlAudience,
  type BreedingProjectLifecycleControlProjectionV1,
  type BreedingRecoveryAction,
} from '#shared/breeding/lifecycleRecovery'
import type { BreedingConsentRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import {
  BREEDING_PROJECT_ACTIVE_STATUSES,
  parseBreedingProjectDocumentV1,
  type BreedingProjectDocumentV1,
  type BreedingProjectTerminalStatus,
} from '#shared/breeding/project'
import { createBreedingConsentRevisionV1, parseAuthoritativeBreedingConsentRecordV1, validateBreedingConsentSuccessor } from './ledgers'
import { validateBreedingProjectRevisionSuccessor } from './projectLifecycle'
import type { BreedingOperationLedgerRecord } from '../../storage/breedingOperationRepository'

export const BREEDING_PROJECT_TERMINATION_REASON_TO_STATUS = Object.freeze({
  'breeding.project-terminal.cancelled': 'cancelled',
  'breeding.project-terminal.consent-expired': 'expired',
  'breeding.project-terminal.abandoned': 'abandoned',
  'breeding.project-terminal.conflicted': 'conflicted',
} as const)
export type BreedingProjectTerminationReasonId = keyof typeof BREEDING_PROJECT_TERMINATION_REASON_TO_STATUS
export const BREEDING_CONSENT_SETTLEMENT_REASONS = Object.freeze({
  'breeding.consent.revoked': 'revoked',
  'breeding.consent.expired': 'expired',
} as const)
export type BreedingConsentSettlementReasonId = keyof typeof BREEDING_CONSENT_SETTLEMENT_REASONS
export type BreedingLifecycleRecoveryAuthorityErrorCode =
  | 'breeding.lifecycle-recovery.invalid-transition'
  | 'breeding.lifecycle-recovery.stale-authority'
  | 'breeding.lifecycle-recovery.unavailable'
  | 'breeding.lifecycle-recovery.wrong-command'
export class BreedingLifecycleRecoveryAuthorityError extends Error {
  readonly code: BreedingLifecycleRecoveryAuthorityErrorCode
  readonly path: string
  constructor(code: BreedingLifecycleRecoveryAuthorityErrorCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingLifecycleRecoveryAuthorityError'
    this.code = code
    this.path = path
  }
}
const fail = (code: BreedingLifecycleRecoveryAuthorityErrorCode, path: string, message: string): never => { throw new BreedingLifecycleRecoveryAuthorityError(code, path, message) }
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const activeStatuses = new Set<string>(BREEDING_PROJECT_ACTIVE_STATUSES)

export const planBreedingProjectTerminationV1 = (input: {
  readonly command: unknown
  readonly project: unknown
  readonly campaignMinute: number
  readonly expiredConsentEvidence: readonly unknown[]
}): BreedingProjectDocumentV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'cancel-breeding-project') return fail('breeding.lifecycle-recovery.wrong-command', 'command.commandKind', 'project termination requires cancel-breeding-project.')
  const project = parseBreedingProjectDocumentV1(input.project)
  const status = BREEDING_PROJECT_TERMINATION_REASON_TO_STATUS[command.payload.reasonId as BreedingProjectTerminationReasonId]
  if (!status) return fail('breeding.lifecycle-recovery.unavailable', 'command.payload.reasonId', 'must be a closed Project termination reason.')
  if (command.payload.projectId !== project.projectId || !activeStatuses.has(project.status) || input.campaignMinute < project.updatedAtCampaignMinute) return fail('breeding.lifecycle-recovery.invalid-transition', 'project', 'must be the current active Project at a monotonic campaign minute.')
  const scope = command.scopes.find(value => value.kind === 'breeding-project')
  if (!scope || scope.kind !== 'breeding-project' || scope.projectId !== project.projectId || scope.expectedRevision !== project.revision) return fail('breeding.lifecycle-recovery.stale-authority', 'command.scopes', 'must claim the exact current Project revision.')
  if (!Array.isArray(input.expiredConsentEvidence) || input.expiredConsentEvidence.length > 2) return fail('breeding.lifecycle-recovery.stale-authority', 'expiredConsentEvidence', 'must contain at most the two Project-parent consent records.')
  const expired = input.expiredConsentEvidence.map((value, index) => parseAuthoritativeBreedingConsentRecordV1(value, `expiredConsentEvidence[${index}]`))
  if (status === 'expired') {
    if (project.consentPolicy !== 'cross-owner-current-revision-consent' || expired.length < 1 || expired.some(consent => consent.projectId !== project.projectId || consent.status !== 'active' || consent.expiresAtCampaignMinute === null || input.campaignMinute < consent.expiresAtCampaignMinute)) return fail('breeding.lifecycle-recovery.stale-authority', 'expiredConsentEvidence', 'expired termination requires a current Project consent whose expiry has been reached.')
  } else if (expired.length !== 0) return fail('breeding.lifecycle-recovery.stale-authority', 'expiredConsentEvidence', 'non-expiry termination cannot carry consent-expiry authority.')
  const next = parseBreedingProjectDocumentV1({
    ...project,
    revision: project.revision + 1,
    status,
    terminal: { reasonId: command.payload.reasonId, atCampaignMinute: input.campaignMinute, operationId: command.operationId },
    updatedAtCampaignMinute: input.campaignMinute,
    statusChangedAtCampaignMinute: input.campaignMinute,
    lastOperationId: command.operationId,
  })
  return validateBreedingProjectRevisionSuccessor(project, next)
}

export const planBreedingConsentSettlementV1 = (input: {
  readonly command: unknown
  readonly project: unknown
  readonly consent: unknown
  readonly campaignMinute: number
}): BreedingConsentRecordV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'revoke-breeding-consent') return fail('breeding.lifecycle-recovery.wrong-command', 'command.commandKind', 'consent settlement requires revoke-breeding-consent.')
  const project = parseBreedingProjectDocumentV1(input.project)
  const consent = parseAuthoritativeBreedingConsentRecordV1(input.consent)
  const status = BREEDING_CONSENT_SETTLEMENT_REASONS[command.payload.reasonId as BreedingConsentSettlementReasonId]
  if (!status) return fail('breeding.lifecycle-recovery.unavailable', 'command.payload.reasonId', 'must be a closed consent settlement reason.')
  if (command.payload.projectId !== project.projectId || command.payload.consentId !== consent.consentId || consent.projectId !== project.projectId || consent.status !== 'active' || input.campaignMinute < consent.grantedAtCampaignMinute || input.campaignMinute < project.updatedAtCampaignMinute) return fail('breeding.lifecycle-recovery.invalid-transition', 'consent', 'must settle the exact active consent at a monotonic campaign minute.')
  const consentScope = command.scopes.find(value => value.kind === 'parent-consent')
  const projectScope = command.scopes.find(value => value.kind === 'breeding-project')
  if (!consentScope || consentScope.kind !== 'parent-consent' || consentScope.consentId !== consent.consentId || consentScope.expectedRevision !== consent.revision || !projectScope || projectScope.kind !== 'breeding-project' || projectScope.projectId !== project.projectId || projectScope.expectedRevision !== project.revision) return fail('breeding.lifecycle-recovery.stale-authority', 'command.scopes', 'must claim exact current Project and consent revisions.')
  const expired = consent.expiresAtCampaignMinute !== null && input.campaignMinute >= consent.expiresAtCampaignMinute
  if ((status === 'expired') !== expired) return fail('breeding.lifecycle-recovery.stale-authority', 'command.payload.reasonId', 'expiry settles at or after equality; an unexpired active grant is explicitly revoked.')
  const next = createBreedingConsentRevisionV1({
    ...consent,
    revision: consent.revision + 1,
    status,
    settledAtCampaignMinute: input.campaignMinute,
    settlementOperationId: command.operationId,
    settlementCommandSha256: sha256(command),
    settlementReasonId: command.payload.reasonId,
  })
  return validateBreedingConsentSuccessor(consent, next)
}

export const planBreedingProjectConsentCheckpointV1 = (input: {
  readonly command: unknown
  readonly project: unknown
  readonly campaignMinute: number
}): BreedingProjectDocumentV1 => {
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'revoke-breeding-consent') return fail('breeding.lifecycle-recovery.wrong-command', 'command.commandKind', 'consent checkpoint requires revoke-breeding-consent.')
  const project = parseBreedingProjectDocumentV1(input.project)
  if (command.payload.projectId !== project.projectId || input.campaignMinute < project.updatedAtCampaignMinute) return fail('breeding.lifecycle-recovery.invalid-transition', 'project', 'must checkpoint the exact Project at a monotonic minute.')
  if (!activeStatuses.has(project.status)) return project
  const next = parseBreedingProjectDocumentV1({ ...project, revision: project.revision + 1, updatedAtCampaignMinute: input.campaignMinute, lastOperationId: command.operationId })
  return validateBreedingProjectRevisionSuccessor(project, next)
}

export const projectBreedingLifecycleControlV1 = (input: {
  readonly command: BreedingOperationCommandV1
  readonly project: BreedingProjectDocumentV1
  readonly consentStatus: BreedingLifecycleConsentStatus | null
  readonly projectRevision?: number
  readonly audience: BreedingProjectLifecycleControlAudience
  readonly completedAtCampaignMinute: number
}): BreedingProjectLifecycleControlProjectionV1 => {
  if (input.command.commandKind !== 'cancel-breeding-project' && input.command.commandKind !== 'revoke-breeding-consent') return fail('breeding.lifecycle-recovery.wrong-command', 'command.commandKind', 'cannot project another command kind.')
  const terminalStatus = input.command.commandKind === 'cancel-breeding-project' ? input.project.status as BreedingProjectTerminalStatus : null
  return parseBreedingProjectLifecycleControlProjectionV1({ schemaVersion: 1, audience: input.audience, operationKind: input.command.commandKind, projectId: input.project.projectId, projectRevision: input.projectRevision ?? input.project.revision, projectStatus: input.command.commandKind === 'cancel-breeding-project' ? input.project.status : null, mutation: input.command.commandKind === 'cancel-breeding-project' ? 'project-terminal' : 'consent-settled', terminalStatus, consentStatus: input.consentStatus, completedAtCampaignMinute: input.completedAtCampaignMinute })
}

const operationRecoveryResourceDefinition = (record: BreedingOperationLedgerRecord, asPending = false) => ({
  operationId: record.operationId,
  commandHash: record.commandHash,
  commandKind: record.command.commandKind,
  status: asPending ? 'pending' : record.status,
  resultDefinitionSha256: asPending ? null : record.result?.resultDefinitionSha256 ?? null,
  createdAtCampaignMinute: record.createdAtCampaignMinute,
  settledAtCampaignMinute: asPending ? null : record.settledAtCampaignMinute,
})
export const breedingOperationRecoveryResourceDefinitionSha256 = (record: BreedingOperationLedgerRecord): string => sha256(operationRecoveryResourceDefinition(record))
export const breedingPendingOperationRecoveryResourceDefinitionSha256 = (record: BreedingOperationLedgerRecord): string => sha256(operationRecoveryResourceDefinition(record, true))
export const projectBreedingOperationRecoveryV1 = (input: {
  readonly recoveryOperationId: BreedingOperationRecoveryProjectionV1['recoveryOperationId']
  readonly targetOperationId: BreedingOperationRecoveryProjectionV1['targetOperationId']
  readonly action: BreedingRecoveryAction
  readonly executionStatus: 'pending' | 'accepted' | 'rejected'
  readonly completedAtCampaignMinute: number | null
}): BreedingOperationRecoveryProjectionV1 => parseBreedingOperationRecoveryProjectionV1({
  schemaVersion: 1,
  audience: 'gm',
  recoveryOperationId: input.recoveryOperationId,
  targetOperationId: input.targetOperationId,
  action: input.action,
  executionStatus: input.executionStatus,
  disposition: input.executionStatus === 'pending' ? 'pending' : input.executionStatus === 'rejected' ? 'rejected' : input.action === 'inspect' ? 'inspected' : input.action === 'resume' ? 'resumed' : input.action === 'abandon' ? 'abandoned' : 'publication-retry-requested',
  targetTerminal: input.executionStatus === 'accepted' && input.action !== 'inspect' ? true : null,
  completedAtCampaignMinute: input.executionStatus === 'pending' ? null : input.completedAtCampaignMinute,
})
