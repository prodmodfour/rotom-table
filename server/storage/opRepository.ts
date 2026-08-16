import {
  parseLivePlayMapSlug,
  validateLivePlayCommandEnvelope,
  type LivePlayCommandAccepted,
  type LivePlayScope,
} from '#shared/livePlayCommands'
import {
  assertLivePlayOperationResultCompatible,
  isStorableLivePlayCommandResult,
  livePlayIdempotencyViolationMessage,
  type LivePlayCommandHash,
  type StorableLivePlayCommandResult,
} from '../livePlay/opResult'
import { validateLivePlayOperationId } from '../livePlay/commandIdempotency'
import {
  parseAcceptedMoveCompensationResult,
  type AcceptedMoveCompensationResult,
} from '../domain/moveAutomation/acceptedMoveCompensation'
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
  /** Private bounded source read used by cross-domain settlement reconstruction. */
  listStoredOpsForMap(mapSlug: string, limit?: number): readonly SqliteLivePlayOpRecord[]
  countStoredOpsForMap(mapSlug: string, createdAtOrAfter?: number): number
  listAcceptedOpsSinceRevision(input: LivePlayAcceptedOperationHistoryInput): readonly LivePlayAcceptedOperationMetadata[]
  listMoveCorrectionRecords(mapSlug: string, originOperationId: string): readonly SqliteLivePlayOpRecord[]
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
  readonly move_compensation_json: unknown
  readonly correction_origin_op_id: unknown
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

const parseMoveCompensation = (
  value: unknown,
  opId: string,
): AcceptedMoveCompensationResult | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error('live_play_ops.move_compensation_json must be null or a string')
  }
  return parseAcceptedMoveCompensationResult(
    parseStoredDocumentJson<unknown>(value, `live-play op ${opId} move compensation`),
  )
}

const rowToOpRecord = (row: OpRow): SqliteLivePlayOpRecord => {
  if (typeof row.command_json !== 'string') throw new Error('live_play_ops.command_json must be a string')
  if (typeof row.result_json !== 'string') throw new Error('live_play_ops.result_json must be a string')

  const opId = validateLivePlayOperationId(row.op_id, 'live_play_ops.op_id')
  const mapSlug = parseLivePlayMapSlug(row.map_slug, 'live_play_ops.map_slug')
  const commandHash = validateCommandHash(row.command_hash)
  const command = parseStoredDocumentJson<unknown>(row.command_json, `live-play op ${opId} command`)
  const result = parseRecordedResult(row.result_json, opId)
  const moveCompensation = parseMoveCompensation(row.move_compensation_json, opId)
  const correctionOriginOperationId = row.correction_origin_op_id === null
    || row.correction_origin_op_id === undefined
    ? undefined
    : validateLivePlayOperationId(
        row.correction_origin_op_id,
        'live_play_ops.correction_origin_op_id',
      )
  const createdAt = parseStoredTimestamp(row.created_at, 'live_play_ops.created_at')
  const resultRevision = parseResultRevision(row.result_revision)

  if (result.opId !== opId) {
    throw new Error(`live-play op ${opId} result_json opId must match op_id`)
  }
  if (result.mapSlug !== mapSlug) {
    throw new Error(`live-play op ${opId} result_json mapSlug must match map_slug`)
  }
  if (moveCompensation && (
    !result.ok
    || moveCompensation.mapSlug !== mapSlug
    || moveCompensation.originOperationId !== opId
  )) {
    throw new Error(`live-play op ${opId} move_compensation_json must match an accepted row identity`)
  }
  if (correctionOriginOperationId === opId) {
    throw new Error(`live-play op ${opId} cannot reference itself as a correction origin`)
  }
  if (correctionOriginOperationId !== undefined && moveCompensation !== undefined) {
    throw new Error(`live-play op ${opId} cannot be both a correction and a compensation source`)
  }

  return {
    schemaVersion: LIVE_PLAY_OP_STORE_SCHEMA_VERSION,
    mapSlug,
    opId,
    commandHash,
    command: cloneStoredJson(command),
    result,
    ...(moveCompensation === undefined ? {} : { moveCompensation }),
    ...(correctionOriginOperationId === undefined ? {} : { correctionOriginOperationId }),
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
  if (!result.ok && result.reason === 'abandoned') return null
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
  const opId = validateLivePlayOperationId(input.opId, 'live-play op opId')
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
  if (input.moveCompensation !== undefined) {
    const compensation = parseAcceptedMoveCompensationResult(input.moveCompensation)
    if (!input.result.ok) {
      throw new Error('rejected live-play operations cannot store move compensation metadata')
    }
    if (compensation.mapSlug !== mapSlug || compensation.originOperationId !== opId) {
      throw new Error('move compensation identity must match the stored live-play operation')
    }
  }
  if (input.correctionOriginOperationId !== undefined) {
    const originOperationId = validateLivePlayOperationId(
      input.correctionOriginOperationId,
      'correction origin operation ID',
    )
    if (originOperationId === opId) {
      throw new Error('a live-play correction operation cannot reference itself')
    }
    if (input.moveCompensation !== undefined) {
      throw new Error('a live-play operation cannot be both an original compensation source and a correction')
    }
  }
}

export const createSqliteLivePlayOpRepository = (
  options: CreateSqliteLivePlayOpRepositoryOptions = {},
): LivePlayOpRepository => {
  const database = options.database ?? getRotomDatabase()
  const clock = options.clock ?? Date.now

  const findByOpId = (opId: string): SqliteLivePlayOpRecord | null => {
    const parsedOpId = validateLivePlayOperationId(opId, 'live-play op opId')
    const row = database.connection.prepare(`
      SELECT
        op_id,
        map_slug,
        command_hash,
        command_json,
        result_json,
        result_revision,
        move_compensation_json,
        correction_origin_op_id,
        created_at
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

  const countStoredOpsForMap = (mapSlugInput: string, createdAtOrAfterInput = 0): number => {
    const mapSlug = parseLivePlayMapSlug(mapSlugInput, 'live-play op mapSlug')
    if (!Number.isSafeInteger(createdAtOrAfterInput) || createdAtOrAfterInput < 0) {
      throw new Error('live-play operation source timestamp must be a non-negative safe integer')
    }
    const row = database.connection.prepare(`
      SELECT COUNT(*) AS count FROM live_play_ops WHERE map_slug = ? AND created_at >= ?
    `).get(mapSlug, createdAtOrAfterInput) as { readonly count: unknown } | undefined
    const count = Number(row?.count)
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('live-play operation source count is invalid')
    return count
  }

  const listStoredOpsForMap = (
    mapSlugInput: string,
    limitInput = 10_000,
  ): readonly SqliteLivePlayOpRecord[] => {
    const mapSlug = parseLivePlayMapSlug(mapSlugInput, 'live-play op mapSlug')
    if (!Number.isSafeInteger(limitInput) || limitInput < 1 || limitInput > 10_000) {
      throw new Error('live-play operation source limit must be from 1 through 10000')
    }
    const rows = database.connection.prepare(`
      SELECT
        op_id,
        map_slug,
        command_hash,
        command_json,
        result_json,
        result_revision,
        move_compensation_json,
        correction_origin_op_id,
        created_at
      FROM (
        SELECT * FROM live_play_ops
        WHERE map_slug = ?
        ORDER BY created_at DESC, op_id DESC
        LIMIT ?
      ) AS bounded_live_play_ops
      ORDER BY created_at ASC, op_id ASC
    `).all(mapSlug, limitInput) as unknown as OpRow[]
    return rows.map(rowToOpRecord)
  }

  const listAcceptedOpsSinceRevision = (
    input: LivePlayAcceptedOperationHistoryInput,
  ): readonly LivePlayAcceptedOperationMetadata[] => {
    const mapSlug = parseLivePlayMapSlug(input.mapSlug, 'live-play op history mapSlug')
    const baseRevision = parseStoredRevision(input.baseRevision, 'live-play op history baseRevision')
    const currentRevision = parseStoredRevision(input.currentRevision, 'live-play op history currentRevision')
    if (baseRevision >= currentRevision) return []

    const rows = database.connection.prepare(`
      SELECT
        op_id,
        map_slug,
        command_hash,
        command_json,
        result_json,
        result_revision,
        move_compensation_json,
        correction_origin_op_id,
        created_at
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

  const listMoveCorrectionRecords = (
    mapSlugInput: string,
    originOperationIdInput: string,
  ): readonly SqliteLivePlayOpRecord[] => {
    const mapSlug = parseLivePlayMapSlug(mapSlugInput, 'live-play correction mapSlug')
    const originOperationId = validateLivePlayOperationId(
      originOperationIdInput,
      'live-play correction origin operation ID',
    )
    const rows = database.connection.prepare(`
      SELECT
        op_id,
        map_slug,
        command_hash,
        command_json,
        result_json,
        result_revision,
        move_compensation_json,
        correction_origin_op_id,
        created_at
      FROM live_play_ops
      WHERE map_slug = ?
        AND correction_origin_op_id = ?
      ORDER BY created_at ASC, op_id ASC
    `).all(mapSlug, originOperationId) as unknown as OpRow[]
    return rows.map(rowToOpRecord)
  }

  const saveCommandResult = (input: SaveSqliteLivePlayOpResultInput): SqliteLivePlayOpRecord =>
    database.withTransaction(() => {
      validateSaveInput(input)
      const mapSlug = parseLivePlayMapSlug(input.mapSlug, 'live-play op mapSlug')
      const opId = validateLivePlayOperationId(input.opId, 'live-play op opId')
      const existing = findByOpId(opId)
      if (existing) {
        if (existing.mapSlug !== mapSlug || existing.commandHash !== input.commandHash) {
          throw new Error(livePlayIdempotencyViolationMessage(existing.mapSlug, existing.opId))
        }
        assertLivePlayOperationResultCompatible({
          mapSlug: existing.mapSlug,
          opId: existing.opId,
          commandHash: input.commandHash,
          existingResult: existing.result,
          attemptedResult: input.result,
        })
        if (
          JSON.stringify(existing.moveCompensation ?? null)
          !== JSON.stringify(input.moveCompensation ?? null)
        ) {
          throw new Error(
            `Operation ID ${existing.mapSlug}:${existing.opId} was already recorded with different move compensation metadata`,
          )
        }
        if (
          (existing.correctionOriginOperationId ?? null)
          !== (input.correctionOriginOperationId ?? null)
        ) {
          throw new Error(
            `Operation ID ${existing.mapSlug}:${existing.opId} was already recorded with different correction ancestry`,
          )
        }
        return existing
      }

      if (input.correctionOriginOperationId !== undefined) {
        const origin = findByOpId(input.correctionOriginOperationId)
        if (
          !origin
          || origin.mapSlug !== mapSlug
          || !origin.result.ok
          || !origin.moveCompensation
        ) {
          throw new Error(
            'Correction ancestry must reference an accepted move with private compensation metadata on the same map',
          )
        }
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
          move_compensation_json,
          correction_origin_op_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        opId,
        mapSlug,
        input.commandHash,
        stringifyStoredDocument(input.command),
        stringifyStoredDocument(input.result),
        resultRevision(input.result),
        input.moveCompensation === undefined
          ? null
          : stringifyStoredDocument(
              parseAcceptedMoveCompensationResult(input.moveCompensation),
            ),
        input.correctionOriginOperationId ?? null,
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
    listStoredOpsForMap,
    countStoredOpsForMap,
    listAcceptedOpsSinceRevision,
    listMoveCorrectionRecords,
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
  listStoredOpsForMap: (mapSlug, limit) => defaultOpRepository().listStoredOpsForMap(mapSlug, limit),
  countStoredOpsForMap: (mapSlug, createdAtOrAfter) => defaultOpRepository().countStoredOpsForMap(mapSlug, createdAtOrAfter),
  listAcceptedOpsSinceRevision: (input) => defaultOpRepository().listAcceptedOpsSinceRevision(input),
  listMoveCorrectionRecords: (mapSlug, originOperationId) => (
    defaultOpRepository().listMoveCorrectionRecords(mapSlug, originOperationId)
  ),
  saveCommandResult: (input) => defaultOpRepository().saveCommandResult(input),
  saveOpResult: (input) => defaultOpRepository().saveOpResult(input),
}
