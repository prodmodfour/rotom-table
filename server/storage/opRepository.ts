import {
  parseLivePlayMapSlug,
  parseLivePlayOpId,
  validateLivePlayCommandEnvelope,
  type LivePlayCommandAccepted,
  type LivePlayScope,
} from '#shared/livePlayCommands'
import {
  isStorableLivePlayCommandResult,
  livePlayIdempotencyViolationMessage,
  type LivePlayCommandHash,
  type StorableLivePlayCommandResult,
} from '../livePlay/opResult'
import {
  LIVE_PLAY_OP_STORE_SCHEMA_VERSION,
  type LivePlayOpRecord,
  type LivePlayOpStore,
  type SaveLivePlayOpResultInput,
} from '../livePlay/opStore'
import type {
  LivePlayAcceptedOperationHistoryInput,
  LivePlayAcceptedOperationMetadata,
} from '../livePlay/conflicts'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  cloneStoredJson,
  parseStoredDocumentJson,
  parseStoredRevision,
  parseStoredTimestamp,
  stringifyStoredDocument,
} from './documentJson'

export interface SqliteLivePlayOpRecord extends LivePlayOpRecord {
  readonly command: unknown
  readonly createdAt: number
  readonly resultRevision?: number
}

export interface SaveSqliteLivePlayOpResultInput extends SaveLivePlayOpResultInput {
  readonly command: unknown
}

export interface LivePlayOpRepository extends LivePlayOpStore {
  getStoredOpRecord(mapSlug: string, opId: string): SqliteLivePlayOpRecord | null
  listAcceptedOpsSinceRevision(input: LivePlayAcceptedOperationHistoryInput): readonly LivePlayAcceptedOperationMetadata[]
  saveCommandResult(input: SaveSqliteLivePlayOpResultInput): SqliteLivePlayOpRecord
}

export interface CreateSqliteLivePlayOpRepositoryOptions {
  readonly database?: RotomDatabase
  readonly clock?: () => number
}

interface OpRow {
  readonly op_id: unknown
  readonly map_slug: unknown
  readonly command_hash: unknown
  readonly command_json: unknown
  readonly result_json: unknown
  readonly result_revision: unknown
  readonly created_at: unknown
}

const validateCommandHash = (value: unknown): LivePlayCommandHash => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('live_play_ops.command_hash must be a non-empty string')
  }
  return value as LivePlayCommandHash
}

const parseResultRevision = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined
  return parseStoredRevision(value, 'live_play_ops.result_revision')
}

const parseRecordedResult = (json: string, opId: string): StorableLivePlayCommandResult => {
  const result = parseStoredDocumentJson<unknown>(json, `live-play op ${opId} result`)
  if (!isStorableLivePlayCommandResult(result)) {
    throw new Error(`live-play op ${opId} result_json must be an accepted or rejected command result`)
  }
  return cloneStoredJson(result)
}

const rowToOpRecord = (row: OpRow): SqliteLivePlayOpRecord => {
  if (typeof row.command_json !== 'string') throw new Error('live_play_ops.command_json must be a string')
  if (typeof row.result_json !== 'string') throw new Error('live_play_ops.result_json must be a string')

  const opId = parseLivePlayOpId(row.op_id, 'live_play_ops.op_id')
  const mapSlug = parseLivePlayMapSlug(row.map_slug, 'live_play_ops.map_slug')
  const commandHash = validateCommandHash(row.command_hash)
  const command = parseStoredDocumentJson<unknown>(row.command_json, `live-play op ${opId} command`)
  const result = parseRecordedResult(row.result_json, opId)
  const createdAt = parseStoredTimestamp(row.created_at, 'live_play_ops.created_at')
  const resultRevision = parseResultRevision(row.result_revision)

  if (result.opId !== opId) {
    throw new Error(`live-play op ${opId} result_json opId must match op_id`)
  }
  if (result.mapSlug !== mapSlug) {
    throw new Error(`live-play op ${opId} result_json mapSlug must match map_slug`)
  }

  return {
    schemaVersion: LIVE_PLAY_OP_STORE_SCHEMA_VERSION,
    mapSlug,
    opId,
    commandHash,
    command: cloneStoredJson(command),
    result,
    ...(resultRevision === undefined ? {} : { resultRevision }),
    createdAt,
    recordedAt: new Date(createdAt).toISOString(),
  }
}

const isAcceptedCommandResult = (
  result: StorableLivePlayCommandResult,
): result is LivePlayCommandAccepted => result.ok === true

const scopesFromAcceptedResult = (result: LivePlayCommandAccepted): readonly LivePlayScope[] => (
  result.patches.flatMap((patch) => patch.scopes).map(cloneStoredJson)
)

const acceptedOperationFromRecord = (
  record: SqliteLivePlayOpRecord,
): LivePlayAcceptedOperationMetadata | null => {
  if (!isAcceptedCommandResult(record.result)) return null

  const validation = validateLivePlayCommandEnvelope(record.command)
  const command = validation.valid ? validation.command : undefined
  const scopes = command?.scopes.map(cloneStoredJson) ?? scopesFromAcceptedResult(record.result)

  return {
    mapSlug: record.mapSlug,
    opId: record.opId,
    revision: record.result.revision,
    scopes,
    ...(command === undefined ? {} : { command: cloneStoredJson(command) }),
    result: cloneStoredJson(record.result),
  }
}

const resultRevision = (result: StorableLivePlayCommandResult): number | null => {
  const revision = result.ok ? result.revision : result.currentRevision
  return typeof revision === 'number' ? parseStoredRevision(revision, 'live-play op result revision') : null
}

const createdAtFromInput = (
  input: Pick<SaveLivePlayOpResultInput, 'recordedAt'>,
  clock: () => number,
): number => {
  if (input.recordedAt === undefined) return parseStoredTimestamp(clock(), 'live-play op createdAt')
  const parsed = Date.parse(input.recordedAt)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('live-play op recordedAt must be an ISO-compatible timestamp')
  }
  return parsed
}

const validateSaveInput = (input: SaveLivePlayOpResultInput): void => {
  const mapSlug = parseLivePlayMapSlug(input.mapSlug, 'live-play op mapSlug')
  const opId = parseLivePlayOpId(input.opId, 'live-play op opId')
  validateCommandHash(input.commandHash)

  if (!isStorableLivePlayCommandResult(input.result)) {
    throw new Error('live-play op result must be an accepted or rejected command result')
  }
  if (input.result.opId !== opId) {
    throw new Error('live-play op result opId must match the stored opId')
  }
  if (input.result.mapSlug !== mapSlug) {
    throw new Error('live-play op result mapSlug must match the stored mapSlug')
  }
}

export const createSqliteLivePlayOpRepository = (
  options: CreateSqliteLivePlayOpRepositoryOptions = {},
): LivePlayOpRepository => {
  const database = options.database ?? getRotomDatabase()
  const clock = options.clock ?? Date.now

  const findByOpId = (opId: string): SqliteLivePlayOpRecord | null => {
    const parsedOpId = parseLivePlayOpId(opId, 'live-play op opId')
    const row = database.connection.prepare(`
      SELECT op_id, map_slug, command_hash, command_json, result_json, result_revision, created_at
      FROM live_play_ops
      WHERE op_id = ?
    `).get(parsedOpId) as OpRow | undefined
    return row ? rowToOpRecord(row) : null
  }

  const getStoredOpRecord = (mapSlug: string, opId: string): SqliteLivePlayOpRecord | null => {
    const parsedMapSlug = parseLivePlayMapSlug(mapSlug, 'live-play op mapSlug')
    const record = findByOpId(opId)
    return record && record.mapSlug === parsedMapSlug ? record : null
  }

  const listAcceptedOpsSinceRevision = (
    input: LivePlayAcceptedOperationHistoryInput,
  ): readonly LivePlayAcceptedOperationMetadata[] => {
    const mapSlug = parseLivePlayMapSlug(input.mapSlug, 'live-play op history mapSlug')
    const baseRevision = parseStoredRevision(input.baseRevision, 'live-play op history baseRevision')
    const currentRevision = parseStoredRevision(input.currentRevision, 'live-play op history currentRevision')
    if (baseRevision >= currentRevision) return []

    const rows = database.connection.prepare(`
      SELECT op_id, map_slug, command_hash, command_json, result_json, result_revision, created_at
      FROM live_play_ops
      WHERE map_slug = ?
        AND result_revision > ?
        AND result_revision <= ?
      ORDER BY result_revision ASC, created_at ASC, op_id ASC
    `).all(mapSlug, baseRevision, currentRevision) as unknown as OpRow[]

    return rows
      .map(rowToOpRecord)
      .map(acceptedOperationFromRecord)
      .filter((record): record is LivePlayAcceptedOperationMetadata => record !== null)
  }

  const saveCommandResult = (input: SaveSqliteLivePlayOpResultInput): SqliteLivePlayOpRecord =>
    database.withTransaction(() => {
      validateSaveInput(input)
      const mapSlug = parseLivePlayMapSlug(input.mapSlug, 'live-play op mapSlug')
      const opId = parseLivePlayOpId(input.opId, 'live-play op opId')
      const existing = findByOpId(opId)
      if (existing) {
        if (existing.mapSlug !== mapSlug || existing.commandHash !== input.commandHash) {
          throw new Error(livePlayIdempotencyViolationMessage(existing.mapSlug, existing.opId))
        }
        return existing
      }

      const createdAt = createdAtFromInput(input, clock)
      database.connection.prepare(`
        INSERT INTO live_play_ops (
          op_id,
          map_slug,
          command_hash,
          command_json,
          result_json,
          result_revision,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        opId,
        mapSlug,
        input.commandHash,
        stringifyStoredDocument(input.command),
        stringifyStoredDocument(input.result),
        resultRevision(input.result),
        createdAt,
      )
      const record = findByOpId(opId)
      if (!record) throw new Error(`live-play op ${opId} was not readable after insert`)
      return record
    })

  return {
    getStoredOpRecord,
    getOpRecord: getStoredOpRecord,
    getOpResult: (mapSlug, opId) => getStoredOpRecord(mapSlug, opId)?.result ?? null,
    listAcceptedOpsSinceRevision,
    saveCommandResult,
    saveOpResult: (input) => saveCommandResult({
      ...input,
      command: null,
    }),
  }
}

const defaultOpRepository = (): LivePlayOpRepository =>
  createSqliteLivePlayOpRepository({ database: getRotomDatabase() })

export const sqliteLivePlayOpRepository: LivePlayOpRepository = {
  getStoredOpRecord: (mapSlug, opId) => defaultOpRepository().getStoredOpRecord(mapSlug, opId),
  getOpRecord: (mapSlug, opId) => defaultOpRepository().getOpRecord(mapSlug, opId),
  getOpResult: (mapSlug, opId) => defaultOpRepository().getOpResult(mapSlug, opId),
  listAcceptedOpsSinceRevision: (input) => defaultOpRepository().listAcceptedOpsSinceRevision(input),
  saveCommandResult: (input) => defaultOpRepository().saveCommandResult(input),
  saveOpResult: (input) => defaultOpRepository().saveOpResult(input),
}
