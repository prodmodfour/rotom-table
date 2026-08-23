import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  SKILL_CHECK_OPERATION_KINDS,
  SKILL_CHECK_STATES,
  parseSkillCheckId,
  parseSkillCheckOperationId,
  type SkillCheckCommandV1,
  type SkillCheckOperationKind,
  type SkillCheckState,
} from '#shared/skillChecks/contract'
import { parseSkillCheckCommand, parseSkillCheckDocument } from '#shared/skillChecks/persistence'
import type { SkillCheckDocumentV1 } from '#shared/skillChecks/contract'
import { getRotomDatabase, type RotomDatabase } from './database'

export interface SkillCheckOperationResultV1 {
  readonly schemaVersion: 1
  readonly operationId: SkillCheckCommandV1['operationId']
  readonly checkId: SkillCheckDocumentV1['checkId']
  readonly commandKind: SkillCheckOperationKind
  readonly revision: number
  readonly state: SkillCheckState
  readonly updatedAt: number
}

export interface StoredSkillCheckV1 {
  readonly document: SkillCheckDocumentV1
  readonly revision: number
  readonly state: SkillCheckState
  readonly mode: SkillCheckDocumentV1['mode']
  readonly requesterPrincipalId: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly expiresAt: number | null
  readonly terminalAt: number | null
}

export interface StoredSkillCheckOperationV1 {
  readonly operationId: SkillCheckCommandV1['operationId']
  readonly checkId: SkillCheckDocumentV1['checkId']
  readonly commandSha256: string
  readonly principalKey: string
  readonly command: SkillCheckCommandV1
  readonly result: SkillCheckOperationResultV1
  readonly resultRevision: number
  readonly createdAt: number
}

export class SkillCheckRepositoryError extends Error {
  readonly code: 'not-found' | 'revision-conflict' | 'operation-conflict' | 'corrupt-document'
  readonly currentRevision: number | null

  constructor(code: SkillCheckRepositoryError['code'], message: string, currentRevision: number | null = null) {
    super(message)
    this.name = 'SkillCheckRepositoryError'
    this.code = code
    this.currentRevision = currentRevision
  }
}

export interface SkillCheckRepository {
  readonly database: RotomDatabase
  get(checkId: string): StoredSkillCheckV1 | null
  list(options?: {
    readonly states?: readonly SkillCheckState[]
    readonly requesterPrincipalId?: string
    readonly limit?: number
  }): readonly StoredSkillCheckV1[]
  insert(document: SkillCheckDocumentV1): StoredSkillCheckV1
  replace(expectedRevision: number, document: SkillCheckDocumentV1): StoredSkillCheckV1
  findOperation(operationId: string): StoredSkillCheckOperationV1 | null
  recordOperation(input: {
    readonly principalKey: string
    readonly command: SkillCheckCommandV1
    readonly result: SkillCheckOperationResultV1
    readonly createdAt: number
  }): StoredSkillCheckOperationV1
}

export const skillCheckCommandSha256 = (command: SkillCheckCommandV1): string => createHash('sha256')
  .update(stableJsonStringify(command))
  .digest('hex')

const boundedJson = (value: unknown, maximum: number, label: string): string => {
  const json = stableJsonStringify(value)
  if (Buffer.byteLength(json, 'utf8') > maximum) throw new Error(`${label} exceeds ${maximum} bytes.`)
  return json
}

const safeInteger = (value: unknown, label: string, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error(`${label} is invalid.`)
  return Number(value)
}

const parseOperationResult = (value: unknown): SkillCheckOperationResultV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Skill Check operation result is corrupt.')
  const row = structuredClone(value) as Record<string, unknown>
  const fields = ['schemaVersion', 'operationId', 'checkId', 'commandKind', 'revision', 'state', 'updatedAt']
  if (Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))
    || row.schemaVersion !== 1 || !SKILL_CHECK_OPERATION_KINDS.includes(row.commandKind as never)
    || !SKILL_CHECK_STATES.includes(row.state as never)) throw new Error('Skill Check operation result is corrupt.')
  parseSkillCheckOperationId(row.operationId)
  parseSkillCheckId(row.checkId)
  safeInteger(row.revision, 'Skill Check result revision', 1)
  safeInteger(row.updatedAt, 'Skill Check result updatedAt')
  return Object.freeze(row) as unknown as SkillCheckOperationResultV1
}

export const createSqliteSkillCheckRepository = (
  database: RotomDatabase = getRotomDatabase(),
): SkillCheckRepository => {
  const rowToStored = (row: Record<string, unknown>): StoredSkillCheckV1 => {
    if (typeof row.document_json !== 'string') {
      throw new SkillCheckRepositoryError('corrupt-document', 'Skill Check document JSON is corrupt.')
    }
    let document: SkillCheckDocumentV1
    try { document = parseSkillCheckDocument(JSON.parse(row.document_json)) }
    catch (error) {
      throw new SkillCheckRepositoryError(
        'corrupt-document',
        `Skill Check document is corrupt: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const revision = Number(row.revision)
    if (document.checkId !== row.check_id || document.revision !== revision || document.state !== row.state
      || document.mode !== row.mode || document.requester.principalId !== row.requester_principal_id
      || document.createdAt !== Number(row.created_at) || document.updatedAt !== Number(row.updated_at)
      || document.expiresAt !== (row.expires_at === null ? null : Number(row.expires_at))
      || document.terminalAt !== (row.terminal_at === null ? null : Number(row.terminal_at))) {
      throw new SkillCheckRepositoryError('corrupt-document', `Skill Check ${document.checkId} row/document authority drift.`)
    }
    return Object.freeze({
      document,
      revision,
      state: document.state,
      mode: document.mode,
      requesterPrincipalId: document.requester.principalId,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      expiresAt: document.expiresAt,
      terminalAt: document.terminalAt,
    })
  }

  const get = (checkIdInput: string): StoredSkillCheckV1 | null => {
    const checkId = parseSkillCheckId(checkIdInput)
    const row = database.connection.prepare('SELECT * FROM skill_checks WHERE check_id = ?')
      .get(checkId) as Record<string, unknown> | undefined
    return row ? rowToStored(row) : null
  }

  const findOperation = (operationIdInput: string): StoredSkillCheckOperationV1 | null => {
    const operationId = parseSkillCheckOperationId(operationIdInput)
    const row = database.connection.prepare('SELECT * FROM skill_check_operations WHERE operation_id = ?')
      .get(operationId) as Record<string, unknown> | undefined
    if (!row) return null
    if (typeof row.command_json !== 'string' || typeof row.result_json !== 'string'
      || typeof row.command_sha256 !== 'string' || typeof row.principal_key !== 'string') {
      throw new SkillCheckRepositoryError('corrupt-document', 'Skill Check operation row is corrupt.')
    }
    const command = parseSkillCheckCommand(JSON.parse(row.command_json))
    const result = parseOperationResult(JSON.parse(row.result_json))
    const commandSha256 = skillCheckCommandSha256(command)
    if (command.operationId !== operationId || command.checkId !== row.check_id
      || command.commandKind !== row.command_kind || commandSha256 !== row.command_sha256
      || result.operationId !== operationId || result.checkId !== command.checkId
      || result.commandKind !== command.commandKind || result.revision !== Number(row.result_revision)) {
      throw new SkillCheckRepositoryError('corrupt-document', 'Skill Check operation row identity drifted.')
    }
    return Object.freeze({
      operationId,
      checkId: command.checkId,
      commandSha256,
      principalKey: row.principal_key,
      command,
      result,
      resultRevision: result.revision,
      createdAt: Number(row.created_at),
    })
  }

  return Object.freeze({
    database,
    get,
    list: (options: {
      readonly states?: readonly SkillCheckState[]
      readonly requesterPrincipalId?: string
      readonly limit?: number
    } = {}) => {
      const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)))
      const states = options.states ?? []
      if (states.some(state => !SKILL_CHECK_STATES.includes(state))) throw new Error('Skill Check list states are invalid.')
      const requester = options.requesterPrincipalId === undefined
        ? null
        : (() => {
            const value = options.requesterPrincipalId.trim()
            if (!value || value.length > 200) throw new Error('Skill Check requester principal is invalid.')
            return value
          })()
      const clauses: string[] = []
      const parameters: Array<string | number> = []
      if (states.length) {
        clauses.push(`state IN (${states.map(() => '?').join(', ')})`)
        parameters.push(...states)
      }
      if (requester !== null) {
        clauses.push('requester_principal_id = ?')
        parameters.push(requester)
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
      const rows = database.connection.prepare(
        `SELECT * FROM skill_checks${where} ORDER BY updated_at DESC, check_id LIMIT ?`,
      ).all(...parameters, limit) as Record<string, unknown>[]
      return Object.freeze(rows.map(rowToStored))
    },
    insert: (documentInput: SkillCheckDocumentV1) => {
      const document = parseSkillCheckDocument(documentInput)
      if (document.revision !== 1) throw new Error('A new Skill Check document must start at revision 1.')
      database.connection.prepare(`
        INSERT INTO skill_checks (
          check_id, document_json, revision, state, mode, requester_principal_id,
          created_at, updated_at, expires_at, terminal_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        document.checkId,
        boundedJson(document, 8_388_608, 'Skill Check document'),
        document.revision,
        document.state,
        document.mode,
        document.requester.principalId,
        document.createdAt,
        document.updatedAt,
        document.expiresAt,
        document.terminalAt,
      )
      return get(document.checkId)!
    },
    replace: (expectedRevisionInput: number, documentInput: SkillCheckDocumentV1) => {
      const expectedRevision = safeInteger(expectedRevisionInput, 'Expected Skill Check revision', 1)
      const document = parseSkillCheckDocument(documentInput)
      if (document.revision !== expectedRevision + 1) {
        throw new Error('Replacement Skill Check revision must advance exactly once.')
      }
      const current = get(document.checkId)
      if (current && (current.document.createdAt !== document.createdAt
        || current.document.requester.principalId !== document.requester.principalId)) {
        throw new Error('Replacement Skill Check immutable authority changed.')
      }
      const update = database.connection.prepare(`
        UPDATE skill_checks
        SET document_json = ?, revision = ?, state = ?, mode = ?, updated_at = ?, expires_at = ?, terminal_at = ?
        WHERE check_id = ? AND revision = ?
      `).run(
        boundedJson(document, 8_388_608, 'Skill Check document'),
        document.revision,
        document.state,
        document.mode,
        document.updatedAt,
        document.expiresAt,
        document.terminalAt,
        document.checkId,
        expectedRevision,
      )
      if (Number(update.changes) !== 1) {
        const latest = get(document.checkId)
        throw new SkillCheckRepositoryError(
          latest ? 'revision-conflict' : 'not-found',
          latest ? `Skill Check is stale; current revision is ${latest.revision}.` : 'Skill Check was not found.',
          latest?.revision ?? null,
        )
      }
      return get(document.checkId)!
    },
    findOperation,
    recordOperation: (input: Parameters<SkillCheckRepository['recordOperation']>[0]) => {
      const command = parseSkillCheckCommand(input.command)
      const result = parseOperationResult(input.result)
      const principalKey = input.principalKey.trim()
      const createdAt = safeInteger(input.createdAt, 'Skill Check operation createdAt')
      if (!principalKey || principalKey.length > 240) throw new Error('Skill Check operation principal is invalid.')
      if (command.operationId !== result.operationId || command.checkId !== result.checkId
        || command.commandKind !== result.commandKind) throw new Error('Skill Check operation command/result binding is invalid.')
      const storedCheck = get(command.checkId)
      if (!storedCheck || storedCheck.revision !== result.revision || storedCheck.state !== result.state) {
        throw new Error('Skill Check operation result does not match the current document.')
      }
      const commandSha256 = skillCheckCommandSha256(command)
      const existing = findOperation(command.operationId)
      if (existing) {
        if (existing.commandSha256 !== commandSha256 || existing.principalKey !== principalKey) {
          throw new SkillCheckRepositoryError('operation-conflict', 'Skill Check operation ID was reused with different authority.')
        }
        return existing
      }
      database.connection.prepare(`
        INSERT INTO skill_check_operations (
          operation_id, check_id, command_sha256, principal_key, command_kind,
          command_json, result_json, result_revision, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        command.operationId,
        command.checkId,
        commandSha256,
        principalKey,
        command.commandKind,
        boundedJson(command, 1_048_576, 'Skill Check command'),
        boundedJson(result, 65_536, 'Skill Check operation result'),
        result.revision,
        createdAt,
      )
      return findOperation(command.operationId)!
    },
  })
}
