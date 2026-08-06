import { parseRealtimeEventCursorValue } from '#shared/realtimeEventLog'

export interface RealtimeCursorSessionStorageLike {
  readonly getItem: (key: string) => string | null
  readonly setItem: (key: string, value: string) => void
  readonly removeItem: (key: string) => void
}

export interface RealtimeCursorStorageAdapter {
  readonly getSessionStorage?: () => RealtimeCursorSessionStorageLike | null
  readonly warn?: (message?: unknown, ...optionalParams: unknown[]) => void
}

export interface RealtimeCursorStorage {
  readonly readCursor: (contextKey: string) => number | null
  readonly advanceCursor: (contextKey: string, sequence: number) => number
  /** Authoritative replay reconciliation may move an ahead cursor backward. */
  readonly replaceCursor: (contextKey: string, sequence: number) => number
  readonly clearMemoryForTests?: () => void
}

interface StoredRealtimeCursor {
  readonly schema: 'rotom.realtime.cursor'
  readonly version: 1
  readonly sequence: number
}

const STORAGE_KEY_PREFIX = 'rotom:realtime-cursor:v1:'
const STORED_CURSOR_SCHEMA = 'rotom.realtime.cursor' as const
const STORED_CURSOR_VERSION = 1 as const

const defaultGetSessionStorage = (): RealtimeCursorSessionStorageLike | null => {
  if (typeof window === 'undefined') return null
  return window.sessionStorage
}

const defaultWarn = (message?: unknown, ...optionalParams: unknown[]): void => {
  console.warn(message, ...optionalParams)
}

const storageKeyForContext = (contextKey: string): string => `${STORAGE_KEY_PREFIX}${contextKey}`

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const serializeCursor = (sequence: number): string => JSON.stringify({
  schema: STORED_CURSOR_SCHEMA,
  version: STORED_CURSOR_VERSION,
  sequence,
} satisfies StoredRealtimeCursor)

const parseStoredCursor = (raw: string): number => {
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) throw new Error('Stored realtime cursor must be an object.')
  if (parsed.schema !== STORED_CURSOR_SCHEMA) throw new Error('Stored realtime cursor schema is unsupported.')
  if (parsed.version !== STORED_CURSOR_VERSION) throw new Error('Stored realtime cursor version is unsupported.')
  return parseRealtimeEventCursorValue(parsed.sequence, 'stored realtime cursor sequence')
}

export const createRealtimeCursorStorage = (
  adapter: RealtimeCursorStorageAdapter = {},
): RealtimeCursorStorage => {
  const getSessionStorage = adapter.getSessionStorage ?? defaultGetSessionStorage
  const warn = adapter.warn ?? defaultWarn
  const memory = new Map<string, number>()
  let sessionStorageFailed = false
  let warnedAboutSessionStorageFailure = false

  const warnStorageFailure = (operation: string, error: unknown): void => {
    if (warnedAboutSessionStorageFailure) return
    warnedAboutSessionStorageFailure = true
    warn('[realtime] sessionStorage cursor persistence failed; using an in-memory cursor for this tab.', {
      operation,
      error,
    })
  }

  const resolveStorage = (operation: string): RealtimeCursorSessionStorageLike | null => {
    if (sessionStorageFailed) return null
    try {
      return getSessionStorage()
    } catch (error) {
      sessionStorageFailed = true
      warnStorageFailure(operation, error)
      return null
    }
  }

  const removeCorruptStoredCursor = (
    storage: RealtimeCursorSessionStorageLike,
    key: string,
    error: unknown,
  ): void => {
    try {
      storage.removeItem(key)
    } catch (removeError) {
      sessionStorageFailed = true
      warnStorageFailure('remove corrupt cursor', removeError)
      return
    }
    warn('[realtime] ignored corrupt realtime cursor.', { key, error })
  }

  const readCursor = (contextKey: string): number | null => {
    const key = storageKeyForContext(contextKey)
    const storage = resolveStorage('read cursor')
    if (!storage) return memory.get(contextKey) ?? null

    let raw: string | null
    try {
      raw = storage.getItem(key)
    } catch (error) {
      sessionStorageFailed = true
      warnStorageFailure('read cursor', error)
      return memory.get(contextKey) ?? null
    }

    if (raw === null) return null

    try {
      return parseStoredCursor(raw)
    } catch (error) {
      memory.delete(contextKey)
      removeCorruptStoredCursor(storage, key, error)
      return null
    }
  }

  const writeCursor = (contextKey: string, sequence: number): number => {
    const storage = resolveStorage('write cursor')
    if (!storage) {
      memory.set(contextKey, sequence)
      return sequence
    }

    try {
      storage.setItem(storageKeyForContext(contextKey), serializeCursor(sequence))
      memory.delete(contextKey)
      return sequence
    } catch (error) {
      sessionStorageFailed = true
      memory.set(contextKey, sequence)
      warnStorageFailure('write cursor', error)
      return sequence
    }
  }

  const replaceCursor = (contextKey: string, sequenceInput: number): number => (
    writeCursor(
      contextKey,
      parseRealtimeEventCursorValue(sequenceInput, 'realtime cursor sequence'),
    )
  )

  const advanceCursor = (contextKey: string, sequenceInput: number): number => {
    const sequence = parseRealtimeEventCursorValue(sequenceInput, 'realtime cursor sequence')
    const current = readCursor(contextKey)
    return writeCursor(contextKey, current === null ? sequence : Math.max(current, sequence))
  }

  return {
    readCursor,
    advanceCursor,
    replaceCursor,
    clearMemoryForTests: () => memory.clear(),
  }
}

export const realtimeCursorStorage = createRealtimeCursorStorage()
