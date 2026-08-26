import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseEncounterTableDocumentV1,
  type EncounterTableDocumentV1,
} from '#shared/gmToolkit/encounterTables'
import { getRotomDatabase, type RotomDatabase } from './database'

export type GmEncounterTableCommandKind = 'create' | 'update' | 'archive' | 'restore' | 'copy' | 'import'

export interface GmEncounterTableOperationCommand {
  readonly operationId: string
  readonly commandKind: GmEncounterTableCommandKind
  readonly tableId: string
  readonly expectedRevision: number | null
  readonly material: unknown
}

export interface GmEncounterTableOperationResult {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly commandSha256: string
  readonly commandKind: GmEncounterTableCommandKind
  readonly table: EncounterTableDocumentV1
  readonly exactRetry: boolean
}

export interface GmEncounterTableRepository {
  readonly database: RotomDatabase
  get(tableId: string): EncounterTableDocumentV1 | null
  list(options?: { readonly includeArchived?: boolean }): readonly EncounterTableDocumentV1[]
  getOperation(operationId: string): GmEncounterTableOperationResult | null
  create(document: EncounterTableDocumentV1): EncounterTableDocumentV1
  replace(expectedRevision: number, document: EncounterTableDocumentV1): EncounterTableDocumentV1
  recordOperation(command: GmEncounterTableOperationCommand, result: GmEncounterTableOperationResult, createdAt: string): void
}

interface TableRow {
  readonly table_id: unknown
  readonly document_json: unknown
  readonly revision: unknown
  readonly status: unknown
  readonly name_normalized: unknown
  readonly updated_at: unknown
  readonly source_sha256: unknown
}

interface OperationRow {
  readonly operation_id: unknown
  readonly command_sha256: unknown
  readonly command_kind: unknown
  readonly table_id: unknown
  readonly expected_revision: unknown
  readonly command_json: unknown
  readonly result_json: unknown
  readonly result_revision: unknown
  readonly created_at: unknown
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/
const SHA256 = /^[a-f0-9]{64}$/

const stableId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${label} must be a stable bounded ID`)
  return value
}

const safeRevision = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative safe integer`)
  return Number(value)
}

export const gmEncounterTableCommandSha256 = (command: GmEncounterTableOperationCommand): string => (
  createHash('sha256').update(stableJsonStringify(command)).digest('hex')
)

const rowToTable = (row: TableRow): EncounterTableDocumentV1 => {
  const tableId = stableId(row.table_id, 'gm_encounter_tables.table_id')
  const revision = safeRevision(row.revision, `table ${tableId} revision`)
  if (typeof row.document_json !== 'string') throw new Error(`table ${tableId} document_json must be text`)
  const document = parseEncounterTableDocumentV1(JSON.parse(row.document_json))
  if (document.tableId !== tableId || document.revision !== revision || document.status !== row.status
    || document.name.toLocaleLowerCase('en-US') !== row.name_normalized || document.updatedAt !== row.updated_at
    || document.provenance.sourceSha256 !== row.source_sha256) {
    throw new Error(`table ${tableId} stored columns contradict its document`)
  }
  return document
}

const parseOperation = (row: OperationRow): GmEncounterTableOperationResult => {
  const operationId = stableId(row.operation_id, 'gm_encounter_table_ops.operation_id')
  if (typeof row.command_json !== 'string' || typeof row.result_json !== 'string') {
    throw new Error(`table operation ${operationId} JSON columns must be text`)
  }
  const command = JSON.parse(row.command_json) as GmEncounterTableOperationCommand
  const parsedResult = JSON.parse(row.result_json) as GmEncounterTableOperationResult
  const commandSha256 = gmEncounterTableCommandSha256(command)
  if (row.command_sha256 !== commandSha256 || parsedResult.commandSha256 !== commandSha256
    || parsedResult.operationId !== operationId || parsedResult.commandKind !== row.command_kind
    || command.operationId !== operationId || command.commandKind !== row.command_kind
    || command.tableId !== row.table_id || command.expectedRevision !== row.expected_revision
    || parsedResult.table.tableId !== row.table_id || parsedResult.table.revision !== row.result_revision) {
    throw new Error(`table operation ${operationId} stored columns contradict its command or result`)
  }
  return {
    ...parsedResult,
    table: parseEncounterTableDocumentV1(parsedResult.table),
    exactRetry: true,
  }
}

export const createSqliteGmEncounterTableRepository = (
  database: RotomDatabase = getRotomDatabase(),
): GmEncounterTableRepository => {
  const selectColumns = 'table_id, document_json, revision, status, name_normalized, updated_at, source_sha256'
  const get = (tableIdInput: string): EncounterTableDocumentV1 | null => {
    const tableId = stableId(tableIdInput, 'tableId')
    const row = database.connection.prepare(`SELECT ${selectColumns} FROM gm_encounter_tables WHERE table_id = ?`)
      .get(tableId) as unknown as TableRow | undefined
    return row ? rowToTable(row) : null
  }
  const list = (options: { readonly includeArchived?: boolean } = {}): readonly EncounterTableDocumentV1[] => {
    const rows = database.connection.prepare(`
      SELECT ${selectColumns}
      FROM gm_encounter_tables
      ${options.includeArchived ? '' : "WHERE status = 'active'"}
      ORDER BY name_normalized ASC, table_id ASC
    `).all() as unknown as TableRow[]
    return rows.map(rowToTable)
  }
  const getOperation = (operationIdInput: string): GmEncounterTableOperationResult | null => {
    const operationId = stableId(operationIdInput, 'operationId')
    const row = database.connection.prepare(`
      SELECT operation_id, command_sha256, command_kind, table_id, expected_revision,
        command_json, result_json, result_revision, created_at
      FROM gm_encounter_table_ops WHERE operation_id = ?
    `).get(operationId) as unknown as OperationRow | undefined
    return row ? parseOperation(row) : null
  }
  const create = (input: EncounterTableDocumentV1): EncounterTableDocumentV1 => {
    const document = parseEncounterTableDocumentV1(input)
    if (document.revision !== 0) throw new Error('New encounter table revision must be 0')
    database.connection.prepare(`
      INSERT INTO gm_encounter_tables (
        table_id, document_json, revision, status, name_normalized, updated_at, source_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(document.tableId, stableJsonStringify(document), document.revision, document.status,
      document.name.toLocaleLowerCase('en-US'), document.updatedAt, document.provenance.sourceSha256)
    return document
  }
  const replace = (expectedRevisionInput: number, input: EncounterTableDocumentV1): EncounterTableDocumentV1 => {
    const expectedRevision = safeRevision(expectedRevisionInput, 'expectedRevision')
    const document = parseEncounterTableDocumentV1(input)
    if (document.revision !== expectedRevision + 1) throw new Error('Encounter table replacement must advance exactly one revision')
    const result = database.connection.prepare(`
      UPDATE gm_encounter_tables
      SET document_json = ?, revision = ?, status = ?, name_normalized = ?, updated_at = ?, source_sha256 = ?
      WHERE table_id = ? AND revision = ?
    `).run(stableJsonStringify(document), document.revision, document.status,
      document.name.toLocaleLowerCase('en-US'), document.updatedAt, document.provenance.sourceSha256,
      document.tableId, expectedRevision)
    if (Number(result.changes) !== 1) throw new Error(`Encounter table ${document.tableId} changed before it could be updated`)
    return document
  }
  const recordOperation = (
    command: GmEncounterTableOperationCommand,
    result: GmEncounterTableOperationResult,
    createdAt: string,
  ): void => {
    const commandSha256 = gmEncounterTableCommandSha256(command)
    if (result.operationId !== command.operationId || result.commandKind !== command.commandKind
      || result.commandSha256 !== commandSha256 || result.table.tableId !== command.tableId) {
      throw new Error('Encounter table operation result does not match its command')
    }
    database.connection.prepare(`
      INSERT INTO gm_encounter_table_ops (
        operation_id, command_sha256, command_kind, table_id, expected_revision,
        command_json, result_json, result_revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(command.operationId, commandSha256, command.commandKind, command.tableId, command.expectedRevision,
      stableJsonStringify(command), stableJsonStringify({ ...result, exactRetry: false }), result.table.revision, createdAt)
  }
  return { database, get, list, getOperation, create, replace, recordOperation }
}
