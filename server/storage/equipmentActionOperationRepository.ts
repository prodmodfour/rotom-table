import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, deepFreezeStrictJson, type StrictJsonValue } from '#shared/automation/strictJson'
import {
  parseEquipmentActionPublicResult,
  parseExecuteEquipmentActionCommand,
  type EquipmentActionPublicResultV1,
  type ExecuteEquipmentActionCommandV1,
} from '#shared/itemAutomation/equipmentActions'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface StoredEquipmentActionOperation {
  readonly commandSha256: string
  readonly principalKey: string
  readonly command: ExecuteEquipmentActionCommandV1
  readonly result: EquipmentActionPublicResultV1
  readonly evidence: StrictJsonValue
  readonly createdAt: number
}

export interface EquipmentActionOperationRepository {
  readonly database?: RotomDatabase
  find(operationId: string): StoredEquipmentActionOperation | null
  listForMap(mapSlug: string, limit?: number): readonly StoredEquipmentActionOperation[]
  insert(input: StoredEquipmentActionOperation): StoredEquipmentActionOperation
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

const SHA256 = /^[a-f0-9]{64}$/u
const parseEvidence = (value: unknown): StrictJsonValue => deepFreezeStrictJson(cloneStrictJson(
  value,
  'equipmentActionEvidence',
  {
    limits: { depth: 20, nodes: 40_000, objectFields: 256, arrayEntries: 4_096, stringLength: 4_000, objectKeyLength: 180 },
    rootLabel: 'equipment action evidence', valueLabel: 'equipment action evidence values',
    failNotJson: (_path, detail) => { throw new Error(detail) },
    failLimit: (_path, detail) => { throw new Error(detail) },
  },
))

const rowRecord = (row: Row | undefined): StoredEquipmentActionOperation | null => {
  if (!row) return null
  if (typeof row.command_sha256 !== 'string' || !SHA256.test(row.command_sha256)
    || typeof row.principal_key !== 'string' || !row.principal_key
    || typeof row.command_json !== 'string' || typeof row.result_json !== 'string'
    || typeof row.evidence_json !== 'string' || !Number.isSafeInteger(row.result_revision)
    || !Number.isSafeInteger(row.created_at)) throw new Error('Stored equipment action operation is malformed.')
  const command = parseExecuteEquipmentActionCommand(JSON.parse(row.command_json))
  const result = parseEquipmentActionPublicResult(JSON.parse(row.result_json))
  const evidence = parseEvidence(JSON.parse(row.evidence_json))
  if (row.map_slug !== command.mapSlug || row.map_slug !== result.mapSlug
    || row.result_revision !== result.mapRevision
    || command.operationId !== result.operationId
    || row.command_json !== stableJsonStringify(command)
    || row.result_json !== stableJsonStringify(result)
    || row.evidence_json !== stableJsonStringify(evidence)) {
    throw new Error('Stored equipment action operation indexes or canonical JSON disagree.')
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

export const createSqliteEquipmentActionOperationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): EquipmentActionOperationRepository => {
  const find = (operationId: string): StoredEquipmentActionOperation | null => rowRecord(
    database.connection.prepare(`
      SELECT command_sha256, principal_key, map_slug, command_json, result_json,
             evidence_json, result_revision, created_at
      FROM equipment_action_operations
      WHERE operation_id = ?
    `).get(operationId) as unknown as Row | undefined,
  )
  const listForMap: EquipmentActionOperationRepository['listForMap'] = (mapSlug, limit = 200) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/u.test(mapSlug)
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('Equipment action history query is invalid.')
    }
    return Object.freeze((database.connection.prepare(`
      SELECT command_sha256, principal_key, map_slug, command_json, result_json,
             evidence_json, result_revision, created_at
      FROM equipment_action_operations
      WHERE map_slug = ?
      ORDER BY result_revision DESC, created_at DESC, operation_id DESC
      LIMIT ?
    `).all(mapSlug, limit) as unknown as Row[]).map(row => rowRecord(row)!))
  }
  const insert: EquipmentActionOperationRepository['insert'] = input => database.withTransaction(() => {
    const command = parseExecuteEquipmentActionCommand(input.command)
    const result = parseEquipmentActionPublicResult(input.result)
    const evidence = parseEvidence(input.evidence)
    if (!SHA256.test(input.commandSha256) || !input.principalKey.trim()
      || command.operationId !== result.operationId || command.mapSlug !== result.mapSlug) {
      throw new Error('Equipment action operation identity is invalid.')
    }
    database.connection.prepare(`
      INSERT INTO equipment_action_operations (
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
    if (!stored) throw new Error('Equipment action operation was not readable after insert.')
    return stored
  })
  return Object.freeze({ database, find, listForMap, insert })
}
