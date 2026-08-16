import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, deepFreezeStrictJson, type StrictJsonValue } from '#shared/automation/strictJson'
import {
  parseExecuteItemFormChangeCommand,
  parseItemFormChangePublicResult,
  type ExecuteItemFormChangeCommandV1,
  type ItemFormChangePublicResultV1,
} from '#shared/itemAutomation/formChanges'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface StoredItemFormChangeOperation {
  readonly commandSha256: string
  readonly principalKey: string
  readonly command: ExecuteItemFormChangeCommandV1
  readonly result: ItemFormChangePublicResultV1
  readonly evidence: StrictJsonValue
  readonly createdAt: number
}

export interface ItemFormChangeOperationRepository {
  readonly database?: RotomDatabase
  readonly find: (operationId: string) => StoredItemFormChangeOperation | null
  readonly insert: (input: StoredItemFormChangeOperation) => StoredItemFormChangeOperation
}

interface Row {
  readonly command_sha256: unknown
  readonly principal_key: unknown
  readonly map_slug: unknown
  readonly command_json: unknown
  readonly result_json: unknown
  readonly evidence_json: unknown
  readonly result_revision: unknown
  readonly created_at: unknown
}

const SHA256 = /^[a-f0-9]{64}$/
const parseEvidence = (value: unknown): StrictJsonValue => deepFreezeStrictJson(cloneStrictJson(
  value,
  'itemFormChangeEvidence',
  {
    limits: { depth: 16, nodes: 20_000, objectFields: 256, arrayEntries: 1_024, stringLength: 2_000, objectKeyLength: 160 },
    rootLabel: 'item form-change evidence', valueLabel: 'item form-change evidence values',
    failNotJson: (_path, detail) => { throw new Error(detail) },
    failLimit: (_path, detail) => { throw new Error(detail) },
  },
))

const rowRecord = (row: Row | undefined): StoredItemFormChangeOperation | null => {
  if (!row) return null
  if (typeof row.command_sha256 !== 'string' || !SHA256.test(row.command_sha256)
    || typeof row.principal_key !== 'string' || !row.principal_key
    || typeof row.command_json !== 'string' || typeof row.result_json !== 'string'
    || typeof row.evidence_json !== 'string' || !Number.isSafeInteger(row.result_revision)
    || !Number.isSafeInteger(row.created_at)) {
    throw new Error('Stored item form-change operation is malformed.')
  }
  const command = parseExecuteItemFormChangeCommand(JSON.parse(row.command_json))
  const result = parseItemFormChangePublicResult(JSON.parse(row.result_json))
  const evidence = parseEvidence(JSON.parse(row.evidence_json))
  if (row.map_slug !== command.mapSlug || row.map_slug !== result.mapSlug
    || row.result_revision !== result.mapRevision
    || command.operationId !== result.operationId
    || row.command_json !== stableJsonStringify(command)
    || row.result_json !== stableJsonStringify(result)
    || row.evidence_json !== stableJsonStringify(evidence)) {
    throw new Error('Stored item form-change operation indexes or canonical JSON disagree.')
  }
  return Object.freeze({
    commandSha256: row.command_sha256,
    principalKey: row.principal_key,
    command,
    result,
    evidence,
    createdAt: Number(row.created_at),
  })
}

export const createSqliteItemFormChangeOperationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): ItemFormChangeOperationRepository => {
  const find = (operationId: string): StoredItemFormChangeOperation | null => rowRecord(
    database.connection.prepare(`
      SELECT command_sha256, principal_key, map_slug, command_json, result_json,
             evidence_json, result_revision, created_at
      FROM item_form_change_operations
      WHERE operation_id = ?
    `).get(operationId) as unknown as Row | undefined,
  )
  const insert: ItemFormChangeOperationRepository['insert'] = input => database.withTransaction(() => {
    const command = parseExecuteItemFormChangeCommand(input.command)
    const result = parseItemFormChangePublicResult(input.result)
    const evidence = parseEvidence(input.evidence)
    if (!SHA256.test(input.commandSha256) || !input.principalKey.trim()
      || command.operationId !== result.operationId || command.mapSlug !== result.mapSlug) {
      throw new Error('Item form-change operation identity is invalid.')
    }
    database.connection.prepare(`
      INSERT INTO item_form_change_operations (
        operation_id, command_sha256, principal_key, map_slug, command_json,
        result_json, evidence_json, result_revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      command.operationId,
      input.commandSha256,
      input.principalKey,
      command.mapSlug,
      stableJsonStringify(command),
      stableJsonStringify(result),
      stableJsonStringify(evidence),
      result.mapRevision,
      input.createdAt,
    )
    const stored = find(command.operationId)
    if (!stored) throw new Error('Item form-change operation was not readable after insert.')
    return stored
  })
  return { database, find, insert }
}
