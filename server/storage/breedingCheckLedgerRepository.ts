import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingCheckRecordIdSyntax,
  parseBreedingOperationIdSyntax,
  parseBreedingProjectIdSyntax,
  parseBreedingRollRecordIdSyntax,
  type BreedingCheckRecordId,
  type BreedingOperationId,
  type BreedingRollRecordId,
} from '#shared/breeding/ids'
import type { BreedingCheckRecordV1, BreedingRollRecordV1 } from '#shared/breeding/ledgers'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import {
  parseAuthoritativeBreedingCheckRecordV1,
  parseAuthoritativeBreedingRollRecordV1,
  validateBreedingCheckRollLink,
} from '../domain/breeding/ledgers'
import { createBreedingOperationCommandHash } from '../domain/breeding/operations'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  assertBreedingStoredColumn,
  BreedingRepositoryCorruptionError,
  BreedingRepositoryIdentityCollisionError,
  exactBreedingDocumentReplay,
  parseBreedingRepositoryCampaignMinute,
  parseBreedingRepositoryRevision,
  parseStrictStoredBreedingJson,
} from './breedingRepositorySupport'

export interface BreedingCheckLedgerRepository {
  readonly database: RotomDatabase
  getRoll(rollRecordId: BreedingRollRecordId | string): BreedingRollRecordV1 | null
  getRollByOperation(operationId: BreedingOperationId | string): BreedingRollRecordV1 | null
  insertRoll(input: {
    readonly command: BreedingOperationCommandV1
    readonly roll: BreedingRollRecordV1
  }): BreedingRollRecordV1
  getCheck(checkRecordId: BreedingCheckRecordId | string): BreedingCheckRecordV1 | null
  getCheckByProject(projectId: string): BreedingCheckRecordV1 | null
  insertCheck(input: {
    readonly command: BreedingOperationCommandV1
    readonly check: BreedingCheckRecordV1
    readonly roll: BreedingRollRecordV1
  }): BreedingCheckRecordV1
}

interface RollRow {
  readonly roll_record_id: unknown
  readonly operation_id: unknown
  readonly operation_roll_ordinal: unknown
  readonly command_sha256: unknown
  readonly purpose: unknown
  readonly record_json: unknown
  readonly definition_sha256: unknown
  readonly generated_at_campaign_minute: unknown
}
interface CheckRow {
  readonly check_record_id: unknown
  readonly project_id: unknown
  readonly operation_id: unknown
  readonly roll_record_id: unknown
  readonly command_sha256: unknown
  readonly outcome: unknown
  readonly record_json: unknown
  readonly definition_sha256: unknown
  readonly resolved_at_campaign_minute: unknown
}
export class BreedingCheckLedgerRepositoryTransactionError extends Error {
  constructor() {
    super('Breeding check ledger insertion requires a caller-owned SQLite transaction.')
    this.name = 'BreedingCheckLedgerRepositoryTransactionError'
  }
}
const ROLL_TABLE = 'breeding_rolls'
const CHECK_TABLE = 'breeding_checks'
const operationId = (value: unknown): BreedingOperationId => parseBreedingOperationIdSyntax(value)
  ?? (() => { throw new Error('operationId must be a Breeding operation ID.') })()
const rollRecordId = (value: unknown): BreedingRollRecordId => parseBreedingRollRecordIdSyntax(value)
  ?? (() => { throw new Error('rollRecordId must be a Breeding roll record ID.') })()
const checkRecordId = (value: unknown): BreedingCheckRecordId => parseBreedingCheckRecordIdSyntax(value)
  ?? (() => { throw new Error('checkRecordId must be a Breeding check record ID.') })()
const projectId = (value: unknown): string => parseBreedingProjectIdSyntax(value)
  ?? (() => { throw new Error('projectId must be a Breeding Project ID.') })()
let savepointOrdinal = 0
const nextSavepoint = (): string => `breeding_check_ledger_${savepointOrdinal = (savepointOrdinal + 1) % 1_000_000}`

export const createSqliteBreedingCheckLedgerRepository = (
  database: RotomDatabase = getRotomDatabase(),
): BreedingCheckLedgerRepository => {
  const parseRollRow = (row: RollRow): BreedingRollRecordV1 => {
    const identity = rollRecordId(row.roll_record_id)
    const roll = parseStrictStoredBreedingJson({
      table: ROLL_TABLE,
      identity,
      json: row.record_json,
      parse: parseAuthoritativeBreedingRollRecordV1,
    })
    const generatedAt = parseBreedingRepositoryCampaignMinute(
      row.generated_at_campaign_minute,
      `${ROLL_TABLE}.${identity}.generated_at_campaign_minute`,
    )
    const ordinal = parseBreedingRepositoryRevision(
      row.operation_roll_ordinal,
      `${ROLL_TABLE}.${identity}.operation_roll_ordinal`,
    )
    assertBreedingStoredColumn(
      roll.rollRecordId === identity && roll.operationId === row.operation_id
      && roll.operationRollOrdinal === ordinal && roll.commandSha256 === row.command_sha256
      && roll.purpose === row.purpose && roll.definitionSha256 === row.definition_sha256
      && roll.generatedAtCampaignMinute === generatedAt,
      ROLL_TABLE,
      identity,
      'duplicated identity, operation, ordinal, purpose, hash, or campaign-minute columns',
    )
    return roll
  }
  const parseCheckRow = (row: CheckRow): BreedingCheckRecordV1 => {
    const identity = checkRecordId(row.check_record_id)
    const check = parseStrictStoredBreedingJson({
      table: CHECK_TABLE,
      identity,
      json: row.record_json,
      parse: parseAuthoritativeBreedingCheckRecordV1,
    })
    const resolvedAt = parseBreedingRepositoryCampaignMinute(
      row.resolved_at_campaign_minute,
      `${CHECK_TABLE}.${identity}.resolved_at_campaign_minute`,
    )
    assertBreedingStoredColumn(
      check.checkRecordId === identity && check.projectId === row.project_id
      && check.operationId === row.operation_id && check.rollRecordId === row.roll_record_id
      && check.commandSha256 === row.command_sha256 && check.outcome === row.outcome
      && check.definitionSha256 === row.definition_sha256
      && check.resolvedAtCampaignMinute === resolvedAt,
      CHECK_TABLE,
      identity,
      'duplicated identity, project, operation, roll, outcome, hash, or campaign-minute columns',
    )
    return check
  }
  const getRoll = (identityInput: BreedingRollRecordId | string): BreedingRollRecordV1 | null => {
    const identity = rollRecordId(identityInput)
    const row = database.connection.prepare(`
      SELECT roll_record_id, operation_id, operation_roll_ordinal, command_sha256,
             purpose, record_json, definition_sha256, generated_at_campaign_minute
      FROM breeding_rolls WHERE roll_record_id = ?
    `).get(identity) as unknown as RollRow | undefined
    return row ? parseRollRow(row) : null
  }
  const getRollByOperation = (identityInput: BreedingOperationId | string): BreedingRollRecordV1 | null => {
    const identity = operationId(identityInput)
    const rows = database.connection.prepare(`
      SELECT roll_record_id, operation_id, operation_roll_ordinal, command_sha256,
             purpose, record_json, definition_sha256, generated_at_campaign_minute
      FROM breeding_rolls
      WHERE operation_id = ? AND purpose = 'breeder-check-d20'
      ORDER BY operation_roll_ordinal, roll_record_id LIMIT 2
    `).all(identity) as unknown as RollRow[]
    if (rows.length > 1) throw new BreedingRepositoryCorruptionError(ROLL_TABLE, identity, 'one Breeder-check roll per operation')
    return rows[0] ? parseRollRow(rows[0]) : null
  }
  const getCheck = (identityInput: BreedingCheckRecordId | string): BreedingCheckRecordV1 | null => {
    const identity = checkRecordId(identityInput)
    const row = database.connection.prepare(`
      SELECT check_record_id, project_id, operation_id, roll_record_id, command_sha256,
             outcome, record_json, definition_sha256, resolved_at_campaign_minute
      FROM breeding_checks WHERE check_record_id = ?
    `).get(identity) as unknown as CheckRow | undefined
    return row ? parseCheckRow(row) : null
  }
  const getCheckByProject = (projectIdInput: string): BreedingCheckRecordV1 | null => {
    const projectIdentity = projectId(projectIdInput)
    const rows = database.connection.prepare(`
      SELECT check_record_id, project_id, operation_id, roll_record_id, command_sha256,
             outcome, record_json, definition_sha256, resolved_at_campaign_minute
      FROM breeding_checks WHERE project_id = ? LIMIT 2
    `).all(projectIdentity) as unknown as CheckRow[]
    if (rows.length > 1) throw new BreedingRepositoryCorruptionError(CHECK_TABLE, projectIdentity, 'one check per Project')
    return rows[0] ? parseCheckRow(rows[0]) : null
  }
  const insertRoll: BreedingCheckLedgerRepository['insertRoll'] = input => {
    if (!database.connection.isTransaction) throw new BreedingCheckLedgerRepositoryTransactionError()
    const command = parseBreedingOperationCommandV1(input.command)
    const roll = parseAuthoritativeBreedingRollRecordV1(input.roll)
    const commandSha256 = createBreedingOperationCommandHash(command)
    if (command.commandKind !== 'resolve-breeding-check'
      || roll.operationId !== command.operationId || roll.commandSha256 !== commandSha256
      || roll.purpose !== 'breeder-check-d20' || roll.operationRollOrdinal !== 0) {
      throw new BreedingRepositoryIdentityCollisionError('breeding-roll', roll.rollRecordId)
    }
    const existing = getRoll(roll.rollRecordId)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, roll)) return existing
      throw new BreedingRepositoryIdentityCollisionError('breeding-roll', roll.rollRecordId)
    }
    const ordinalExisting = getRollByOperation(command.operationId)
    if (ordinalExisting) {
      if (exactBreedingDocumentReplay(ordinalExisting, roll)) return ordinalExisting
      throw new BreedingRepositoryIdentityCollisionError('breeding-roll-operation-ordinal', command.operationId)
    }
    const savepoint = nextSavepoint()
    database.connection.exec(`SAVEPOINT ${savepoint}`)
    try {
      database.connection.prepare(`
        INSERT INTO breeding_rolls (
          roll_record_id, operation_id, operation_roll_ordinal, command_sha256, purpose,
          record_json, definition_sha256, generated_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        roll.rollRecordId,
        roll.operationId,
        roll.operationRollOrdinal,
        roll.commandSha256,
        roll.purpose,
        stableJsonStringify(roll),
        roll.definitionSha256,
        roll.generatedAtCampaignMinute,
      )
      database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
    }
    catch (error) {
      database.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
      const raced = getRoll(roll.rollRecordId) ?? getRollByOperation(command.operationId)
      if (raced && exactBreedingDocumentReplay(raced, roll)) return raced
      if (raced) throw new BreedingRepositoryIdentityCollisionError('breeding-roll', roll.rollRecordId)
      throw error
    }
    return getRoll(roll.rollRecordId)
      ?? (() => { throw new Error('Inserted Breeding roll was not readable.') })()
  }
  const insertCheck: BreedingCheckLedgerRepository['insertCheck'] = input => {
    if (!database.connection.isTransaction) throw new BreedingCheckLedgerRepositoryTransactionError()
    const command = parseBreedingOperationCommandV1(input.command)
    const check = parseAuthoritativeBreedingCheckRecordV1(input.check)
    const roll = parseAuthoritativeBreedingRollRecordV1(input.roll)
    if (command.commandKind !== 'resolve-breeding-check'
      || command.payload.projectId !== check.projectId
      || command.payload.checkRecordId !== check.checkRecordId
      || check.operationId !== command.operationId
      || check.commandSha256 !== createBreedingOperationCommandHash(command)
      || command.scopes[0]?.kind !== 'breeding-project'
      || command.scopes[0].expectedRevision !== check.projectRevision) {
      throw new BreedingRepositoryIdentityCollisionError('breeding-check', check.checkRecordId)
    }
    validateBreedingCheckRollLink(check, roll)
    const persistedRoll = getRoll(roll.rollRecordId)
    if (!persistedRoll || !exactBreedingDocumentReplay(persistedRoll, roll)) {
      throw new BreedingRepositoryIdentityCollisionError('breeding-check-roll', check.rollRecordId)
    }
    const existing = getCheck(check.checkRecordId) ?? getCheckByProject(check.projectId)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, check)) return existing
      throw new BreedingRepositoryIdentityCollisionError('breeding-check', check.checkRecordId)
    }
    const savepoint = nextSavepoint()
    database.connection.exec(`SAVEPOINT ${savepoint}`)
    try {
      database.connection.prepare(`
        INSERT INTO breeding_checks (
          check_record_id, project_id, operation_id, roll_record_id, command_sha256,
          outcome, record_json, definition_sha256, resolved_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        check.checkRecordId,
        check.projectId,
        check.operationId,
        check.rollRecordId,
        check.commandSha256,
        check.outcome,
        stableJsonStringify(check),
        check.definitionSha256,
        check.resolvedAtCampaignMinute,
      )
      database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
    }
    catch (error) {
      database.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
      const raced = getCheck(check.checkRecordId) ?? getCheckByProject(check.projectId)
      if (raced && exactBreedingDocumentReplay(raced, check)) return raced
      if (raced) throw new BreedingRepositoryIdentityCollisionError('breeding-check', check.checkRecordId)
      throw error
    }
    return getCheck(check.checkRecordId)
      ?? (() => { throw new Error('Inserted Breeding check was not readable.') })()
  }
  return Object.freeze({
    database,
    getRoll,
    getRollByOperation,
    insertRoll,
    getCheck,
    getCheckByProject,
    insertCheck,
  })
}
