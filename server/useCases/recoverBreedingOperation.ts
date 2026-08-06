import { createHash } from 'node:crypto'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { BreedingAuthorizationReceiptV1 } from '#shared/breeding/authorization'
import { parseBreedingRecoveryReconnectSnapshotV1, type BreedingOperationRecoveryProjectionV1, type BreedingRecoveryReconnectSnapshotV1 } from '#shared/breeding/lifecycleRecovery'
import { parseBreedingOperationCommandV1, type BreedingOperationResultV1 } from '#shared/breeding/operations'
import type { BreedingOperationReadSetV1, BreedingReadResourceV1 } from '#shared/breeding/readSets'
import { authorizeBreedingLifecycleControlV1, parseAuthoritativeBreedingActorAuthorityV1, parseAuthoritativeBreedingAuthorizationReceiptV1 } from '../domain/breeding/authorization'
import { breedingOperationRecoveryResourceDefinitionSha256, breedingPendingOperationRecoveryResourceDefinitionSha256, projectBreedingOperationRecoveryV1 } from '../domain/breeding/lifecycleRecovery'
import { createBreedingOperationAcceptedV1, createBreedingOperationCommandHash, createBreedingOperationRejectedV1 } from '../domain/breeding/operations'
import { validateBreedingOperationReadSetCompleteness } from '../domain/breeding/readSets'
import { createSqliteBreedingOperationEvidenceRepository } from '../storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository, type BreedingOperationLedgerRecord } from '../storage/breedingOperationRepository'
import { createSqliteBreedingRollRepository } from '../storage/breedingRollRepository'
import { createSqliteCampaignClockRepository } from '../storage/campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import type { BreedingTransactionExecutionDecision } from './executeBreedingTransaction'

export interface RecoverBreedingOperationInputV1 {
  readonly command: unknown
  readonly readSet: unknown
  readonly authorizationReceipt: unknown
  readonly actorAuthority: unknown
  readonly gmOverrides: readonly unknown[]
}
export interface RecoverBreedingOperationOptions {
  readonly database?: RotomDatabase
  readonly resumePending?: boolean
  readonly resumeTarget?: (target: BreedingOperationLedgerRecord) => unknown
  readonly retryPublication?: (target: BreedingOperationLedgerRecord) => unknown
  readonly beforeSettle?: (result: BreedingOperationResultV1) => void
}
export interface RecoverBreedingOperationResultV1 {
  readonly execution: BreedingTransactionExecutionDecision
  readonly projection: BreedingOperationRecoveryProjectionV1
}
export interface LoadBreedingRecoveryReconnectOptions {
  readonly database?: RotomDatabase
  readonly validateCurrentGmAuthority: (actorAuthority: ReturnType<typeof parseAuthoritativeBreedingActorAuthorityV1>) => boolean
  readonly limit?: number
}
export type RecoverBreedingOperationErrorCode =
  | 'breeding.lifecycle-recovery.invalid-authority'
  | 'breeding.lifecycle-recovery.invalid-request'
  | 'breeding.lifecycle-recovery.unavailable'
  | 'breeding.lifecycle-recovery.wrong-command'
export class RecoverBreedingOperationError extends Error {
  readonly code: RecoverBreedingOperationErrorCode
  constructor(code: RecoverBreedingOperationErrorCode, message: string) { super(message); this.name = 'RecoverBreedingOperationError'; this.code = code }
}
const fail = (code: RecoverBreedingOperationErrorCode, message: string): never => { throw new RecoverBreedingOperationError(code, message) }
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const promiseLike = (value: unknown): value is PromiseLike<unknown> => (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { readonly then?: unknown }).then === 'function'
const assertStrictInput = (value: unknown): asserts value is RecoverBreedingOperationInputV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length > 0) return fail('breeding.lifecycle-recovery.invalid-request', 'Recovery input must be a plain data object without symbols.')
  const fields = ['command', 'readSet', 'authorizationReceipt', 'actorAuthority', 'gmOverrides']; const row = value as Record<string, unknown>; const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) return fail('breeding.lifecycle-recovery.invalid-request', 'Recovery input must contain exactly the declared fields.')
  for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(row, field); if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.lifecycle-recovery.invalid-request', `Recovery input ${field} must be an enumerable data field.`) }
}
const strictArray = (value: unknown, maximum: number, label: string): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum || Object.getOwnPropertySymbols(value).length > 0 || Object.keys(value).some(key => !/^(0|[1-9][0-9]*)$/.test(key))) return fail('breeding.lifecycle-recovery.invalid-request', `${label} must be a strict array of at most ${maximum} entries.`)
  for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor?.enumerable || !('value' in descriptor)) return fail('breeding.lifecycle-recovery.invalid-request', `${label} must not be sparse or accessor-backed.`) }
  return value
}
const readResource = (readSet: BreedingOperationReadSetV1, kind: BreedingReadResourceV1['resourceKind'], id: string): BreedingReadResourceV1 | null => readSet.resources.find(value => value.resourceKind === kind && value.resourceId === id) ?? null
const clockDefinition = (clock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null }): string => sha256({ schemaVersion: 1, revision: clock.revision, campaignMinute: clock.campaignMinute, lastOperationId: clock.lastOperationId })
const clockMatches = (readSet: BreedingOperationReadSetV1, clock: { readonly revision: number, readonly campaignMinute: number, readonly lastOperationId: string | null }): boolean => {
  const resource = readResource(readSet, 'campaign-clock', 'campaign-clock')
  return resource?.existence === 'present' && resource.revision === clock.revision && resource.observedCampaignMinute === clock.campaignMinute && resource.definitionSha256 === clockDefinition(clock) && readSet.capturedAtCampaignMinute === clock.campaignMinute
}
const targetMatches = (readSet: BreedingOperationReadSetV1, target: BreedingOperationLedgerRecord): boolean => {
  const resource = readResource(readSet, 'breeding-operation', target.operationId)
  return resource?.existence === 'present' && resource.revision === null && resource.definitionSha256 === breedingOperationRecoveryResourceDefinitionSha256(target) && resource.purposes.includes('idempotency') && resource.purposes.includes('conflict')
}
const execution = (kind: BreedingTransactionExecutionDecision['kind'], record: BreedingOperationLedgerRecord): BreedingTransactionExecutionDecision => Object.freeze({ kind, record, committedRealtimeEvents: Object.freeze([]), publicationFailureCount: 0 })
const projection = (record: BreedingOperationLedgerRecord): BreedingOperationRecoveryProjectionV1 => {
  const command = record.command
  if (command.commandKind !== 'recover-breeding-operation') return fail('breeding.lifecycle-recovery.wrong-command', 'Stored recovery operation changed command kind.')
  return projectBreedingOperationRecoveryV1({ recoveryOperationId: command.operationId, targetOperationId: command.payload.targetOperationId, action: command.payload.action, executionStatus: record.status, completedAtCampaignMinute: record.settledAtCampaignMinute })
}
const requireEvidenceReplay = (input: { readonly database: RotomDatabase, readonly operationId: string, readonly readSet: BreedingOperationReadSetV1, readonly receipt: BreedingAuthorizationReceiptV1 }): void => {
  const operation = createSqliteBreedingOperationRepository(input.database).get(input.operationId)
  const evidence = createSqliteBreedingOperationEvidenceRepository(input.database).get(input.operationId)
  if (evidence && (!same(evidence.readSet, input.readSet) || !same(evidence.authorizationReceipt, input.receipt))) return fail('breeding.lifecycle-recovery.invalid-authority', 'Recovery operation identity is bound to different immutable evidence.')
  if (operation && operation.status !== 'pending' && !evidence) return fail('breeding.lifecycle-recovery.invalid-authority', 'Terminal recovery operation is missing immutable authority evidence.')
}
const beforeSettle = (callback: RecoverBreedingOperationOptions['beforeSettle'], result: BreedingOperationResultV1): void => {
  const value = callback?.(result)
  if (promiseLike(value)) return fail('breeding.lifecycle-recovery.invalid-request', 'beforeSettle must be synchronous inside the recovery transaction.')
}
const callSynchronous = (callback: ((target: BreedingOperationLedgerRecord) => unknown) | undefined, target: BreedingOperationLedgerRecord, label: string): void => {
  if (!callback) return fail('breeding.lifecycle-recovery.invalid-request', `${label} requires its server-owned callback.`)
  const value = callback(target)
  if (promiseLike(value)) return fail('breeding.lifecycle-recovery.invalid-request', `${label} callback must be synchronous and complete outside another coordinator transaction.`)
}

export const recoverBreedingOperation = (input: RecoverBreedingOperationInputV1, options: RecoverBreedingOperationOptions = {}): RecoverBreedingOperationResultV1 => {
  assertStrictInput(input)
  const command = parseBreedingOperationCommandV1(input.command)
  if (command.commandKind !== 'recover-breeding-operation') return fail('breeding.lifecycle-recovery.wrong-command', 'Recovery manager accepts only recover-breeding-operation.')
  const overrides = strictArray(input.gmOverrides, 1, 'gmOverrides')
  if (command.payload.action === 'resume' && !options.resumeTarget) return fail('breeding.lifecycle-recovery.invalid-request', 'Resume requires a server-owned target dispatcher.')
  if (command.payload.action === 'retry-publication' && !options.retryPublication) return fail('breeding.lifecycle-recovery.invalid-request', 'Publication retry requires a durable-event publisher callback.')
  const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
  const actor = parseAuthoritativeBreedingActorAuthorityV1(input.actorAuthority)
  const receipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.authorizationReceipt)
  const expected = authorizeBreedingLifecycleControlV1({ command, readSet, actorAuthority: actor, trainerControl: null, project: null, consent: null, gmOverrides: overrides, securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256 })
  if (!expected.authorized || actor.role !== 'gm' || !same(expected, receipt)) return fail('breeding.lifecycle-recovery.invalid-authority', 'Recovery requires exact current GM principal authority, one command-bound operation-recovery override, and the complete read set.')
  const database = options.database ?? getRotomDatabase()
  if (database.connection.isTransaction) return fail('breeding.lifecycle-recovery.invalid-request', 'Recovery must own its top-level transaction boundaries.')
  const operations = createSqliteBreedingOperationRepository(database)
  const evidence = createSqliteBreedingOperationEvidenceRepository(database)
  const clockRepository = createSqliteCampaignClockRepository(database)
  requireEvidenceReplay({ database, operationId: command.operationId, readSet, receipt })
  const reservation = database.withTransaction(() => operations.reserve(command, readSet.capturedAtCampaignMinute))
  if (reservation.kind === 'exact-retry') return Object.freeze({ execution: execution('exact-retry', reservation.record), projection: projection(reservation.record) })
  if (reservation.kind === 'pending' && options.resumePending !== true) return Object.freeze({ execution: execution('pending', reservation.record), projection: projection(reservation.record) })

  let initialTarget: BreedingOperationLedgerRecord | null = null
  const preflightTerminal = database.withTransaction((): BreedingOperationLedgerRecord | null => {
    evidence.insert({ command, readSet, authorizationReceipt: receipt })
    const clock = clockRepository.get()
    const target = operations.get(command.payload.targetOperationId)
    const hash = createBreedingOperationCommandHash(command)
    const action = command.payload.action
    const targetResource = target ? readResource(readSet, 'breeding-operation', target.operationId) : null
    const resumedAfterRecoveryCrash = target !== null && action === 'resume' && target.status !== 'pending' && targetResource?.definitionSha256 === breedingPendingOperationRecoveryResourceDefinitionSha256(target)
    if (!target || !clockMatches(readSet, clock) || (!targetMatches(readSet, target) && !resumedAfterRecoveryCrash)) {
      const rejected = createBreedingOperationRejectedV1({ operationId: command.operationId, commandHash: hash, commandKind: command.commandKind, reasonId: target ? 'breeding.operation.stale-revision' : 'breeding.operation.not-found', currentAggregateRefs: [], conflictingScopes: command.scopes })
      beforeSettle(options.beforeSettle, rejected)
      return operations.settle(command, rejected, readSet.capturedAtCampaignMinute).record
    }
    if (resumedAfterRecoveryCrash) {
      const accepted = createBreedingOperationAcceptedV1({ operationId: command.operationId, commandHash: hash, commandKind: command.commandKind, outcomeKind: 'operation-recovered', aggregateRefs: [], changedScopes: command.scopes, committedAtCampaignMinute: readSet.capturedAtCampaignMinute })
      beforeSettle(options.beforeSettle, accepted)
      return operations.settle(command, accepted, readSet.capturedAtCampaignMinute).record
    }
    initialTarget = target
    if ((action === 'resume' || action === 'abandon') && target.status !== 'pending' || action === 'retry-publication' && target.status !== 'accepted') {
      const rejected = createBreedingOperationRejectedV1({ operationId: command.operationId, commandHash: hash, commandKind: command.commandKind, reasonId: 'breeding.operation.unavailable', currentAggregateRefs: [], conflictingScopes: command.scopes })
      beforeSettle(options.beforeSettle, rejected)
      return operations.settle(command, rejected, readSet.capturedAtCampaignMinute).record
    }
    if (action === 'inspect') {
      const accepted = createBreedingOperationAcceptedV1({ operationId: command.operationId, commandHash: hash, commandKind: command.commandKind, outcomeKind: 'operation-recovered', aggregateRefs: [], changedScopes: command.scopes, committedAtCampaignMinute: readSet.capturedAtCampaignMinute })
      beforeSettle(options.beforeSettle, accepted)
      return operations.settle(command, accepted, readSet.capturedAtCampaignMinute).record
    }
    if (action === 'abandon') {
      const abandoned = createBreedingOperationRejectedV1({ operationId: target.command.operationId, commandHash: target.commandHash, commandKind: target.command.commandKind, reasonId: 'breeding.operation.abandoned', currentAggregateRefs: [], conflictingScopes: target.command.scopes })
      operations.settle(target.command, abandoned, readSet.capturedAtCampaignMinute)
      const accepted = createBreedingOperationAcceptedV1({ operationId: command.operationId, commandHash: hash, commandKind: command.commandKind, outcomeKind: 'operation-recovered', aggregateRefs: [], changedScopes: command.scopes, committedAtCampaignMinute: readSet.capturedAtCampaignMinute })
      beforeSettle(options.beforeSettle, accepted)
      return operations.settle(command, accepted, readSet.capturedAtCampaignMinute).record
    }
    return null
  })
  if (preflightTerminal) return Object.freeze({ execution: execution('executed', preflightTerminal), projection: projection(preflightTerminal) })
  const target = initialTarget ?? fail('breeding.lifecycle-recovery.unavailable', 'Recovery preflight did not retain its exact target.')
  if (command.payload.action === 'resume') callSynchronous(options.resumeTarget, target, 'resume')
  else callSynchronous(options.retryPublication, target, 'retry-publication')
  const terminal = database.withTransaction(() => {
    const clock = clockRepository.get()
    const currentTarget = operations.get(command.payload.targetOperationId)
    const hash = createBreedingOperationCommandHash(command)
    const successful = clockMatches(readSet, clock) && currentTarget !== null && currentTarget.status !== 'pending' && (command.payload.action !== 'retry-publication' || same(currentTarget, target))
    const result = successful
      ? createBreedingOperationAcceptedV1({ operationId: command.operationId, commandHash: hash, commandKind: command.commandKind, outcomeKind: 'operation-recovered', aggregateRefs: [], changedScopes: command.scopes, committedAtCampaignMinute: readSet.capturedAtCampaignMinute })
      : createBreedingOperationRejectedV1({ operationId: command.operationId, commandHash: hash, commandKind: command.commandKind, reasonId: 'breeding.operation.unavailable', currentAggregateRefs: [], conflictingScopes: command.scopes })
    beforeSettle(options.beforeSettle, result)
    return operations.settle(command, result, readSet.capturedAtCampaignMinute).record
  })
  requireEvidenceReplay({ database, operationId: command.operationId, readSet, receipt })
  return Object.freeze({ execution: execution('executed', terminal), projection: projection(terminal) })
}

export const loadBreedingRecoveryReconnectSnapshot = (actorAuthorityValue: unknown, options: LoadBreedingRecoveryReconnectOptions): BreedingRecoveryReconnectSnapshotV1 => {
  const actor = parseAuthoritativeBreedingActorAuthorityV1(actorAuthorityValue)
  let authorized = false
  try { authorized = options.validateCurrentGmAuthority(actor) === true } catch { authorized = false }
  if (actor.role !== 'gm' || !authorized) return fail('breeding.lifecycle-recovery.invalid-authority', 'Reconnect recovery snapshot requires current authenticated GM authority.')
  const limit = options.limit === undefined ? 100 : Number.isSafeInteger(options.limit) && options.limit >= 1 && options.limit <= 100 ? options.limit : fail('breeding.lifecycle-recovery.invalid-request', 'Reconnect limit must be from 1 through 100.')
  const database = options.database ?? getRotomDatabase()
  const operations = createSqliteBreedingOperationRepository(database)
  const evidence = createSqliteBreedingOperationEvidenceRepository(database)
  const rolls = createSqliteBreedingRollRepository(database)
  const clock = createSqliteCampaignClockRepository(database).get()
  const pendingOperations = operations.listPending(limit).map(record => ({ operationId: record.operationId, commandKind: record.command.commandKind, createdAtCampaignMinute: record.createdAtCampaignMinute, authorityEvidencePresent: evidence.get(record.operationId) !== null, persistedRollCount: rolls.listByOperation(record.operationId).length }))
  return parseBreedingRecoveryReconnectSnapshotV1({ schemaVersion: 1, audience: 'gm', campaignClockRevision: clock.revision, campaignMinute: clock.campaignMinute, pendingOperations })
}
