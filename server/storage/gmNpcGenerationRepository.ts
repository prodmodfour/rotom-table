import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseNpcGenerationCommitCommandV1,
  parseNpcGenerationPreviewCommandV1,
  type NpcGenerationCommitCommandV1,
  type NpcGenerationCommitProjectionV1,
  type NpcGenerationPreviewCommandV1,
} from '#shared/gmToolkit/npcGeneration'
import type { WildGenerationJournalDrawV1 } from '#shared/gmToolkit/generation'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface GmNpcGenerationAcceptedRecord {
  readonly command: NpcGenerationCommitCommandV1
  readonly commandSha256: string
  readonly previewCommand: NpcGenerationPreviewCommandV1
  readonly previewCommandSha256: string
  readonly previewHash: string
  readonly seed: string
  readonly journal: readonly WildGenerationJournalDrawV1[]
  readonly result: NpcGenerationCommitProjectionV1
  readonly createdAt: string
}
export interface GmNpcGenerationRepository {
  readonly database: RotomDatabase
  get(operationId: string): GmNpcGenerationAcceptedRecord | null
  getByPackageId(packageId: string): GmNpcGenerationAcceptedRecord | null
  create(record: GmNpcGenerationAcceptedRecord): GmNpcGenerationAcceptedRecord
}
interface Row { readonly operation_id: unknown; readonly command_sha256: unknown; readonly command_json: unknown; readonly preview_command_sha256: unknown; readonly preview_hash: unknown; readonly archetype_id: unknown; readonly archetype_revision: unknown; readonly seed: unknown; readonly journal_json: unknown; readonly result_json: unknown; readonly created_at: unknown; readonly package_id: unknown; readonly trainer_slug: unknown; readonly package_json: unknown }
const OP = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const SHA = /^[a-f0-9]{64}$/
const sha = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
export const npcGenerationCommandSha256 = (command: NpcGenerationCommitCommandV1): string => sha(parseNpcGenerationCommitCommandV1(command))
export const npcPreviewCommandSha256 = (command: NpcGenerationPreviewCommandV1): string => sha(parseNpcGenerationPreviewCommandV1(command))
const parseRow = (row: Row): GmNpcGenerationAcceptedRecord => {
  if (typeof row.operation_id !== 'string' || !OP.test(row.operation_id) || typeof row.command_sha256 !== 'string' || !SHA.test(row.command_sha256)
    || typeof row.preview_command_sha256 !== 'string' || !SHA.test(row.preview_command_sha256) || typeof row.preview_hash !== 'string' || !SHA.test(row.preview_hash)
    || typeof row.seed !== 'string' || !SHA.test(row.seed) || typeof row.command_json !== 'string' || typeof row.result_json !== 'string'
    || typeof row.journal_json !== 'string' || typeof row.package_json !== 'string' || typeof row.created_at !== 'string') throw new Error('Stored NPC generation operation is malformed')
  const command = parseNpcGenerationCommitCommandV1(JSON.parse(row.command_json))
  const privateResult = JSON.parse(row.result_json) as { readonly previewCommand: unknown; readonly projection: NpcGenerationCommitProjectionV1 }
  const previewCommand = parseNpcGenerationPreviewCommandV1(privateResult.previewCommand)
  const result = privateResult.projection
  if (command.operationId !== row.operation_id || result.operationId !== row.operation_id || result.packageId !== row.package_id
    || result.trainer.slug !== row.trainer_slug || previewCommand.archetypeId !== row.archetype_id || previewCommand.expectedArchetypeRevision !== row.archetype_revision
    || npcGenerationCommandSha256(command) !== row.command_sha256 || npcPreviewCommandSha256(previewCommand) !== row.preview_command_sha256
    || stableJsonStringify(JSON.parse(row.package_json)) !== stableJsonStringify(result)) throw new Error(`NPC generation operation ${row.operation_id} contradicts stored columns`)
  return { command, commandSha256: row.command_sha256, previewCommand, previewCommandSha256: row.preview_command_sha256, previewHash: row.preview_hash, seed: row.seed, journal: JSON.parse(row.journal_json), result: { ...result, exactRetry: true }, createdAt: row.created_at }
}
const select = `SELECT op.operation_id, op.command_sha256, op.command_json, op.preview_command_sha256, op.preview_hash, op.archetype_id, op.archetype_revision, op.seed, op.journal_json, op.result_json, op.created_at, pkg.package_id, pkg.trainer_slug, pkg.package_json FROM gm_npc_generation_ops op INNER JOIN gm_npc_packages pkg ON pkg.operation_id = op.operation_id`
export const createSqliteGmNpcGenerationRepository = (database: RotomDatabase = getRotomDatabase()): GmNpcGenerationRepository => {
  const get = (operationId: string): GmNpcGenerationAcceptedRecord | null => {
    if (!OP.test(operationId)) throw new Error('NPC generation operation ID is invalid')
    const row = database.connection.prepare(`${select} WHERE op.operation_id = ?`).get(operationId) as unknown as Row | undefined
    return row ? parseRow(row) : null
  }
  const getByPackageId = (packageId: string): GmNpcGenerationAcceptedRecord | null => {
    if (!/^npc-package:v1:[a-f0-9]{32}$/.test(packageId)) throw new Error('NPC package ID is invalid')
    const row = database.connection.prepare(`${select} WHERE pkg.package_id = ?`).get(packageId) as unknown as Row | undefined
    return row ? parseRow(row) : null
  }
  const create = (record: GmNpcGenerationAcceptedRecord): GmNpcGenerationAcceptedRecord => {
    if (npcGenerationCommandSha256(record.command) !== record.commandSha256 || npcPreviewCommandSha256(record.previewCommand) !== record.previewCommandSha256
      || record.result.exactRetry || !SHA.test(record.previewHash) || !SHA.test(record.seed)) throw new Error('NPC generation record is inconsistent')
    database.connection.prepare(`INSERT INTO gm_npc_generation_ops (operation_id, command_sha256, command_json, preview_command_sha256, preview_hash, archetype_id, archetype_revision, seed, journal_json, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.command.operationId, record.commandSha256, stableJsonStringify(record.command), record.previewCommandSha256, record.previewHash, record.previewCommand.archetypeId, record.previewCommand.expectedArchetypeRevision, record.seed, stableJsonStringify(record.journal), stableJsonStringify({ previewCommand: record.previewCommand, projection: record.result }), record.createdAt)
    database.connection.prepare(`INSERT INTO gm_npc_packages (package_id, operation_id, trainer_slug, package_json, created_at) VALUES (?, ?, ?, ?, ?)`).run(record.result.packageId, record.command.operationId, record.result.trainer.slug, stableJsonStringify(record.result), record.createdAt)
    return record
  }
  return { database, get, getByPackageId, create }
}
