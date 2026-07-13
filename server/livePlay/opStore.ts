import { existsSync, readFileSync } from 'node:fs'
import { parseLivePlayMapSlug } from '#shared/livePlayCommands'
import { campaignPath } from '../utils/campaignPaths'
import { joinSafeUnderRoot } from '../utils/fsPaths'
import { writeJsonFile } from '../utils/jsonFiles'
import {
  assertLivePlayOperationResultCompatible,
  isStorableLivePlayCommandResult,
  livePlayIdempotencyViolationMessage,
  type LivePlayCommandHash,
  type StorableLivePlayCommandResult,
} from './opResult'
import { validateLivePlayOperationId } from './commandIdempotency'
import {
  parseAcceptedMoveCompensationResult,
  type AcceptedMoveCompensationResult,
} from '../domain/moveAutomation/acceptedMoveCompensation'

export const LIVE_PLAY_OP_STORE_SCHEMA_VERSION = 1 as const
export const LIVE_PLAY_OP_STORE_ROOT = campaignPath('data', 'live-play-ops')

export interface LivePlayOpRecord {
  readonly schemaVersion: typeof LIVE_PLAY_OP_STORE_SCHEMA_VERSION
  readonly mapSlug: string
  readonly opId: string
  readonly commandHash: LivePlayCommandHash
  readonly result: StorableLivePlayCommandResult
  /** Private server-only correction metadata; never included in command results. */
  readonly moveCompensation?: AcceptedMoveCompensationResult
  /** Durable ancestry for a GM correction attempt or accepted correction. */
  readonly correctionOriginOperationId?: string
  readonly recordedAt: string
}

export interface SaveLivePlayOpResultInput {
  readonly mapSlug: string
  readonly opId: string
  readonly commandHash: LivePlayCommandHash
  readonly result: StorableLivePlayCommandResult
  readonly moveCompensation?: AcceptedMoveCompensationResult
  readonly correctionOriginOperationId?: string
  readonly recordedAt?: string
}

export interface LivePlayOpStore {
  getOpRecord(mapSlug: string, opId: string): LivePlayOpRecord | null
  getOpResult(mapSlug: string, opId: string): StorableLivePlayCommandResult | null
  saveOpResult(input: SaveLivePlayOpResultInput): LivePlayOpRecord
}

export interface CreateFileLivePlayOpStoreOptions {
  readonly root?: string
  readonly clock?: () => string
}

export interface CreateInMemoryLivePlayOpStoreOptions {
  readonly clock?: () => string
}

export interface InMemoryLivePlayOpStore extends LivePlayOpStore {
  readonly recordCount: number
  list(mapSlug?: string): readonly LivePlayOpRecord[]
  clear(): void
}

const defaultClock = (): string => new Date().toISOString()

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const recordKey = (mapSlug: string, opId: string): string => {
  const parsedMapSlug = parseLivePlayMapSlug(mapSlug)
  const parsedOpId = validateLivePlayOperationId(opId)
  return `${parsedMapSlug}:${parsedOpId}`
}

const cloneRecord = (record: LivePlayOpRecord): LivePlayOpRecord => cloneJson(record)

const validateRecordIdentity = (mapSlug: string, opId: string): void => {
  parseLivePlayMapSlug(mapSlug)
  validateLivePlayOperationId(opId)
}

const assertSaveInputMatchesResult = (input: SaveLivePlayOpResultInput): void => {
  validateRecordIdentity(input.mapSlug, input.opId)

  if (input.result.opId !== input.opId) {
    throw new Error('Live-play op store result opId must match the stored opId')
  }

  if (input.result.mapSlug !== input.mapSlug) {
    throw new Error('Live-play op store result mapSlug must match the stored mapSlug')
  }
  if (input.moveCompensation !== undefined) {
    const compensation = parseAcceptedMoveCompensationResult(input.moveCompensation)
    if (!input.result.ok) {
      throw new Error('Rejected live-play operations cannot store move compensation metadata')
    }
    if (
      compensation.mapSlug !== input.mapSlug
      || compensation.originOperationId !== input.opId
    ) {
      throw new Error('Move compensation identity must match the stored live-play operation')
    }
  }
  if (input.correctionOriginOperationId !== undefined) {
    const originOperationId = validateLivePlayOperationId(
      input.correctionOriginOperationId,
      'correction origin operation ID',
    )
    if (originOperationId === input.opId) {
      throw new Error('A live-play correction operation cannot reference itself')
    }
    if (input.moveCompensation !== undefined) {
      throw new Error('A live-play operation cannot be both an original compensation source and a correction')
    }
  }
}

const recordFromSaveInput = (
  input: SaveLivePlayOpResultInput,
  clock: () => string,
): LivePlayOpRecord => ({
  schemaVersion: LIVE_PLAY_OP_STORE_SCHEMA_VERSION,
  mapSlug: input.mapSlug,
  opId: input.opId,
  commandHash: input.commandHash,
  result: cloneJson(input.result),
  ...(input.moveCompensation === undefined
    ? {}
    : { moveCompensation: parseAcceptedMoveCompensationResult(input.moveCompensation) }),
  ...(input.correctionOriginOperationId === undefined
    ? {}
    : {
        correctionOriginOperationId: validateLivePlayOperationId(
          input.correctionOriginOperationId,
          'correction origin operation ID',
        ),
      }),
  recordedAt: input.recordedAt ?? clock(),
})

const assertExistingRecordCompatible = (
  existing: LivePlayOpRecord,
  commandHash: LivePlayCommandHash,
  attemptedResult: StorableLivePlayCommandResult,
): void => {
  if (existing.commandHash !== commandHash) {
    throw new Error(livePlayIdempotencyViolationMessage(existing.mapSlug, existing.opId))
  }

  assertLivePlayOperationResultCompatible({
    mapSlug: existing.mapSlug,
    opId: existing.opId,
    commandHash,
    existingResult: existing.result,
    attemptedResult,
  })
}

const assertExistingCompensationCompatible = (
  existing: LivePlayOpRecord,
  attempted: AcceptedMoveCompensationResult | undefined,
): void => {
  if (JSON.stringify(existing.moveCompensation ?? null) !== JSON.stringify(attempted ?? null)) {
    throw new Error(
      `Operation ID ${existing.mapSlug}:${existing.opId} was already recorded with different move compensation metadata`,
    )
  }
}

const assertExistingCorrectionOriginCompatible = (
  existing: LivePlayOpRecord,
  attempted: string | undefined,
): void => {
  if ((existing.correctionOriginOperationId ?? null) !== (attempted ?? null)) {
    throw new Error(
      `Operation ID ${existing.mapSlug}:${existing.opId} was already recorded with different correction ancestry`,
    )
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseStoredRecord = (value: unknown, source: string): LivePlayOpRecord => {
  if (!isRecord(value)) {
    throw new Error(`Live-play op record ${source} must be an object`)
  }
  if (value.schemaVersion !== LIVE_PLAY_OP_STORE_SCHEMA_VERSION) {
    throw new Error(`Live-play op record ${source} has an unsupported schemaVersion`)
  }
  const mapSlug = parseLivePlayMapSlug(value.mapSlug, `${source}.mapSlug`)
  const opId = validateLivePlayOperationId(value.opId, `${source}.opId`)
  if (typeof value.commandHash !== 'string' || value.commandHash.length === 0) {
    throw new Error(`Live-play op record ${source}.commandHash must be a non-empty string`)
  }
  if (typeof value.recordedAt !== 'string' || value.recordedAt.trim().length === 0) {
    throw new Error(`Live-play op record ${source}.recordedAt must be a non-empty string`)
  }
  if (!isStorableLivePlayCommandResult(value.result)) {
    throw new Error(`Live-play op record ${source}.result must be an accepted or rejected result`)
  }
  const moveCompensation = value.moveCompensation === undefined
    ? undefined
    : parseAcceptedMoveCompensationResult(value.moveCompensation)
  const correctionOriginOperationId = value.correctionOriginOperationId === undefined
    ? undefined
    : validateLivePlayOperationId(
        value.correctionOriginOperationId,
        `${source}.correctionOriginOperationId`,
      )
  if (value.result.opId !== opId) {
    throw new Error(`Live-play op record ${source}.result.opId must match the record opId`)
  }
  if (value.result.mapSlug !== mapSlug) {
    throw new Error(`Live-play op record ${source}.result.mapSlug must match the record mapSlug`)
  }
  if (moveCompensation && (
    !value.result.ok
    || moveCompensation.mapSlug !== mapSlug
    || moveCompensation.originOperationId !== opId
  )) {
    throw new Error(`Live-play op record ${source}.moveCompensation must match an accepted record identity`)
  }
  if (correctionOriginOperationId === opId) {
    throw new Error(`Live-play op record ${source} cannot reference itself as a correction origin`)
  }
  if (correctionOriginOperationId !== undefined && moveCompensation !== undefined) {
    throw new Error(`Live-play op record ${source} cannot be both a correction and a compensation source`)
  }

  return {
    schemaVersion: LIVE_PLAY_OP_STORE_SCHEMA_VERSION,
    mapSlug,
    opId,
    commandHash: value.commandHash as LivePlayCommandHash,
    result: cloneJson(value.result),
    ...(moveCompensation === undefined ? {} : { moveCompensation }),
    ...(correctionOriginOperationId === undefined ? {} : { correctionOriginOperationId }),
    recordedAt: value.recordedAt,
  }
}

const readRecordFile = (path: string): LivePlayOpRecord | null => {
  if (!existsSync(path)) return null
  return parseStoredRecord(JSON.parse(readFileSync(path, 'utf8')) as unknown, path)
}

const recordPath = (root: string, mapSlug: string, opId: string): string => {
  validateRecordIdentity(mapSlug, opId)
  return joinSafeUnderRoot(root, mapSlug, `${opId}.json`)
}

export const createFileLivePlayOpStore = (
  options: CreateFileLivePlayOpStoreOptions = {},
): LivePlayOpStore => {
  const root = options.root ?? LIVE_PLAY_OP_STORE_ROOT
  const clock = options.clock ?? defaultClock

  return {
    getOpRecord: (mapSlug, opId) => readRecordFile(recordPath(root, mapSlug, opId)),
    getOpResult: (mapSlug, opId) => readRecordFile(recordPath(root, mapSlug, opId))?.result ?? null,
    saveOpResult: (input) => {
      assertSaveInputMatchesResult(input)
      const path = recordPath(root, input.mapSlug, input.opId)
      const existing = readRecordFile(path)
      if (existing) {
        assertExistingRecordCompatible(existing, input.commandHash, input.result)
        assertExistingCompensationCompatible(existing, input.moveCompensation)
        assertExistingCorrectionOriginCompatible(existing, input.correctionOriginOperationId)
        return cloneRecord(existing)
      }

      const record = recordFromSaveInput(input, clock)
      writeJsonFile(path, record)
      return cloneRecord(record)
    },
  }
}

export const createInMemoryLivePlayOpStore = (
  options: CreateInMemoryLivePlayOpStoreOptions = {},
): InMemoryLivePlayOpStore => {
  const clock = options.clock ?? defaultClock
  const records = new Map<string, LivePlayOpRecord>()

  const get = (mapSlug: string, opId: string): LivePlayOpRecord | null => {
    const record = records.get(recordKey(mapSlug, opId))
    return record ? cloneRecord(record) : null
  }

  return {
    get recordCount() {
      return records.size
    },
    getOpRecord: get,
    getOpResult: (mapSlug, opId) => get(mapSlug, opId)?.result ?? null,
    saveOpResult: (input) => {
      assertSaveInputMatchesResult(input)
      const key = recordKey(input.mapSlug, input.opId)
      const existing = records.get(key)
      if (existing) {
        assertExistingRecordCompatible(existing, input.commandHash, input.result)
        assertExistingCompensationCompatible(existing, input.moveCompensation)
        assertExistingCorrectionOriginCompatible(existing, input.correctionOriginOperationId)
        return cloneRecord(existing)
      }

      const record = recordFromSaveInput(input, clock)
      records.set(key, cloneRecord(record))
      return cloneRecord(record)
    },
    list: (mapSlug) => [...records.values()]
      .filter((record) => mapSlug === undefined || record.mapSlug === mapSlug)
      .map(cloneRecord),
    clear: () => records.clear(),
  }
}

export const livePlayOpStore = createFileLivePlayOpStore()
