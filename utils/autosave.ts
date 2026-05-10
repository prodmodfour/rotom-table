export interface DebouncedAutosaveTask {
  schedule: () => void
  cancel: () => boolean
  hasPending: () => boolean
  runNow: () => Promise<void>
  flushPending: () => Promise<boolean>
}

export interface LatestSaveGuard {
  begin: () => number
  isLatest: (sequence: number) => boolean
  current: () => number
}

export interface AutosaveSnapshotTracker<T> {
  currentJson: () => string
  serialize: (value: T) => string
  markClean: (value: T) => string
  markCleanJson: (json: string) => string
  isClean: (value: T) => boolean
  isCleanJson: (json: string) => boolean
  isDirty: (value: T) => boolean
}

export interface DebouncedAutosaveTaskTimers {
  setTimeout?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void
}

export type JsonUnloadRequestTransport = 'beacon' | 'fetch' | 'none'

export interface JsonUnloadRequestResult {
  transport: JsonUnloadRequestTransport
  queued: boolean
}

export interface JsonUnloadRequestTransports {
  sendBeacon?: (url: string, data: BodyInit) => boolean
  fetch?: (url: string, init: RequestInit) => unknown
  createBlob?: (body: string, options: BlobPropertyBag) => BodyInit
}

export interface AutosaveUnloadEventTarget {
  addEventListener: (type: 'pagehide' | 'beforeunload', listener: () => void) => void
  removeEventListener: (type: 'pagehide' | 'beforeunload', listener: () => void) => void
}

/**
 * Coordinates one debounced async task without coupling the caller to timer
 * bookkeeping. The task is fire-and-forget when the debounce timer elapses;
 * callers that need immediate persistence can await runNow/flushPending.
 */
export const createDebouncedAutosaveTask = (
  task: () => Promise<void> | void,
  debounceMs: number,
  timers: DebouncedAutosaveTaskTimers = {},
): DebouncedAutosaveTask => {
  const setTimer = timers.setTimeout ?? globalThis.setTimeout
  const clearTimer = timers.clearTimeout ?? globalThis.clearTimeout
  let pendingTimer: ReturnType<typeof setTimeout> | null = null

  const cancel = (): boolean => {
    if (pendingTimer == null) return false
    clearTimer(pendingTimer)
    pendingTimer = null
    return true
  }

  const runTask = async () => {
    await task()
  }

  const schedule = () => {
    cancel()
    pendingTimer = setTimer(() => {
      pendingTimer = null
      void runTask()
    }, debounceMs)
  }

  const runNow = async () => {
    cancel()
    await runTask()
  }

  const flushPending = async (): Promise<boolean> => {
    if (!cancel()) return false
    await runTask()
    return true
  }

  return {
    schedule,
    cancel,
    hasPending: () => pendingTimer != null,
    runNow,
    flushPending,
  }
}

/**
 * Guards against stale async save completions. Each save call captures a
 * sequence value from begin(); only the latest in-flight save should update UI
 * status or error state after awaiting the server.
 */
export const createLatestSaveGuard = (): LatestSaveGuard => {
  let sequence = 0

  return {
    begin: () => {
      sequence += 1
      return sequence
    },
    isLatest: (candidate: number) => candidate === sequence,
    current: () => sequence,
  }
}

/**
 * Tracks the last server-acknowledged serialized value for an autosaved
 * resource. Keeping the comparison boundary here makes map/sheet autosave
 * flows explicit about which JSON shape is considered persisted while
 * avoiding duplicated `lastServerJson` mutation and comparison code.
 */
export const createAutosaveSnapshotTracker = <T>(
  serialize: (value: T) => string,
  initialValue?: T,
): AutosaveSnapshotTracker<T> => {
  let lastCleanJson = initialValue === undefined ? '' : serialize(initialValue)

  const markCleanJson = (json: string): string => {
    lastCleanJson = json
    return lastCleanJson
  }

  const markClean = (value: T): string => markCleanJson(serialize(value))

  return {
    currentJson: () => lastCleanJson,
    serialize,
    markClean,
    markCleanJson,
    isClean: (value: T) => serialize(value) === lastCleanJson,
    isCleanJson: (json: string) => json === lastCleanJson,
    isDirty: (value: T) => serialize(value) !== lastCleanJson,
  }
}

/**
 * Best-effort JSON write for page-unload autosaves. Prefer sendBeacon when
 * available because browsers are allowed to abort ordinary async work during
 * unload; fall back to fetch(..., keepalive: true) for browsers/environments
 * without beacon support.
 */
export const sendJsonWithUnloadFallback = (
  url: string,
  body: string,
  transports: JsonUnloadRequestTransports = {},
): JsonUnloadRequestResult => {
  const sendBeacon =
    transports.sendBeacon ??
    (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
      ? navigator.sendBeacon.bind(navigator)
      : undefined)

  if (sendBeacon) {
    try {
      const createBlob =
        transports.createBlob ??
        ((value: string, options: BlobPropertyBag): BodyInit => new Blob([value], options))
      if (sendBeacon(url, createBlob(body, { type: 'application/json' }))) {
        return { transport: 'beacon', queued: true }
      }
    } catch {
      // Fall through to keepalive fetch below.
    }
  }

  const fetcher =
    transports.fetch ??
    (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined)

  if (fetcher) {
    try {
      void fetcher(url, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
      })
      return { transport: 'fetch', queued: true }
    } catch {
      // The page is unloading; there is nowhere useful to surface this.
    }
  }

  return { transport: 'none', queued: false }
}

/**
 * Binds the two browser lifecycle events used for unload autosave flushing and
 * returns an idempotent remover. Tests can inject a minimal event target.
 */
export const bindAutosaveUnloadFlushers = (
  flush: () => void,
  target: AutosaveUnloadEventTarget | undefined =
    typeof window !== 'undefined' ? window : undefined,
): (() => void) | null => {
  if (!target) return null

  target.addEventListener('pagehide', flush)
  target.addEventListener('beforeunload', flush)

  let removed = false
  return () => {
    if (removed) return
    removed = true
    target.removeEventListener('pagehide', flush)
    target.removeEventListener('beforeunload', flush)
  }
}
