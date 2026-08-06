import {
  BREEDING_OPERATION_COMMAND_KINDS,
  type BreedingOperationCommandKind,
} from './operations'
import {
  parseBreedingOperationIdSyntax,
  parseBreedingProjectIdSyntax,
  type BreedingOperationId,
  type BreedingProjectId,
} from './ids'
import type { BreedingProjectStatus, BreedingProjectTerminalStatus } from './project'

export const BREEDING_PROJECT_LIFECYCLE_CONTROL_AUDIENCES = Object.freeze(['gm', 'owner', 'participating-owner'] as const)
export type BreedingProjectLifecycleControlAudience = typeof BREEDING_PROJECT_LIFECYCLE_CONTROL_AUDIENCES[number]
export type BreedingLifecycleControlCommandKind = 'revoke-breeding-consent' | 'cancel-breeding-project'
export type BreedingLifecycleControlMutation = 'consent-settled' | 'project-terminal'
export type BreedingLifecycleConsentStatus = 'revoked' | 'expired'
export const BREEDING_RECOVERY_ACTIONS = Object.freeze(['inspect', 'resume', 'abandon', 'retry-publication'] as const)
export type BreedingRecoveryAction = typeof BREEDING_RECOVERY_ACTIONS[number]
export type BreedingRecoveryExecutionStatus = 'pending' | 'accepted' | 'rejected'
export type BreedingRecoveryDisposition = 'pending' | 'inspected' | 'resumed' | 'abandoned' | 'publication-retry-requested' | 'rejected'

export interface BreedingProjectLifecycleControlProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: BreedingProjectLifecycleControlAudience
  readonly operationKind: BreedingLifecycleControlCommandKind
  readonly projectId: BreedingProjectId
  readonly projectRevision: number
  readonly projectStatus: BreedingProjectStatus | null
  readonly mutation: BreedingLifecycleControlMutation
  readonly terminalStatus: BreedingProjectTerminalStatus | null
  readonly consentStatus: BreedingLifecycleConsentStatus | null
  readonly completedAtCampaignMinute: number
}
export interface BreedingOperationRecoveryProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm'
  readonly recoveryOperationId: BreedingOperationId
  readonly targetOperationId: BreedingOperationId
  readonly action: BreedingRecoveryAction
  readonly executionStatus: BreedingRecoveryExecutionStatus
  readonly disposition: BreedingRecoveryDisposition
  readonly targetTerminal: boolean | null
  readonly completedAtCampaignMinute: number | null
}
export interface BreedingPendingOperationSummaryV1 {
  readonly operationId: BreedingOperationId
  readonly commandKind: BreedingOperationCommandKind
  readonly createdAtCampaignMinute: number
  readonly authorityEvidencePresent: boolean
  readonly persistedRollCount: number
}
export interface BreedingRecoveryReconnectSnapshotV1 {
  readonly schemaVersion: 1
  readonly audience: 'gm'
  readonly campaignClockRevision: number
  readonly campaignMinute: number
  readonly pendingOperations: readonly BreedingPendingOperationSummaryV1[]
}

export type BreedingLifecycleRecoveryValidationCode =
  | 'breeding.lifecycle-recovery.invalid-document'
  | 'breeding.lifecycle-recovery.unknown-field'
  | 'breeding.lifecycle-recovery.invalid-id'
  | 'breeding.lifecycle-recovery.invalid-invariant'
export class BreedingLifecycleRecoveryValidationError extends Error {
  readonly code: BreedingLifecycleRecoveryValidationCode
  readonly path: string
  constructor(code: BreedingLifecycleRecoveryValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'BreedingLifecycleRecoveryValidationError'
    this.code = code
    this.path = path
  }
}
type UnknownRecord = Record<string, unknown>
const PROJECT_STATUSES = new Set<string>(['draft', 'awaiting-parent-consent', 'initial-time-in-progress', 'check-ready', 'additional-time-in-progress', 'ready-to-produce', 'egg-produced', 'check-failed', 'cancelled', 'expired', 'abandoned', 'conflicted'])
const TERMINAL_STATUSES = new Set<string>(['check-failed', 'cancelled', 'expired', 'abandoned', 'conflicted'])
const COMMAND_KINDS = new Set<string>(BREEDING_OPERATION_COMMAND_KINDS)
const AUDIENCES = new Set<string>(BREEDING_PROJECT_LIFECYCLE_CONTROL_AUDIENCES)
const ACTIONS = new Set<string>(BREEDING_RECOVERY_ACTIONS)
const fail = (code: BreedingLifecycleRecoveryValidationCode, path: string, message: string): never => { throw new BreedingLifecycleRecoveryValidationError(code, path, message) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('breeding.lifecycle-recovery.invalid-document', path, 'must be a plain object.')
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.lifecycle-recovery.invalid-document', path, 'must be a plain data object without symbols.')
  for (const key of Object.getOwnPropertyNames(value)) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.lifecycle-recovery.invalid-document', `${path}.${key}`, 'must be an enumerable data field.') }
  return value as UnknownRecord
}
const exact = (value: unknown, fields: readonly string[], path: string): UnknownRecord => {
  const row = record(value, path); const expected = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !expected.has(field))) fail('breeding.lifecycle-recovery.unknown-field', path, 'must contain exactly the declared fields.')
  return row
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum ? value as number : fail('breeding.lifecycle-recovery.invalid-document', path, `must be a nonnegative safe integer through ${maximum}.`)
const bool = (value: unknown, path: string): boolean => typeof value === 'boolean' ? value : fail('breeding.lifecycle-recovery.invalid-document', path, 'must be boolean.')
const array = (value: unknown, path: string, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.lifecycle-recovery.invalid-document', path, `must be an array of at most ${maximum} entries.`)
  for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) fail('breeding.lifecycle-recovery.invalid-document', `${path}[${index}]`, 'must be an enumerable data entry.') }
  if (Object.keys(value).some(key => !/^(0|[1-9][0-9]*)$/.test(key))) fail('breeding.lifecycle-recovery.unknown-field', path, 'cannot contain enriched fields.')
  return value
}
const operationId = (value: unknown, path: string): BreedingOperationId => parseBreedingOperationIdSyntax(value) ?? fail('breeding.lifecycle-recovery.invalid-id', path, 'must be a breeding operation ID.')
const projectId = (value: unknown, path: string): BreedingProjectId => parseBreedingProjectIdSyntax(value) ?? fail('breeding.lifecycle-recovery.invalid-id', path, 'must be a breeding project ID.')
const freeze = <Value>(value: Value): Value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) freeze(child); Object.freeze(value) } return value }

export const parseBreedingProjectLifecycleControlProjectionV1 = (value: unknown, path = 'projection'): BreedingProjectLifecycleControlProjectionV1 => {
  const row = exact(value, ['schemaVersion', 'audience', 'operationKind', 'projectId', 'projectRevision', 'projectStatus', 'mutation', 'terminalStatus', 'consentStatus', 'completedAtCampaignMinute'], path)
  if (row.schemaVersion !== 1 || typeof row.audience !== 'string' || !AUDIENCES.has(row.audience) || (row.operationKind !== 'revoke-breeding-consent' && row.operationKind !== 'cancel-breeding-project') || (row.projectStatus !== null && (typeof row.projectStatus !== 'string' || !PROJECT_STATUSES.has(row.projectStatus))) || (row.mutation !== 'consent-settled' && row.mutation !== 'project-terminal')) fail('breeding.lifecycle-recovery.invalid-document', path, 'must be a v1 lifecycle-control projection.')
  const terminalStatus = row.terminalStatus === null ? null : typeof row.terminalStatus === 'string' && TERMINAL_STATUSES.has(row.terminalStatus) ? row.terminalStatus as BreedingProjectTerminalStatus : fail('breeding.lifecycle-recovery.invalid-document', `${path}.terminalStatus`, 'must be a terminal Project status or null.')
  const consentStatus = row.consentStatus === null ? null : row.consentStatus === 'revoked' || row.consentStatus === 'expired' ? row.consentStatus : fail('breeding.lifecycle-recovery.invalid-document', `${path}.consentStatus`, 'must be revoked, expired, or null.')
  if ((row.operationKind === 'cancel-breeding-project') !== (row.mutation === 'project-terminal') || (row.mutation === 'project-terminal') !== (terminalStatus !== null) || (row.mutation === 'consent-settled') !== (consentStatus !== null) || (terminalStatus !== null && terminalStatus !== row.projectStatus) || (row.mutation === 'consent-settled' && row.projectStatus !== null)) fail('breeding.lifecycle-recovery.invalid-invariant', path, 'operation, mutation, and coarse terminal/consent states must agree.')
  return freeze({ schemaVersion: 1, audience: row.audience, operationKind: row.operationKind, projectId: projectId(row.projectId, `${path}.projectId`), projectRevision: integer(row.projectRevision, `${path}.projectRevision`, 2_147_483_647), projectStatus: row.projectStatus, mutation: row.mutation, terminalStatus, consentStatus, completedAtCampaignMinute: integer(row.completedAtCampaignMinute, `${path}.completedAtCampaignMinute`) }) as BreedingProjectLifecycleControlProjectionV1
}

export const parseBreedingOperationRecoveryProjectionV1 = (value: unknown, path = 'projection'): BreedingOperationRecoveryProjectionV1 => {
  const row = exact(value, ['schemaVersion', 'audience', 'recoveryOperationId', 'targetOperationId', 'action', 'executionStatus', 'disposition', 'targetTerminal', 'completedAtCampaignMinute'], path)
  if (row.schemaVersion !== 1 || row.audience !== 'gm' || typeof row.action !== 'string' || !ACTIONS.has(row.action) || (row.executionStatus !== 'pending' && row.executionStatus !== 'accepted' && row.executionStatus !== 'rejected')) fail('breeding.lifecycle-recovery.invalid-document', path, 'must be a GM recovery projection.')
  const expectedDisposition = row.executionStatus === 'pending' ? 'pending' : row.executionStatus === 'rejected' ? 'rejected' : row.action === 'inspect' ? 'inspected' : row.action === 'resume' ? 'resumed' : row.action === 'abandon' ? 'abandoned' : 'publication-retry-requested'
  const targetTerminal = row.targetTerminal === null ? null : bool(row.targetTerminal, `${path}.targetTerminal`)
  const completedAt = row.completedAtCampaignMinute === null ? null : integer(row.completedAtCampaignMinute, `${path}.completedAtCampaignMinute`)
  if (row.disposition !== expectedDisposition || (row.executionStatus === 'pending') !== (completedAt === null) || (row.executionStatus === 'accepted' && row.action !== 'inspect' && targetTerminal !== true) || (row.executionStatus !== 'accepted' && targetTerminal !== null) || (row.action === 'inspect' && targetTerminal !== null)) fail('breeding.lifecycle-recovery.invalid-invariant', path, 'execution status, action, disposition, terminal fact, and completion minute must agree.')
  return freeze({ schemaVersion: 1, audience: 'gm', recoveryOperationId: operationId(row.recoveryOperationId, `${path}.recoveryOperationId`), targetOperationId: operationId(row.targetOperationId, `${path}.targetOperationId`), action: row.action, executionStatus: row.executionStatus, disposition: expectedDisposition, targetTerminal, completedAtCampaignMinute: completedAt }) as BreedingOperationRecoveryProjectionV1
}

const parsePending = (value: unknown, path: string): BreedingPendingOperationSummaryV1 => {
  const row = exact(value, ['operationId', 'commandKind', 'createdAtCampaignMinute', 'authorityEvidencePresent', 'persistedRollCount'], path)
  if (typeof row.commandKind !== 'string' || !COMMAND_KINDS.has(row.commandKind)) fail('breeding.lifecycle-recovery.invalid-document', `${path}.commandKind`, 'must be a breeding command kind.')
  return freeze({ operationId: operationId(row.operationId, `${path}.operationId`), commandKind: row.commandKind, createdAtCampaignMinute: integer(row.createdAtCampaignMinute, `${path}.createdAtCampaignMinute`), authorityEvidencePresent: bool(row.authorityEvidencePresent, `${path}.authorityEvidencePresent`), persistedRollCount: integer(row.persistedRollCount, `${path}.persistedRollCount`, 32) }) as BreedingPendingOperationSummaryV1
}
export const parseBreedingRecoveryReconnectSnapshotV1 = (value: unknown, path = 'snapshot'): BreedingRecoveryReconnectSnapshotV1 => {
  const row = exact(value, ['schemaVersion', 'audience', 'campaignClockRevision', 'campaignMinute', 'pendingOperations'], path)
  if (row.schemaVersion !== 1 || row.audience !== 'gm') fail('breeding.lifecycle-recovery.invalid-document', path, 'must be a GM reconnect snapshot.')
  const pending = array(row.pendingOperations, `${path}.pendingOperations`, 100).map((entry, index) => parsePending(entry, `${path}.pendingOperations[${index}]`))
  for (let index = 1; index < pending.length; index += 1) { const before = pending[index - 1]!, after = pending[index]!; if (before.createdAtCampaignMinute > after.createdAtCampaignMinute || (before.createdAtCampaignMinute === after.createdAtCampaignMinute && before.operationId >= after.operationId)) fail('breeding.lifecycle-recovery.invalid-invariant', `${path}.pendingOperations`, 'must be unique in creation-minute then operation-ID order.') }
  return freeze({ schemaVersion: 1, audience: 'gm', campaignClockRevision: integer(row.campaignClockRevision, `${path}.campaignClockRevision`, 2_147_483_647), campaignMinute: integer(row.campaignMinute, `${path}.campaignMinute`), pendingOperations: pending })
}
