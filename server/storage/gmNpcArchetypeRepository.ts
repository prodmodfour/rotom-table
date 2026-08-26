import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseNpcArchetypePolicyV1, type NpcArchetypePolicyV1 } from '#shared/gmToolkit/npcArchetypes'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface GmNpcArchetypeOperationRecord {
  readonly operationId: string
  readonly commandSha256: string
  readonly commandKind: 'create' | 'update' | 'archive' | 'restore' | 'copy'
  readonly archetypeId: string
  readonly expectedRevision: number | null
  readonly command: unknown
  readonly result: NpcArchetypePolicyV1
  readonly createdAt: string
}
export interface GmNpcArchetypeRepository {
  readonly database: RotomDatabase
  list(): readonly NpcArchetypePolicyV1[]
  get(archetypeId: string): NpcArchetypePolicyV1 | null
  create(policy: NpcArchetypePolicyV1): NpcArchetypePolicyV1
  replace(policy: NpcArchetypePolicyV1, expectedRevision: number): NpcArchetypePolicyV1 | null
  getOperation(operationId: string): GmNpcArchetypeOperationRecord | null
  createOperation(record: GmNpcArchetypeOperationRecord): GmNpcArchetypeOperationRecord
}

interface PolicyRow { readonly archetype_id: unknown; readonly document_json: unknown; readonly revision: unknown; readonly status: unknown; readonly name_normalized: unknown; readonly updated_at: unknown }
interface OperationRow { readonly operation_id: unknown; readonly command_sha256: unknown; readonly command_kind: unknown; readonly archetype_id: unknown; readonly expected_revision: unknown; readonly command_json: unknown; readonly result_json: unknown; readonly result_revision: unknown; readonly created_at: unknown }
const ID = /^npc-archetype:v1:[a-z0-9]+(?:-[a-z0-9]+)*$/
const OP = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const SHA = /^[a-f0-9]{64}$/
const parsePolicyRow = (row: PolicyRow): NpcArchetypePolicyV1 => {
  if (typeof row.document_json !== 'string') throw new Error('Stored NPC archetype JSON is malformed')
  const policy = parseNpcArchetypePolicyV1(JSON.parse(row.document_json))
  if (row.archetype_id !== policy.archetypeId || row.revision !== policy.revision || row.status !== policy.status
    || row.name_normalized !== policy.name.toLocaleLowerCase('en-US') || row.updated_at !== policy.updatedAt) {
    throw new Error(`NPC archetype ${policy.archetypeId} stored columns contradict its document`)
  }
  return policy
}
const parseOperationRow = (row: OperationRow): GmNpcArchetypeOperationRecord => {
  if (typeof row.operation_id !== 'string' || !OP.test(row.operation_id) || typeof row.command_sha256 !== 'string' || !SHA.test(row.command_sha256)
    || !['create', 'update', 'archive', 'restore', 'copy'].includes(String(row.command_kind)) || typeof row.archetype_id !== 'string'
    || typeof row.command_json !== 'string' || typeof row.result_json !== 'string' || typeof row.created_at !== 'string') throw new Error('Stored NPC archetype operation is malformed')
  const result = parseNpcArchetypePolicyV1(JSON.parse(row.result_json))
  if (result.archetypeId !== row.archetype_id || result.revision !== row.result_revision) throw new Error(`NPC archetype operation ${row.operation_id} contradicts its result`)
  return { operationId: row.operation_id, commandSha256: row.command_sha256, commandKind: row.command_kind as GmNpcArchetypeOperationRecord['commandKind'], archetypeId: row.archetype_id, expectedRevision: row.expected_revision === null ? null : Number(row.expected_revision), command: JSON.parse(row.command_json), result, createdAt: row.created_at }
}

export const createSqliteGmNpcArchetypeRepository = (database: RotomDatabase = getRotomDatabase()): GmNpcArchetypeRepository => {
  const list = (): readonly NpcArchetypePolicyV1[] => (database.connection.prepare(`SELECT archetype_id, document_json, revision, status, name_normalized, updated_at FROM gm_npc_archetypes ORDER BY status, name_normalized, archetype_id`).all() as unknown as PolicyRow[]).map(parsePolicyRow)
  const get = (archetypeId: string): NpcArchetypePolicyV1 | null => {
    if (!ID.test(archetypeId)) throw new Error('NPC archetype ID is invalid')
    const row = database.connection.prepare(`SELECT archetype_id, document_json, revision, status, name_normalized, updated_at FROM gm_npc_archetypes WHERE archetype_id = ?`).get(archetypeId) as unknown as PolicyRow | undefined
    return row ? parsePolicyRow(row) : null
  }
  const create = (policyInput: NpcArchetypePolicyV1): NpcArchetypePolicyV1 => {
    const policy = parseNpcArchetypePolicyV1(policyInput)
    if (policy.revision !== 0) throw new Error('A new NPC archetype must begin at revision 0')
    database.connection.prepare(`INSERT INTO gm_npc_archetypes (archetype_id, document_json, revision, status, name_normalized, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(policy.archetypeId, stableJsonStringify(policy), policy.revision, policy.status, policy.name.toLocaleLowerCase('en-US'), policy.updatedAt)
    return policy
  }
  const replace = (policyInput: NpcArchetypePolicyV1, expectedRevision: number): NpcArchetypePolicyV1 | null => {
    const policy = parseNpcArchetypePolicyV1(policyInput)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || policy.revision !== expectedRevision + 1) throw new Error('NPC archetype replacement must advance the expected revision exactly once')
    const result = database.connection.prepare(`UPDATE gm_npc_archetypes SET document_json = ?, revision = ?, status = ?, name_normalized = ?, updated_at = ? WHERE archetype_id = ? AND revision = ?`).run(stableJsonStringify(policy), policy.revision, policy.status, policy.name.toLocaleLowerCase('en-US'), policy.updatedAt, policy.archetypeId, expectedRevision)
    return result.changes === 1 ? policy : null
  }
  const getOperation = (operationId: string): GmNpcArchetypeOperationRecord | null => {
    if (!OP.test(operationId)) throw new Error('NPC archetype operation ID is invalid')
    const row = database.connection.prepare(`SELECT operation_id, command_sha256, command_kind, archetype_id, expected_revision, command_json, result_json, result_revision, created_at FROM gm_npc_archetype_ops WHERE operation_id = ?`).get(operationId) as unknown as OperationRow | undefined
    return row ? parseOperationRow(row) : null
  }
  const createOperation = (record: GmNpcArchetypeOperationRecord): GmNpcArchetypeOperationRecord => {
    if (!OP.test(record.operationId) || !SHA.test(record.commandSha256) || !['create', 'update', 'archive', 'restore', 'copy'].includes(record.commandKind)
      || record.result.archetypeId !== record.archetypeId) throw new Error('NPC archetype operation is inconsistent')
    database.connection.prepare(`INSERT INTO gm_npc_archetype_ops (operation_id, command_sha256, command_kind, archetype_id, expected_revision, command_json, result_json, result_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.operationId, record.commandSha256, record.commandKind, record.archetypeId, record.expectedRevision, stableJsonStringify(record.command), stableJsonStringify(record.result), record.result.revision, record.createdAt)
    return record
  }
  return { database, list, get, create, replace, getOperation, createOperation }
}
