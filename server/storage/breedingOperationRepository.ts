import { stableJsonStringify } from '#shared/automation/stableJson'
import type {
  CampaignOperationLedgerAdapter,
  CampaignOperationLedgerRecord,
  CampaignOperationReservationDecision,
  CampaignOperationSettlementDecision,
} from '#shared/campaignOperations'
import {
  breedingConflictScopeKey,
  parseBreedingConflictScopeV1,
  parseBreedingOperationCommandV1,
  type BreedingConflictScopeV1,
  type BreedingOperationCommandV1,
  type BreedingOperationResultV1,
} from '#shared/breeding/operations'
import { parseBreedingOperationIdSyntax, type BreedingOperationId } from '#shared/breeding/ids'
import {
  assertBreedingOperationResultMatchesCommand,
  assertBreedingOperationTerminalResultsCompatible,
  createBreedingOperationCommandHash,
  parseAuthoritativeBreedingOperationResultV1,
  BreedingOperationIdCollisionError,
  type BreedingOperationCommandHash,
} from '../domain/breeding/operations'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  BreedingRepositoryCorruptionError,
  parseBreedingRepositoryCampaignMinute,
  parseBreedingRepositoryLimit,
  parseStrictStoredBreedingJson,
} from './breedingRepositorySupport'

export const BREEDING_OPERATION_COMMAND_MAXIMUM_BYTES = 32_768 as const
export const BREEDING_OPERATION_RESULT_MAXIMUM_BYTES = 65_536 as const
export type BreedingOperationLedgerRecord = CampaignOperationLedgerRecord<
  BreedingOperationCommandV1,
  BreedingOperationResultV1,
  BreedingConflictScopeV1,
  BreedingOperationId
>
export interface BreedingOperationRepository extends CampaignOperationLedgerAdapter<BreedingOperationCommandV1, BreedingOperationResultV1, BreedingOperationLedgerRecord> {
  readonly database: RotomDatabase
  get(operationId: BreedingOperationId | string): BreedingOperationLedgerRecord | null
  listPending(limit?: number): readonly BreedingOperationLedgerRecord[]
  listAcceptedForScopes(input: { readonly scopes: readonly BreedingConflictScopeV1[], readonly minimumSettledAtCampaignMinute: number, readonly limit?: number }): readonly BreedingOperationLedgerRecord[]
}
interface OperationRow {
  readonly operation_id: unknown
  readonly command_sha256: unknown
  readonly command_kind: unknown
  readonly command_json: unknown
  readonly status: unknown
  readonly result_json: unknown
  readonly result_definition_sha256: unknown
  readonly created_at_campaign_minute: unknown
  readonly settled_at_campaign_minute: unknown
}
interface ScopeRow { readonly scope_key: unknown, readonly scope_kind: unknown, readonly scope_json: unknown }
export class BreedingOperationRepositoryTransactionError extends Error {
  constructor(action: string) { super(`Breeding operation repository ${action} requires a caller-owned SQLite transaction.`); this.name = 'BreedingOperationRepositoryTransactionError' }
}
export class BreedingOperationSettlementError extends Error {
  readonly operationId: BreedingOperationId
  readonly code: 'missing' | 'pending-required' | 'invalid-settlement-minute' | 'invalid-commit-minute'
  constructor(operationId: BreedingOperationId, code: BreedingOperationSettlementError['code'], message: string) { super(`Breeding operation ${operationId}: ${message}`); this.name = 'BreedingOperationSettlementError'; this.operationId = operationId; this.code = code }
}
const TABLE = 'breeding_operations'
const SHA256 = /^[0-9a-f]{64}$/
const operationId = (value: unknown, label = 'operationId'): BreedingOperationId => parseBreedingOperationIdSyntax(value) ?? (() => { throw new Error(`${label} must be a breeding operation ID.`) })()
const commandHash = (value: unknown, identity: string): BreedingOperationCommandHash => typeof value === 'string' && SHA256.test(value) ? value as BreedingOperationCommandHash : (() => { throw new BreedingRepositoryCorruptionError(TABLE, identity, 'command_sha256') })()
const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8')
const boundedStableJson = (value: unknown, maximum: number, label: string): string => {
  const json = stableJsonStringify(value)
  if (byteLength(json) > maximum) throw new Error(`${label} must contain at most ${maximum} UTF-8 bytes.`)
  return json
}
const requireTransaction = (database: RotomDatabase, action: string): void => { if (!database.connection.isTransaction) throw new BreedingOperationRepositoryTransactionError(action) }
let savepointOrdinal = 0
const nextSavepoint = (): string => `breeding_operation_repository_${savepointOrdinal = (savepointOrdinal + 1) % 1_000_000}`
const withSavepoint = <Value>(database: RotomDatabase, work: () => Value): Value => {
  const savepoint = nextSavepoint(); database.connection.exec(`SAVEPOINT ${savepoint}`)
  try { const value = work(); database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`); return value }
  catch (error) { database.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`); throw error }
}
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
export const createSqliteBreedingOperationRepository = (database: RotomDatabase = getRotomDatabase()): BreedingOperationRepository => {
  const scopeRows = (identity: BreedingOperationId): readonly ScopeRow[] => database.connection.prepare(`
    SELECT scope_key, scope_kind, scope_json FROM breeding_operation_scopes
    WHERE operation_id = ? ORDER BY scope_key ASC
  `).all(identity) as unknown as ScopeRow[]
  const parseScopes = (identity: BreedingOperationId, command: BreedingOperationCommandV1): readonly BreedingConflictScopeV1[] => {
    const rows = scopeRows(identity)
    const scopes = rows.map((row, index) => {
      if (typeof row.scope_key !== 'string' || typeof row.scope_kind !== 'string') throw new BreedingRepositoryCorruptionError('breeding_operation_scopes', identity, `identity columns at ${index}`)
      const scope = parseStrictStoredBreedingJson({ table: 'breeding_operation_scopes', identity: `${identity}/${row.scope_key}`, json: row.scope_json, parse: parseBreedingConflictScopeV1 })
      if (row.scope_key !== breedingConflictScopeKey(scope) || row.scope_kind !== scope.kind) throw new BreedingRepositoryCorruptionError('breeding_operation_scopes', identity, `scope columns at ${index}`)
      return scope
    })
    if (!same(scopes, command.scopes)) throw new BreedingRepositoryCorruptionError('breeding_operation_scopes', identity, 'complete command scope set')
    return Object.freeze(scopes)
  }
  const rowToRecord = (row: OperationRow): BreedingOperationLedgerRecord => {
    let identity: BreedingOperationId
    try { identity = operationId(row.operation_id, 'breeding_operations.operation_id') }
    catch { throw new BreedingRepositoryCorruptionError(TABLE, 'unknown', 'operation_id') }
    const hash = commandHash(row.command_sha256, identity)
    if (typeof row.command_json !== 'string' || byteLength(row.command_json) > BREEDING_OPERATION_COMMAND_MAXIMUM_BYTES) throw new BreedingRepositoryCorruptionError(TABLE, identity, 'bounded command_json')
    const command = parseStrictStoredBreedingJson({ table: TABLE, identity, json: row.command_json, parse: parseBreedingOperationCommandV1 })
    if (command.operationId !== identity || command.commandKind !== row.command_kind || createBreedingOperationCommandHash(command) !== hash) throw new BreedingRepositoryCorruptionError(TABLE, identity, 'command identity, kind, or hash')
    const scopes = parseScopes(identity, command)
    const createdAtCampaignMinute = parseBreedingRepositoryCampaignMinute(row.created_at_campaign_minute, `${TABLE}.${identity}.created_at_campaign_minute`)
    if (row.status !== 'pending' && row.status !== 'accepted' && row.status !== 'rejected') throw new BreedingRepositoryCorruptionError(TABLE, identity, 'status')
    const status = row.status
    if (status === 'pending') {
      if (row.result_json !== null || row.result_definition_sha256 !== null || row.settled_at_campaign_minute !== null) throw new BreedingRepositoryCorruptionError(TABLE, identity, 'pending terminal fields')
      return Object.freeze({ operationId: identity, commandHash: hash, command, scopes, status, result: null, createdAtCampaignMinute, settledAtCampaignMinute: null })
    }
    const settledAtCampaignMinute = parseBreedingRepositoryCampaignMinute(row.settled_at_campaign_minute, `${TABLE}.${identity}.settled_at_campaign_minute`)
    if (settledAtCampaignMinute < createdAtCampaignMinute) throw new BreedingRepositoryCorruptionError(TABLE, identity, 'settled_at_campaign_minute')
    if (typeof row.result_json !== 'string' || byteLength(row.result_json) > BREEDING_OPERATION_RESULT_MAXIMUM_BYTES) throw new BreedingRepositoryCorruptionError(TABLE, identity, 'bounded result_json')
    const result = parseStrictStoredBreedingJson({ table: TABLE, identity, json: row.result_json, parse: parseAuthoritativeBreedingOperationResultV1 })
    if (result.resultDefinitionSha256 !== row.result_definition_sha256 || (result.ok ? 'accepted' : 'rejected') !== status) throw new BreedingRepositoryCorruptionError(TABLE, identity, 'result status or definition hash')
    try { assertBreedingOperationResultMatchesCommand(command, result) }
    catch { throw new BreedingRepositoryCorruptionError(TABLE, identity, 'command/result binding') }
    if (result.ok && result.commandKind !== 'preview-breeding' && result.committedAtCampaignMinute !== settledAtCampaignMinute) throw new BreedingRepositoryCorruptionError(TABLE, identity, 'accepted commit minute')
    return Object.freeze({ operationId: identity, commandHash: hash, command, scopes, status, result, createdAtCampaignMinute, settledAtCampaignMinute })
  }
  const get = (identityInput: BreedingOperationId | string): BreedingOperationLedgerRecord | null => {
    const identity = operationId(identityInput)
    const row = database.connection.prepare(`
      SELECT operation_id, command_sha256, command_kind, command_json, status, result_json,
             result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
      FROM breeding_operations WHERE operation_id = ?
    `).get(identity) as unknown as OperationRow | undefined
    return row ? rowToRecord(row) : null
  }
  const assertSameCommand = (record: BreedingOperationLedgerRecord, command: BreedingOperationCommandV1, hash: BreedingOperationCommandHash): void => {
    if (record.commandHash !== hash || !same(record.command, command)) throw new BreedingOperationIdCollisionError({ operationId: command.operationId, existingCommandHash: record.commandHash as BreedingOperationCommandHash, attemptedCommandHash: hash })
  }
  const reserve = (commandInput: unknown, createdAtInput: number): CampaignOperationReservationDecision<BreedingOperationLedgerRecord> => {
    requireTransaction(database, 'reserve')
    const command = parseBreedingOperationCommandV1(commandInput)
    const hash = createBreedingOperationCommandHash(command)
    const createdAtCampaignMinute = parseBreedingRepositoryCampaignMinute(createdAtInput, 'createdAtCampaignMinute')
    const commandJson = boundedStableJson(command, BREEDING_OPERATION_COMMAND_MAXIMUM_BYTES, 'Breeding operation command')
    const existing = get(command.operationId)
    if (existing) {
      assertSameCommand(existing, command, hash)
      return Object.freeze({ kind: existing.status === 'pending' ? 'pending' : 'exact-retry', record: existing })
    }
    return withSavepoint(database, () => {
      database.connection.prepare(`
        INSERT INTO breeding_operations (
          operation_id, command_sha256, command_kind, command_json, status,
          result_json, result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
        ) VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?, NULL)
      `).run(command.operationId, hash, command.commandKind, commandJson, createdAtCampaignMinute)
      for (const scope of command.scopes) database.connection.prepare(`
        INSERT INTO breeding_operation_scopes (operation_id, scope_key, scope_kind, scope_json)
        VALUES (?, ?, ?, ?)
      `).run(command.operationId, breedingConflictScopeKey(scope), scope.kind, stableJsonStringify(scope))
      const record = get(command.operationId) ?? (() => { throw new Error('Reserved breeding operation was not readable.') })()
      return Object.freeze({ kind: 'reserved' as const, record })
    })
  }
  const settle = (commandInput: BreedingOperationCommandV1, resultInput: unknown, settledAtInput: number): CampaignOperationSettlementDecision<BreedingOperationLedgerRecord> => {
    requireTransaction(database, 'settle')
    const command = parseBreedingOperationCommandV1(commandInput)
    const hash = createBreedingOperationCommandHash(command)
    const result = assertBreedingOperationResultMatchesCommand(command, resultInput)
    const settledAtCampaignMinute = parseBreedingRepositoryCampaignMinute(settledAtInput, 'settledAtCampaignMinute')
    const resultJson = boundedStableJson(result, BREEDING_OPERATION_RESULT_MAXIMUM_BYTES, 'Breeding operation result')
    const current = get(command.operationId) ?? (() => { throw new BreedingOperationSettlementError(command.operationId, 'missing', 'must be reserved before settlement.') })()
    assertSameCommand(current, command, hash)
    if (current.status !== 'pending') {
      assertBreedingOperationTerminalResultsCompatible(current.result, result)
      return Object.freeze({ kind: 'exact-retry', record: current })
    }
    if (settledAtCampaignMinute < current.createdAtCampaignMinute) throw new BreedingOperationSettlementError(command.operationId, 'invalid-settlement-minute', 'settlement cannot precede reservation.')
    if (result.ok && result.commandKind !== 'preview-breeding' && result.committedAtCampaignMinute !== settledAtCampaignMinute) throw new BreedingOperationSettlementError(command.operationId, 'invalid-commit-minute', 'accepted commit minute must equal durable settlement time.')
    const status = result.ok ? 'accepted' : 'rejected'
    const update = database.connection.prepare(`
      UPDATE breeding_operations
      SET status = ?, result_json = ?, result_definition_sha256 = ?, settled_at_campaign_minute = ?
      WHERE operation_id = ? AND command_sha256 = ? AND status = 'pending'
    `).run(status, resultJson, result.resultDefinitionSha256, settledAtCampaignMinute, command.operationId, hash)
    if (Number(update.changes) !== 1) {
      const raced = get(command.operationId) ?? (() => { throw new BreedingOperationSettlementError(command.operationId, 'missing', 'disappeared during settlement.') })()
      if (raced.status !== 'pending') { assertBreedingOperationTerminalResultsCompatible(raced.result, result); return Object.freeze({ kind: 'exact-retry', record: raced }) }
      throw new BreedingOperationSettlementError(command.operationId, 'pending-required', 'could not transition the pending row once.')
    }
    const terminal = get(command.operationId) ?? (() => { throw new Error('Settled breeding operation was not readable.') })()
    return Object.freeze({ kind: 'settled', record: terminal })
  }
  const listPending = (limitInput?: number): readonly BreedingOperationLedgerRecord[] => {
    const limit = parseBreedingRepositoryLimit(limitInput)
    const rows = database.connection.prepare(`
      SELECT operation_id FROM breeding_operations WHERE status = 'pending'
      ORDER BY created_at_campaign_minute ASC, operation_id ASC LIMIT ?
    `).all(limit) as unknown as Array<{ operation_id: unknown }>
    return Object.freeze(rows.map(row => get(operationId(row.operation_id)) ?? (() => { throw new BreedingRepositoryCorruptionError(TABLE, 'unknown', 'pending identity') })()))
  }
  const listAcceptedForScopes = (input: { readonly scopes: readonly BreedingConflictScopeV1[], readonly minimumSettledAtCampaignMinute: number, readonly limit?: number }): readonly BreedingOperationLedgerRecord[] => {
    const scopes = input.scopes.map((scope, index) => parseBreedingConflictScopeV1(scope, `scopes[${index}]`))
    if (scopes.length > 128) throw new Error('Accepted operation scope query supports at most 128 scopes.')
    const keys = [...new Set(scopes.map(breedingConflictScopeKey))].sort()
    if (keys.length === 0) return Object.freeze([])
    const minimum = parseBreedingRepositoryCampaignMinute(input.minimumSettledAtCampaignMinute, 'minimumSettledAtCampaignMinute')
    const limit = parseBreedingRepositoryLimit(input.limit)
    const placeholders = keys.map(() => '?').join(', ')
    const rows = database.connection.prepare(`
      SELECT DISTINCT scopes.operation_id, operations.settled_at_campaign_minute
      FROM breeding_operation_scopes AS scopes
      JOIN breeding_operations AS operations ON operations.operation_id = scopes.operation_id
      WHERE scopes.scope_key IN (${placeholders})
        AND operations.status = 'accepted'
        AND operations.settled_at_campaign_minute >= ?
      ORDER BY operations.settled_at_campaign_minute ASC, scopes.operation_id ASC
      LIMIT ?
    `).all(...keys, minimum, limit) as unknown as Array<{ operation_id: unknown }>
    return Object.freeze(rows.map(row => get(operationId(row.operation_id)) ?? (() => { throw new BreedingRepositoryCorruptionError(TABLE, 'unknown', 'accepted identity') })()))
  }
  return Object.freeze({ database, get, reserve, settle, listPending, listAcceptedForScopes })
}
