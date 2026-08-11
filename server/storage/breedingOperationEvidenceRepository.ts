import { stableJsonStringify } from '#shared/automation/stableJson'
import type {
  BreedingAuthorizationReceiptV1,
  BreedingGmOverrideEvidenceV1,
} from '#shared/breeding/authorization'
import { parseBreedingOperationIdSyntax, type BreedingOperationId } from '#shared/breeding/ids'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '#shared/breeding/operations'
import type { BreedingOperationReadSetV1 } from '#shared/breeding/readSets'
import {
  parseAuthoritativeBreedingAuthorizationReceiptV1,
  parseAuthoritativeBreedingGmOverrideEvidenceV1,
} from '../domain/breeding/authorization'
import { createBreedingOperationCommandHash } from '../domain/breeding/operations'
import {
  parseAuthoritativeBreedingOperationReadSetV1,
  validateBreedingOperationReadSetCompleteness,
} from '../domain/breeding/readSets'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  BreedingRepositoryCorruptionError,
  exactBreedingDocumentReplay,
  parseBreedingRepositoryCampaignMinute,
  parseBreedingRepositoryRevision,
  parseStrictStoredBreedingJson,
} from './breedingRepositorySupport'

export interface BreedingOperationAuthorityEvidenceV1 {
  readonly readSet: BreedingOperationReadSetV1
  readonly authorizationReceipt: BreedingAuthorizationReceiptV1
  readonly gmOverrides: readonly BreedingGmOverrideEvidenceV1[]
}
export interface BreedingOperationEvidenceRepository {
  readonly database: RotomDatabase
  get(operationId: BreedingOperationId | string): BreedingOperationAuthorityEvidenceV1 | null
  insert(input: {
    readonly command: BreedingOperationCommandV1
    readonly readSet: BreedingOperationReadSetV1
    readonly authorizationReceipt: BreedingAuthorizationReceiptV1
    readonly gmOverrides?: readonly unknown[]
  }): BreedingOperationAuthorityEvidenceV1
}

interface ReadSetRow {
  readonly read_set_id: unknown
  readonly operation_id: unknown
  readonly command_sha256: unknown
  readonly document_json: unknown
  readonly definition_sha256: unknown
  readonly captured_at_campaign_minute: unknown
}
interface OverrideRow {
  readonly override_id: unknown
  readonly operation_id: unknown
  readonly command_sha256: unknown
  readonly override_kind: unknown
  readonly document_json: unknown
  readonly definition_sha256: unknown
  readonly created_at_campaign_minute: unknown
}
interface ReceiptRow {
  readonly operation_id: unknown
  readonly command_sha256: unknown
  readonly read_set_definition_sha256: unknown
  readonly authorized: unknown
  readonly document_json: unknown
  readonly definition_sha256: unknown
  readonly evaluated_at_campaign_minute: unknown
}
export class BreedingOperationEvidenceRepositoryTransactionError extends Error {
  constructor() {
    super('Breeding operation evidence insertion requires a caller-owned SQLite transaction.')
    this.name = 'BreedingOperationEvidenceRepositoryTransactionError'
  }
}
export class BreedingOperationEvidenceIdentityCollisionError extends Error {
  readonly operationId: BreedingOperationId
  constructor(operationId: BreedingOperationId) {
    super(`Breeding operation evidence ${operationId} permits exact stable-JSON replay only.`)
    this.name = 'BreedingOperationEvidenceIdentityCollisionError'
    this.operationId = operationId
  }
}
const READ_SET_TABLE = 'breeding_read_sets'
const RECEIPT_TABLE = 'breeding_authorization_receipts'
const OVERRIDE_TABLE = 'breeding_gm_overrides'
const operationId = (value: unknown): BreedingOperationId => parseBreedingOperationIdSyntax(value)
  ?? (() => { throw new Error('operationId must be a Breeding operation ID.') })()
const same = (left: unknown, right: unknown): boolean => stableJsonStringify(left) === stableJsonStringify(right)
const strictGmOverrideInput = (value: unknown, operation: BreedingOperationId): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 8
    || Object.getOwnPropertySymbols(value).length > 0) {
    throw new BreedingOperationEvidenceIdentityCollisionError(operation)
  }
  const names = Object.getOwnPropertyNames(value)
  if (names.length !== value.length + 1
    || names.some(name => name !== 'length' && !/^(0|[1-9][0-9]*)$/u.test(name))) {
    throw new BreedingOperationEvidenceIdentityCollisionError(operation)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new BreedingOperationEvidenceIdentityCollisionError(operation)
    }
  }
  return value
}
let savepointOrdinal = 0
const nextSavepoint = (): string => `breeding_operation_evidence_${savepointOrdinal = (savepointOrdinal + 1) % 1_000_000}`

export const createSqliteBreedingOperationEvidenceRepository = (
  database: RotomDatabase = getRotomDatabase(),
): BreedingOperationEvidenceRepository => {
  const get = (operationIdInput: BreedingOperationId | string): BreedingOperationAuthorityEvidenceV1 | null => {
    const identity = operationId(operationIdInput)
    const readRow = database.connection.prepare(`
      SELECT read_set_id, operation_id, command_sha256, document_json,
             definition_sha256, captured_at_campaign_minute
      FROM breeding_read_sets WHERE operation_id = ?
    `).get(identity) as unknown as ReadSetRow | undefined
    const receiptRow = database.connection.prepare(`
      SELECT operation_id, command_sha256, read_set_definition_sha256, authorized,
             document_json, definition_sha256, evaluated_at_campaign_minute
      FROM breeding_authorization_receipts WHERE operation_id = ?
    `).get(identity) as unknown as ReceiptRow | undefined
    const overrideRows = database.connection.prepare(`
      SELECT override_id, operation_id, command_sha256, override_kind,
             document_json, definition_sha256, created_at_campaign_minute
      FROM breeding_gm_overrides WHERE operation_id = ? ORDER BY override_id
    `).all(identity) as unknown as OverrideRow[]
    if (!readRow && !receiptRow && overrideRows.length === 0) return null
    if (!readRow || !receiptRow) {
      throw new BreedingRepositoryCorruptionError(
        !readRow ? READ_SET_TABLE : RECEIPT_TABLE,
        identity,
        'complete read-set and authorization-receipt pair',
      )
    }
    const readSet = parseStrictStoredBreedingJson({
      table: READ_SET_TABLE,
      identity,
      json: readRow.document_json,
      parse: parseAuthoritativeBreedingOperationReadSetV1,
    })
    const receipt = parseStrictStoredBreedingJson({
      table: RECEIPT_TABLE,
      identity,
      json: receiptRow.document_json,
      parse: parseAuthoritativeBreedingAuthorizationReceiptV1,
    })
    const gmOverrides = Object.freeze(overrideRows.map(row => {
      const overrideIdentity = typeof row.override_id === 'string' ? row.override_id : 'unknown'
      const override = parseStrictStoredBreedingJson({
        table: OVERRIDE_TABLE,
        identity: overrideIdentity,
        json: row.document_json,
        parse: parseAuthoritativeBreedingGmOverrideEvidenceV1,
      })
      const created = parseBreedingRepositoryCampaignMinute(
        row.created_at_campaign_minute,
        `${OVERRIDE_TABLE}.${overrideIdentity}.created_at_campaign_minute`,
      )
      const valid = override.overrideId === row.override_id
        && override.operationId === identity
        && override.operationId === row.operation_id
        && override.commandSha256 === row.command_sha256
        && override.overrideKind === row.override_kind
        && override.definitionSha256 === row.definition_sha256
        && override.createdAtCampaignMinute === created
      if (!valid) throw new BreedingRepositoryCorruptionError(OVERRIDE_TABLE, overrideIdentity, 'duplicated identity, operation, hash, kind, or campaign-minute columns')
      return override
    }))
    const readMinute = parseBreedingRepositoryCampaignMinute(
      readRow.captured_at_campaign_minute,
      `${READ_SET_TABLE}.${identity}.captured_at_campaign_minute`,
    )
    const receiptMinute = parseBreedingRepositoryCampaignMinute(
      receiptRow.evaluated_at_campaign_minute,
      `${RECEIPT_TABLE}.${identity}.evaluated_at_campaign_minute`,
    )
    const authorized = parseBreedingRepositoryRevision(
      receiptRow.authorized,
      `${RECEIPT_TABLE}.${identity}.authorized`,
    )
    const valid = readSet.operationId === identity
      && readSet.readSetId === readRow.read_set_id
      && readSet.commandSha256 === readRow.command_sha256
      && readSet.definitionSha256 === readRow.definition_sha256
      && readSet.capturedAtCampaignMinute === readMinute
      && receipt.operationId === identity
      && receipt.commandSha256 === receiptRow.command_sha256
      && receipt.readSetDefinitionSha256 === receiptRow.read_set_definition_sha256
      && Number(receipt.authorized) === authorized
      && receipt.definitionSha256 === receiptRow.definition_sha256
      && receipt.evaluatedAtCampaignMinute === receiptMinute
      && receipt.commandSha256 === readSet.commandSha256
      && receipt.readSetDefinitionSha256 === readSet.definitionSha256
      && receipt.evaluatedAtCampaignMinute === readSet.capturedAtCampaignMinute
      && stableJsonStringify(receipt.gmOverrideIds) === stableJsonStringify(gmOverrides.map(value => value.overrideId))
      && gmOverrides.every(value => value.actorAuthorityDefinitionSha256 === receipt.actorAuthorityDefinitionSha256
        && value.createdAtCampaignMinute === receipt.evaluatedAtCampaignMinute
        && value.securityPolicyDefinitionSha256 === receipt.securityPolicyDefinitionSha256)
    if (!valid) {
      throw new BreedingRepositoryCorruptionError(
        RECEIPT_TABLE,
        identity,
        'duplicated identity, hash, authorization, read-set, or campaign-minute columns',
      )
    }
    return Object.freeze({ readSet, authorizationReceipt: receipt, gmOverrides })
  }

  const insert: BreedingOperationEvidenceRepository['insert'] = input => {
    if (!database.connection.isTransaction) throw new BreedingOperationEvidenceRepositoryTransactionError()
    const command = parseBreedingOperationCommandV1(input.command)
    const readSet = validateBreedingOperationReadSetCompleteness(command, input.readSet)
    const receipt = parseAuthoritativeBreedingAuthorizationReceiptV1(input.authorizationReceipt)
    const commandSha256 = createBreedingOperationCommandHash(command)
    const gmOverrides = Object.freeze(strictGmOverrideInput(input.gmOverrides ?? [], command.operationId)
      .map((value, index) => parseAuthoritativeBreedingGmOverrideEvidenceV1(value, `gmOverrides[${index}]`))
      .sort((left, right) => left.overrideId < right.overrideId ? -1 : left.overrideId > right.overrideId ? 1 : 0))
    if (receipt.operationId !== command.operationId || receipt.commandSha256 !== commandSha256
      || receipt.commandKind !== command.commandKind
      || receipt.readSetDefinitionSha256 !== readSet.definitionSha256
      || receipt.evaluatedAtCampaignMinute !== readSet.capturedAtCampaignMinute
      || stableJsonStringify(receipt.gmOverrideIds) !== stableJsonStringify(gmOverrides.map(value => value.overrideId))
      || gmOverrides.some(value => value.operationId !== command.operationId
        || value.commandSha256 !== commandSha256
        || value.actorAuthorityDefinitionSha256 !== receipt.actorAuthorityDefinitionSha256
        || value.createdAtCampaignMinute !== receipt.evaluatedAtCampaignMinute
        || value.securityPolicyDefinitionSha256 !== receipt.securityPolicyDefinitionSha256)) {
      throw new BreedingOperationEvidenceIdentityCollisionError(command.operationId)
    }
    const proposed = Object.freeze({ readSet, authorizationReceipt: receipt, gmOverrides })
    const existing = get(command.operationId)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, proposed)) return existing
      throw new BreedingOperationEvidenceIdentityCollisionError(command.operationId)
    }
    const savepoint = nextSavepoint()
    database.connection.exec(`SAVEPOINT ${savepoint}`)
    try {
      database.connection.prepare(`
        INSERT INTO breeding_read_sets (
          read_set_id, operation_id, command_sha256, document_json,
          definition_sha256, captured_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        readSet.readSetId,
        readSet.operationId,
        readSet.commandSha256,
        stableJsonStringify(readSet),
        readSet.definitionSha256,
        readSet.capturedAtCampaignMinute,
      )
      for (const override of gmOverrides) database.connection.prepare(`
        INSERT INTO breeding_gm_overrides (
          override_id, operation_id, command_sha256, override_kind,
          document_json, definition_sha256, created_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        override.overrideId,
        override.operationId,
        override.commandSha256,
        override.overrideKind,
        stableJsonStringify(override),
        override.definitionSha256,
        override.createdAtCampaignMinute,
      )
      database.connection.prepare(`
        INSERT INTO breeding_authorization_receipts (
          operation_id, command_sha256, read_set_definition_sha256, authorized,
          document_json, definition_sha256, evaluated_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        receipt.operationId,
        receipt.commandSha256,
        receipt.readSetDefinitionSha256,
        Number(receipt.authorized),
        stableJsonStringify(receipt),
        receipt.definitionSha256,
        receipt.evaluatedAtCampaignMinute,
      )
      database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
    }
    catch (error) {
      database.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      database.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
      const raced = get(command.operationId)
      if (raced && same(raced, proposed)) return raced
      if (raced) throw new BreedingOperationEvidenceIdentityCollisionError(command.operationId)
      throw error
    }
    return get(command.operationId) ?? (() => { throw new Error('Inserted Breeding operation evidence was not readable.') })()
  }

  return Object.freeze({ database, get, insert })
}
