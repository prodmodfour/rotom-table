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
