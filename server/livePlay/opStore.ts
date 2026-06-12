import { existsSync, readFileSync } from 'node:fs'
import { parseLivePlayMapSlug, parseLivePlayOpId } from '#shared/livePlayCommands'
import { campaignPath } from '../utils/campaignPaths'
import { joinSafeUnderRoot } from '../utils/fsPaths'
import { writeJsonFile } from '../utils/jsonFiles'
import {
  isStorableLivePlayCommandResult,
  livePlayIdempotencyViolationMessage,
  type LivePlayCommandHash,
  type StorableLivePlayCommandResult,
} from './opResult'

export const LIVE_PLAY_OP_STORE_SCHEMA_VERSION = 1 as const
export const LIVE_PLAY_OP_STORE_ROOT = campaignPath('data', 'live-play-ops')

export interface LivePlayOpRecord {
  readonly schemaVersion: typeof LIVE_PLAY_OP_STORE_SCHEMA_VERSION
  readonly mapSlug: string
  readonly opId: string
  readonly commandHash: LivePlayCommandHash
  readonly result: StorableLivePlayCommandResult
  readonly recordedAt: string
}

export interface SaveLivePlayOpResultInput {
  readonly mapSlug: string
  readonly opId: string
  readonly commandHash: LivePlayCommandHash
  readonly result: StorableLivePlayCommandResult
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
  const parsedOpId = parseLivePlayOpId(opId)
  return `${parsedMapSlug}:${parsedOpId}`
}

const cloneRecord = (record: LivePlayOpRecord): LivePlayOpRecord => cloneJson(record)

const validateRecordIdentity = (mapSlug: string, opId: string): void => {
  parseLivePlayMapSlug(mapSlug)
  parseLivePlayOpId(opId)
}

const assertSaveInputMatchesResult = (input: SaveLivePlayOpResultInput): void => {
  validateRecordIdentity(input.mapSlug, input.opId)

  if (input.result.opId !== input.opId) {
    throw new Error('Live-play op store result opId must match the stored opId')
  }

  if (input.result.mapSlug !== input.mapSlug) {
    throw new Error('Live-play op store result mapSlug must match the stored mapSlug')
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
  recordedAt: input.recordedAt ?? clock(),
})

const assertExistingRecordCompatible = (
  existing: LivePlayOpRecord,
  commandHash: LivePlayCommandHash,
): void => {
  if (existing.commandHash !== commandHash) {
    throw new Error(livePlayIdempotencyViolationMessage(existing.mapSlug, existing.opId))
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
  const opId = parseLivePlayOpId(value.opId, `${source}.opId`)
  if (typeof value.commandHash !== 'string' || value.commandHash.length === 0) {
    throw new Error(`Live-play op record ${source}.commandHash must be a non-empty string`)
  }
  if (typeof value.recordedAt !== 'string' || value.recordedAt.trim().length === 0) {
    throw new Error(`Live-play op record ${source}.recordedAt must be a non-empty string`)
  }
  if (!isStorableLivePlayCommandResult(value.result)) {
    throw new Error(`Live-play op record ${source}.result must be an accepted or rejected result`)
  }
  if (value.result.opId !== opId) {
    throw new Error(`Live-play op record ${source}.result.opId must match the record opId`)
  }
  if (value.result.mapSlug !== mapSlug) {
    throw new Error(`Live-play op record ${source}.result.mapSlug must match the record mapSlug`)
  }

  return {
    schemaVersion: LIVE_PLAY_OP_STORE_SCHEMA_VERSION,
    mapSlug,
    opId,
    commandHash: value.commandHash as LivePlayCommandHash,
    result: cloneJson(value.result),
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
        assertExistingRecordCompatible(existing, input.commandHash)
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
        assertExistingRecordCompatible(existing, input.commandHash)
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
