import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseWildGenerationCommitCommandV1,
  parseWildGenerationPreviewCommandV1,
  type WildGenerationCommitCommandV1,
  type WildGenerationCommitProjectionV1,
  type WildGenerationJournalDrawV1,
  type WildGenerationPreviewCommandV1,
} from '#shared/gmToolkit/generation'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface GmWildGenerationAcceptedRecord {
  readonly command: WildGenerationCommitCommandV1
  readonly commandSha256: string
  readonly previewCommand: WildGenerationPreviewCommandV1
  readonly previewCommandSha256: string
  readonly previewHash: string
  readonly seed: string
  readonly journal: readonly WildGenerationJournalDrawV1[]
  readonly result: WildGenerationCommitProjectionV1
  readonly createdAt: string
}

export interface GmWildGenerationRepository {
  readonly database: RotomDatabase
  get(operationId: string): GmWildGenerationAcceptedRecord | null
  getByPackageId(packageId: string): GmWildGenerationAcceptedRecord | null
  create(record: GmWildGenerationAcceptedRecord): GmWildGenerationAcceptedRecord
}

interface Row {
  readonly operation_id: unknown
  readonly command_sha256: unknown
  readonly command_json: unknown
  readonly preview_command_sha256: unknown
  readonly preview_hash: unknown
  readonly table_id: unknown
  readonly table_revision: unknown
  readonly seed: unknown
  readonly journal_json: unknown
  readonly result_json: unknown
  readonly created_at: unknown
  readonly package_id: unknown
  readonly package_json: unknown
}

const OPERATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/
const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
export const gmWildGenerationCommandSha256 = (command: WildGenerationCommitCommandV1): string => sha256(parseWildGenerationCommitCommandV1(command))
export const gmWildGenerationPreviewCommandSha256 = (command: WildGenerationPreviewCommandV1): string => sha256(parseWildGenerationPreviewCommandV1(command))

const parseRow = (row: Row): GmWildGenerationAcceptedRecord => {
  if (typeof row.operation_id !== 'string' || !OPERATION_ID.test(row.operation_id)
    || typeof row.command_json !== 'string' || typeof row.journal_json !== 'string' || typeof row.result_json !== 'string'
    || typeof row.command_sha256 !== 'string' || !SHA256.test(row.command_sha256)
    || typeof row.preview_command_sha256 !== 'string' || !SHA256.test(row.preview_command_sha256)
    || typeof row.preview_hash !== 'string' || !SHA256.test(row.preview_hash)
    || typeof row.seed !== 'string' || !SHA256.test(row.seed)
    || typeof row.created_at !== 'string') throw new Error('Stored wild generation operation columns are malformed')
  const command = parseWildGenerationCommitCommandV1(JSON.parse(row.command_json))
  const privateResult = JSON.parse(row.result_json) as {
    readonly previewCommand: unknown
    readonly projection: WildGenerationCommitProjectionV1
  }
  const previewCommand = parseWildGenerationPreviewCommandV1(privateResult.previewCommand)
  const journal = JSON.parse(row.journal_json) as WildGenerationJournalDrawV1[]
  const result = privateResult.projection
  if (command.operationId !== row.operation_id || result.operationId !== row.operation_id
    || gmWildGenerationCommandSha256(command) !== row.command_sha256
    || gmWildGenerationPreviewCommandSha256(previewCommand) !== row.preview_command_sha256
    || previewCommand.tableId !== row.table_id || previewCommand.expectedTableRevision !== row.table_revision
    || row.package_id !== result.packageId || typeof row.package_json !== 'string'
    || stableJsonStringify(JSON.parse(row.package_json)) !== stableJsonStringify(result)) {
    throw new Error(`Wild generation operation ${row.operation_id} stored columns contradict its command, preview, or package`)
  }
  return {
    command,
    commandSha256: row.command_sha256,
    previewCommand,
    previewCommandSha256: row.preview_command_sha256,
    previewHash: row.preview_hash,
    seed: row.seed,
    journal,
    result: { ...result, exactRetry: true },
    createdAt: row.created_at,
  }
}

export const createSqliteGmWildGenerationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): GmWildGenerationRepository => {
  const get = (operationId: string): GmWildGenerationAcceptedRecord | null => {
    if (!OPERATION_ID.test(operationId)) throw new Error('Wild generation operationId is invalid')
    const row = database.connection.prepare(`
      SELECT op.operation_id, op.command_sha256, op.command_json,
        op.preview_command_sha256, op.preview_hash, op.table_id,
        op.table_revision, op.seed, op.journal_json, op.result_json,
        op.created_at, pkg.package_id, pkg.package_json
      FROM gm_wild_generation_ops op
      INNER JOIN gm_generated_packages pkg ON pkg.operation_id = op.operation_id
      WHERE op.operation_id = ?
    `).get(operationId) as unknown as Row | undefined
    return row ? parseRow(row) : null
  }
  const getByPackageId = (packageId: string): GmWildGenerationAcceptedRecord | null => {
    if (!/^wild-package:v1:[a-f0-9]{32}$/.test(packageId)) throw new Error('Wild generation packageId is invalid')
    const row = database.connection.prepare(`
      SELECT op.operation_id, op.command_sha256, op.command_json,
        op.preview_command_sha256, op.preview_hash, op.table_id,
        op.table_revision, op.seed, op.journal_json, op.result_json,
        op.created_at, pkg.package_id, pkg.package_json
      FROM gm_generated_packages pkg
      INNER JOIN gm_wild_generation_ops op ON op.operation_id = pkg.operation_id
      WHERE pkg.package_id = ?
    `).get(packageId) as unknown as Row | undefined
    return row ? parseRow(row) : null
  }
  const create = (record: GmWildGenerationAcceptedRecord): GmWildGenerationAcceptedRecord => {
    const command = parseWildGenerationCommitCommandV1(record.command)
    const previewCommand = parseWildGenerationPreviewCommandV1(record.previewCommand)
    const commandSha256 = gmWildGenerationCommandSha256(command)
    const previewCommandSha256 = gmWildGenerationPreviewCommandSha256(previewCommand)
    if (commandSha256 !== record.commandSha256 || previewCommandSha256 !== record.previewCommandSha256
      || record.result.operationId !== command.operationId || record.result.exactRetry !== false
      || !SHA256.test(record.previewHash) || !SHA256.test(record.seed)) throw new Error('Wild generation record is internally inconsistent')
    const storedResult = stableJsonStringify({ previewCommand, projection: record.result })
    database.connection.prepare(`
      INSERT INTO gm_wild_generation_ops (
        operation_id, command_sha256, command_json, preview_command_sha256, preview_hash,
        table_id, table_revision, seed, journal_json, result_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(command.operationId, commandSha256, stableJsonStringify(command), previewCommandSha256,
      record.previewHash, previewCommand.tableId, previewCommand.expectedTableRevision, record.seed,
      stableJsonStringify(record.journal), storedResult, record.createdAt)
    database.connection.prepare(`
      INSERT INTO gm_generated_packages (package_id, operation_id, package_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(record.result.packageId, command.operationId, stableJsonStringify(record.result), record.createdAt)
    return record
  }
  return { database, get, getByPackageId, create }
}
