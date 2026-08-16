import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseEquipmentOperationCommand,
  parseEquipmentOperationResult,
  type EquipmentOperationCommandV1,
  type EquipmentOperationResultV1,
} from '#shared/itemAutomation/equipmentOperations'
import type { EquipmentOwnerKind } from '#shared/itemAutomation/equipment'
import type { InventoryEntry } from '~/types/trainerSheet'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  cloneStoredJson,
  parseStoredDocumentJson,
  parseStoredTimestamp,
  stringifyStoredDocument,
} from './documentJson'

export const EQUIPMENT_OPERATION_STORE_SCHEMA_VERSION = 1 as const

export type EquipmentOperationResourceEvidenceV1 =
  | {
    readonly kind: 'sheet'
    readonly sheetKind: EquipmentOwnerKind
    readonly slug: string
    readonly beforeRevision: number
    readonly afterRevision: number
    readonly beforeDocument: Record<string, unknown>
    readonly afterDocument: Record<string, unknown>
  }
  | {
    readonly kind: 'group-inventory'
    readonly slug: string
    readonly beforeRevision: number
    readonly afterRevision: number
    readonly beforeDocument: Record<string, unknown>
    readonly afterDocument: Record<string, unknown>
  }

export interface EquipmentOperationEvidenceV1 {
  readonly schemaVersion: typeof EQUIPMENT_OPERATION_STORE_SCHEMA_VERSION
  readonly operationId: string
  readonly sourceInventoryRow: InventoryEntry | null
  readonly resources: readonly EquipmentOperationResourceEvidenceV1[]
}

export interface StoredEquipmentOperationRecord {
  readonly schemaVersion: typeof EQUIPMENT_OPERATION_STORE_SCHEMA_VERSION
  readonly operationId: string
  readonly commandSha256: string
  readonly command: EquipmentOperationCommandV1
  readonly result: EquipmentOperationResultV1
  readonly evidence: EquipmentOperationEvidenceV1
  readonly createdAt: number
}

export interface EquipmentOperationRepository {
  readonly database?: RotomDatabase
  get(operationId: string): StoredEquipmentOperationRecord | null
  saveAccepted(input: {
    readonly command: EquipmentOperationCommandV1
    readonly result: EquipmentOperationResultV1
    readonly evidence: EquipmentOperationEvidenceV1
    readonly createdAt?: number
  }): StoredEquipmentOperationRecord
}

interface EquipmentOperationRow {
  readonly operation_id: unknown
  readonly command_sha256: unknown
  readonly command_kind: unknown
  readonly actor_profile_id: unknown
  readonly command_json: unknown
  readonly result_json: unknown
  readonly evidence_json: unknown
  readonly created_at: unknown
}

const SHA256 = /^[a-f0-9]{64}$/
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
export const equipmentOperationCommandSha256 = (command: EquipmentOperationCommandV1): string => hash(command)

const parseEvidence = (value: unknown, command: EquipmentOperationCommandV1): EquipmentOperationEvidenceV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Equipment operation evidence must be an object.')
  const input = value as Record<string, unknown>
  if (input.schemaVersion !== EQUIPMENT_OPERATION_STORE_SCHEMA_VERSION
    || input.operationId !== command.operationId
    || !Array.isArray(input.resources)
    || input.resources.length < 1
    || input.resources.length > 4
    || (input.sourceInventoryRow !== null
      && (!input.sourceInventoryRow || typeof input.sourceInventoryRow !== 'object' || Array.isArray(input.sourceInventoryRow)))) {
    throw new Error('Equipment operation evidence is malformed.')
  }
  for (const [index, resource] of input.resources.entries()) {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
      throw new Error(`Equipment operation evidence resource ${index} is malformed.`)
    }
    const row = resource as Record<string, unknown>
    if ((row.kind !== 'sheet' && row.kind !== 'group-inventory')
      || typeof row.slug !== 'string'
      || !Number.isSafeInteger(row.beforeRevision)
      || !Number.isSafeInteger(row.afterRevision)
      || Number(row.afterRevision) !== Number(row.beforeRevision) + 1
      || !row.beforeDocument || typeof row.beforeDocument !== 'object' || Array.isArray(row.beforeDocument)
      || !row.afterDocument || typeof row.afterDocument !== 'object' || Array.isArray(row.afterDocument)
      || (row.kind === 'sheet' && row.sheetKind !== 'trainer' && row.sheetKind !== 'pokemon')) {
      throw new Error(`Equipment operation evidence resource ${index} is malformed.`)
    }
  }
  return cloneStoredJson(value as EquipmentOperationEvidenceV1)
}

const rowToRecord = (row: EquipmentOperationRow): StoredEquipmentOperationRecord => {
  if (typeof row.command_json !== 'string' || typeof row.result_json !== 'string' || typeof row.evidence_json !== 'string') {
    throw new Error('Equipment operation JSON columns must contain text.')
  }
  const command = parseEquipmentOperationCommand(parseStoredDocumentJson(row.command_json, 'equipment operation command'))
  if (row.operation_id !== command.operationId || row.command_kind !== command.commandKind
    || row.actor_profile_id !== command.actorProfileId) throw new Error(`Equipment operation ${command.operationId} columns drifted from its command.`)
  if (typeof row.command_sha256 !== 'string' || !SHA256.test(row.command_sha256)
    || row.command_sha256 !== equipmentOperationCommandSha256(command)) {
    throw new Error(`Equipment operation ${command.operationId} command hash drifted.`)
  }
  const result = parseEquipmentOperationResult(parseStoredDocumentJson(row.result_json, 'equipment operation result'))
  if (result.operationId !== command.operationId || result.commandKind !== command.commandKind || result.exactReplay) {
    throw new Error(`Equipment operation ${command.operationId} result drifted.`)
  }
  const evidence = parseEvidence(parseStoredDocumentJson(row.evidence_json, 'equipment operation evidence'), command)
  return Object.freeze({
    schemaVersion: EQUIPMENT_OPERATION_STORE_SCHEMA_VERSION,
    operationId: command.operationId,
    commandSha256: row.command_sha256,
    command,
    result,
    evidence,
    createdAt: parseStoredTimestamp(row.created_at, `equipment operation ${command.operationId} createdAt`),
  })
}

export const createSqliteEquipmentOperationRepository = (options: {
  readonly database?: RotomDatabase
  readonly clock?: () => number
} = {}): EquipmentOperationRepository => {
  const database = options.database ?? getRotomDatabase()
  const clock = options.clock ?? Date.now
  const get = (operationId: string): StoredEquipmentOperationRecord | null => {
    const row = database.connection.prepare(`
      SELECT operation_id, command_sha256, command_kind, actor_profile_id,
        command_json, result_json, evidence_json, created_at
      FROM equipment_operations
      WHERE operation_id = ?
    `).get(operationId) as EquipmentOperationRow | undefined
    return row ? rowToRecord(row) : null
  }
  const saveAccepted: EquipmentOperationRepository['saveAccepted'] = input => database.withTransaction(() => {
    const command = parseEquipmentOperationCommand(input.command)
    const result = parseEquipmentOperationResult(input.result)
    const evidence = parseEvidence(input.evidence, command)
    if (result.operationId !== command.operationId || result.commandKind !== command.commandKind || result.exactReplay) {
      throw new Error('Stored equipment result must be the non-replay result for its exact command.')
    }
    const commandSha256 = equipmentOperationCommandSha256(command)
    const existing = get(command.operationId)
    if (existing) {
      if (existing.commandSha256 !== commandSha256
        || stableJsonStringify(existing.command) !== stableJsonStringify(command)) {
        throw new Error(`Equipment operation ${command.operationId} was reused for a different command.`)
      }
      return existing
    }
    const createdAt = parseStoredTimestamp(input.createdAt ?? clock(), 'equipment operation createdAt')
    database.connection.prepare(`
      INSERT INTO equipment_operations (
        operation_id, command_sha256, command_kind, actor_profile_id,
        command_json, result_json, evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      command.operationId,
      commandSha256,
      command.commandKind,
      command.actorProfileId,
      stringifyStoredDocument(command),
      stringifyStoredDocument(result),
      stringifyStoredDocument(evidence),
      createdAt,
    )
    return get(command.operationId) ?? (() => { throw new Error('Equipment operation disappeared after insert.') })()
  })
  return { database, get, saveAccepted }
}
