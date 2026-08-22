import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseContestDocument, type ContestDocumentV1 } from '#shared/contests/document'
import { CONTEST_COMMAND_KINDS, parseContestCommand, type ContestCommandV1, type ContestOperationResultV1 } from '#shared/contests/operations'
import { CONTEST_STAGES, parseContestId, parseContestOperationId } from '#shared/contests/ids'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface StoredContestV1 {
  readonly document: ContestDocumentV1
  readonly revision: number
  readonly stage: ContestDocumentV1['stage']
  readonly createdAt: number
  readonly updatedAt: number
}
export interface StoredContestOperationV1 {
  readonly operationId: string
  readonly contestId: string
  readonly commandHash: string
  readonly command: ContestCommandV1
  readonly result: ContestOperationResultV1
  readonly resultRevision: number
  readonly createdAt: number
}
export class ContestRepositoryError extends Error {
  readonly code: 'not-found' | 'revision-conflict' | 'operation-conflict' | 'corrupt-document'
  readonly currentRevision: number | null
  constructor(code: ContestRepositoryError['code'], message: string, currentRevision: number | null = null) {
    super(message); this.name = 'ContestRepositoryError'; this.code = code; this.currentRevision = currentRevision
  }
}
export const contestCommandHash = (command: ContestCommandV1): string => createHash('sha256').update(stableJsonStringify(command)).digest('hex')
const boundedJson = (value: unknown, maximum: number, label: string): string => {
  const json = stableJsonStringify(value)
  if (Buffer.byteLength(json, 'utf8') > maximum) throw new Error(`${label} exceeds ${maximum} bytes.`)
  return json
}
const operationResult = (value: unknown): ContestOperationResultV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Contest operation result is corrupt.')
  const row = value as Record<string, unknown>
  const allowed = new Set(['schemaVersion','ok','exactRetry','operationId','contestId','commandKind','revision','stage','updatedAt'])
  if (Object.keys(row).some(key => !allowed.has(key)) || Object.keys(row).length !== allowed.size
    || row.schemaVersion !== 1 || row.ok !== true || typeof row.exactRetry !== 'boolean' || typeof row.operationId !== 'string' || typeof row.contestId !== 'string'
    || !CONTEST_COMMAND_KINDS.includes(row.commandKind as never) || !CONTEST_STAGES.includes(row.stage as never)
    || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || !Number.isSafeInteger(row.updatedAt) || Number(row.updatedAt) < 0) throw new Error('Contest operation result is corrupt.')
  parseContestOperationId(row.operationId); parseContestId(row.contestId)
  return structuredClone(row) as unknown as ContestOperationResultV1
}

export interface ContestRepository {
  readonly database: RotomDatabase
  get(contestId: string): StoredContestV1 | null
  list(options?: { readonly includeTerminal?: boolean, readonly limit?: number }): readonly StoredContestV1[]
  insert(document: ContestDocumentV1): StoredContestV1
  replace(expectedRevision: number, document: ContestDocumentV1): StoredContestV1
  findOperation(operationId: string): StoredContestOperationV1 | null
  recordOperation(command: ContestCommandV1, result: ContestOperationResultV1, now: number): StoredContestOperationV1
}

export const createSqliteContestRepository = (database: RotomDatabase = getRotomDatabase()): ContestRepository => {
  const rowToContest = (row: Record<string, unknown>): StoredContestV1 => {
    if (typeof row.document_json !== 'string') throw new ContestRepositoryError('corrupt-document', 'Contest document JSON is corrupt.')
    const document = parseContestDocument(JSON.parse(row.document_json))
    const revision = Number(row.revision)
    if (document.contestId !== row.contest_id || document.revision !== revision || document.stage !== row.stage
      || document.createdAt !== Number(row.created_at) || document.updatedAt !== Number(row.updated_at)) {
      throw new ContestRepositoryError('corrupt-document', `Contest ${document.contestId} row/document authority drift.`)
    }
    return Object.freeze({ document, revision, stage: document.stage, createdAt: document.createdAt, updatedAt: document.updatedAt })
  }
  const get = (contestIdInput: string): StoredContestV1 | null => {
    const contestId = parseContestId(contestIdInput)
    const row = database.connection.prepare('SELECT * FROM contests WHERE contest_id = ?').get(contestId) as Record<string, unknown> | undefined
    return row ? rowToContest(row) : null
  }
  const findOperation = (operationIdInput: string): StoredContestOperationV1 | null => {
    const operationId = parseContestOperationId(operationIdInput)
    const row = database.connection.prepare('SELECT * FROM contest_operations WHERE operation_id = ?').get(operationId) as Record<string, unknown> | undefined
    if (!row) return null
    if (typeof row.command_json !== 'string' || typeof row.result_json !== 'string' || typeof row.command_hash !== 'string') throw new Error('Contest operation row is corrupt.')
    const command = parseContestCommand(JSON.parse(row.command_json))
    const result = operationResult(JSON.parse(row.result_json))
    const hash = contestCommandHash(command)
    if (command.operationId !== operationId || command.contestId !== row.contest_id || hash !== row.command_hash
      || result.operationId !== operationId || result.contestId !== command.contestId || result.revision !== Number(row.result_revision)) throw new Error('Contest operation row has identity drift.')
    return Object.freeze({ operationId, contestId: command.contestId, commandHash: hash, command, result, resultRevision: result.revision, createdAt: Number(row.created_at) })
  }
  return Object.freeze({
    database,
    get,
    list: (options: { readonly includeTerminal?: boolean, readonly limit?: number } = {}) => {
      const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)))
      const rows = database.connection.prepare(options.includeTerminal === false
        ? `SELECT * FROM contests WHERE stage NOT IN ('completed','cancelled') ORDER BY updated_at DESC, contest_id LIMIT ?`
        : 'SELECT * FROM contests ORDER BY updated_at DESC, contest_id LIMIT ?').all(limit) as Record<string, unknown>[]
      return Object.freeze(rows.map(rowToContest))
    },
    insert: (documentInput: ContestDocumentV1) => {
      const document = parseContestDocument(documentInput)
      if (document.revision !== 0) throw new Error('A new Contest document must start at revision 0.')
      database.connection.prepare(`INSERT INTO contests (contest_id, document_json, revision, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(document.contestId, boundedJson(document, 8_388_608, 'Contest document'), document.revision, document.stage, document.createdAt, document.updatedAt)
      return get(document.contestId)!
    },
    replace: (expectedRevisionInput: number, documentInput: ContestDocumentV1) => {
      const expectedRevision = Number(expectedRevisionInput)
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Expected Contest revision is invalid.')
      const document = parseContestDocument(documentInput)
      if (document.revision !== expectedRevision + 1) throw new Error('Replacement Contest revision must advance exactly once.')
      const update = database.connection.prepare(`UPDATE contests SET document_json = ?, revision = ?, stage = ?, updated_at = ? WHERE contest_id = ? AND revision = ?`)
        .run(boundedJson(document, 8_388_608, 'Contest document'), document.revision, document.stage, document.updatedAt, document.contestId, expectedRevision)
      if (Number(update.changes) !== 1) {
        const current = get(document.contestId)
        throw new ContestRepositoryError(current ? 'revision-conflict' : 'not-found', current ? `Contest is stale; current revision is ${current.revision}.` : 'Contest was not found.', current?.revision ?? null)
      }
      return get(document.contestId)!
    },
    findOperation,
    recordOperation: (commandInput: ContestCommandV1, resultInput: ContestOperationResultV1, now: number) => {
      const command = parseContestCommand(commandInput)
      const result = operationResult(resultInput)
      if (command.operationId !== result.operationId || command.contestId !== result.contestId || command.commandKind !== result.commandKind) throw new Error('Contest operation command/result binding is invalid.')
      const hash = contestCommandHash(command)
      const existing = findOperation(command.operationId)
      if (existing) {
        if (existing.commandHash !== hash) throw new ContestRepositoryError('operation-conflict', 'Contest operation ID was reused with different command material.')
        return existing
      }
      database.connection.prepare(`INSERT INTO contest_operations (operation_id, contest_id, command_hash, command_kind, command_json, result_json, result_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(command.operationId, command.contestId, hash, command.commandKind, boundedJson(command, 1_048_576, 'Contest command'), boundedJson(result, 8_388_608, 'Contest result'), result.revision, now)
      return findOperation(command.operationId)!
    },
  })
}
