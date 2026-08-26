import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseSessionPreparationDocumentV1, type SessionPreparationDocumentV1 } from '#shared/gmToolkit/sessionPreparation'
import { getRotomDatabase, type RotomDatabase } from './database'

export type GmSessionPreparationOperationKind = 'create' | 'save' | 'transition' | 'copy' | 'import-scenes' | 'archive' | 'cancel' | 'record-launch'
export interface GmSessionPreparationOperationRecord {
  readonly operationId: string
  readonly commandSha256: string
  readonly commandKind: GmSessionPreparationOperationKind
  readonly preparationId: string
  readonly expectedRevision: number | null
  readonly command: unknown
  readonly result: SessionPreparationDocumentV1
  readonly createdAt: string
}
export interface GmSessionPreparationRepository {
  readonly database: RotomDatabase
  list(): readonly SessionPreparationDocumentV1[]
  get(preparationId: string): SessionPreparationDocumentV1 | null
  create(document: SessionPreparationDocumentV1): SessionPreparationDocumentV1
  replace(document: SessionPreparationDocumentV1, expectedRevision: number): SessionPreparationDocumentV1 | null
  getOperation(operationId: string): GmSessionPreparationOperationRecord | null
  createOperation(record: GmSessionPreparationOperationRecord): GmSessionPreparationOperationRecord
}
interface DocumentRow { readonly preparation_id: unknown; readonly document_json: unknown; readonly revision: unknown; readonly lifecycle: unknown; readonly title_normalized: unknown; readonly updated_at: unknown }
interface OperationRow { readonly operation_id: unknown; readonly command_sha256: unknown; readonly command_kind: unknown; readonly preparation_id: unknown; readonly expected_revision: unknown; readonly command_json: unknown; readonly result_json: unknown; readonly result_revision: unknown; readonly created_at: unknown }
const PREPARATION = /^session-preparation:v1:[a-z0-9]+(?:-[a-z0-9]+)*$/
const OPERATION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SHA = /^[a-f0-9]{64}$/
const KINDS: readonly GmSessionPreparationOperationKind[] = ['create', 'save', 'transition', 'copy', 'import-scenes', 'archive', 'cancel', 'record-launch']
const parseRow = (row: DocumentRow): SessionPreparationDocumentV1 => {
  if (typeof row.document_json !== 'string') throw new Error('Stored session preparation JSON is malformed')
  const document = parseSessionPreparationDocumentV1(JSON.parse(row.document_json))
  if (row.preparation_id !== document.preparationId || row.revision !== document.revision || row.lifecycle !== document.lifecycle
    || row.title_normalized !== document.title.toLocaleLowerCase('en-US') || row.updated_at !== document.updatedAt) throw new Error(`Session preparation ${document.preparationId} stored columns contradict its document`)
  return document
}
const parseOperation = (row: OperationRow): GmSessionPreparationOperationRecord => {
  if (typeof row.operation_id !== 'string' || !OPERATION.test(row.operation_id) || typeof row.command_sha256 !== 'string' || !SHA.test(row.command_sha256)
    || !KINDS.includes(row.command_kind as GmSessionPreparationOperationKind) || typeof row.preparation_id !== 'string' || !PREPARATION.test(row.preparation_id)
    || typeof row.command_json !== 'string' || typeof row.result_json !== 'string' || typeof row.created_at !== 'string') throw new Error('Stored session preparation operation is malformed')
  const result = parseSessionPreparationDocumentV1(JSON.parse(row.result_json))
  if (result.preparationId !== row.preparation_id || result.revision !== row.result_revision) throw new Error(`Session preparation operation ${row.operation_id} contradicts its result`)
  const expectedRevision = row.expected_revision === null ? null : Number(row.expected_revision)
  if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new Error(`Session preparation operation ${row.operation_id} has an invalid expected revision`)
  return Object.freeze({ operationId: row.operation_id, commandSha256: row.command_sha256, commandKind: row.command_kind as GmSessionPreparationOperationKind, preparationId: row.preparation_id, expectedRevision, command: JSON.parse(row.command_json), result, createdAt: row.created_at })
}

export const createSqliteGmSessionPreparationRepository = (database: RotomDatabase = getRotomDatabase()): GmSessionPreparationRepository => {
  const get = (preparationId: string): SessionPreparationDocumentV1 | null => {
    if (!PREPARATION.test(preparationId)) throw new Error('Session preparation ID is invalid')
    const row = database.connection.prepare('SELECT preparation_id, document_json, revision, lifecycle, title_normalized, updated_at FROM gm_session_preparations WHERE preparation_id = ?').get(preparationId) as unknown as DocumentRow | undefined
    return row ? parseRow(row) : null
  }
  const list = (): readonly SessionPreparationDocumentV1[] => (database.connection.prepare("SELECT preparation_id, document_json, revision, lifecycle, title_normalized, updated_at FROM gm_session_preparations ORDER BY CASE lifecycle WHEN 'ready' THEN 0 WHEN 'review' THEN 1 WHEN 'draft' THEN 2 WHEN 'launched' THEN 3 WHEN 'archived' THEN 4 ELSE 5 END, updated_at DESC, preparation_id").all() as unknown as DocumentRow[]).map(parseRow)
  const create = (input: SessionPreparationDocumentV1): SessionPreparationDocumentV1 => {
    const document = parseSessionPreparationDocumentV1(input)
    if (document.revision !== 0) throw new Error('A new session preparation must begin at revision 0')
    database.connection.prepare('INSERT INTO gm_session_preparations (preparation_id, document_json, revision, lifecycle, title_normalized, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(document.preparationId, stableJsonStringify(document), document.revision, document.lifecycle, document.title.toLocaleLowerCase('en-US'), document.updatedAt)
    return document
  }
  const replace = (input: SessionPreparationDocumentV1, expectedRevision: number): SessionPreparationDocumentV1 | null => {
    const document = parseSessionPreparationDocumentV1(input)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || document.revision !== expectedRevision + 1) throw new Error('Session preparation replacement must advance the expected revision exactly once')
    const result = database.connection.prepare('UPDATE gm_session_preparations SET document_json = ?, revision = ?, lifecycle = ?, title_normalized = ?, updated_at = ? WHERE preparation_id = ? AND revision = ?').run(stableJsonStringify(document), document.revision, document.lifecycle, document.title.toLocaleLowerCase('en-US'), document.updatedAt, document.preparationId, expectedRevision)
    return result.changes === 1 ? document : null
  }
  const getOperation = (operationId: string): GmSessionPreparationOperationRecord | null => {
    if (!OPERATION.test(operationId)) throw new Error('Session preparation operation ID is invalid')
    const row = database.connection.prepare('SELECT operation_id, command_sha256, command_kind, preparation_id, expected_revision, command_json, result_json, result_revision, created_at FROM gm_session_preparation_ops WHERE operation_id = ?').get(operationId) as unknown as OperationRow | undefined
    return row ? parseOperation(row) : null
  }
  const createOperation = (record: GmSessionPreparationOperationRecord): GmSessionPreparationOperationRecord => {
    if (!OPERATION.test(record.operationId) || !SHA.test(record.commandSha256) || !KINDS.includes(record.commandKind) || record.result.preparationId !== record.preparationId) throw new Error('Session preparation operation is inconsistent')
    database.connection.prepare('INSERT INTO gm_session_preparation_ops (operation_id, command_sha256, command_kind, preparation_id, expected_revision, command_json, result_json, result_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(record.operationId, record.commandSha256, record.commandKind, record.preparationId, record.expectedRevision, stableJsonStringify(record.command), stableJsonStringify(record.result), record.result.revision, record.createdAt)
    return record
  }
  return Object.freeze({ database, list, get, create, replace, getOperation, createOperation })
}
