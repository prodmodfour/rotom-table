import { getErrorMessage as getDefaultErrorMessage } from './errorMessages'

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

export interface AutosaveStatusRefs<TStatus extends string> {
  status: { value: TStatus }
  error: { value: string | null }
}

export interface AutosaveStatusLabels<TStatus extends string> {
  saving: TStatus
  saved: TStatus
  error: TStatus
}

export interface AutosaveStatusErrorOptions {
  logPrefix?: string
  fallback?: string
}

export interface AutosaveStatusController<TStatus extends string> {
  setStatus: (status: TStatus) => void
  clearError: () => void
  markSaving: () => void
  markSaved: () => void
  markError: (error: unknown, options?: AutosaveStatusErrorOptions) => string
}

export interface AutosaveStatusControllerOptions {
  getErrorMessage?: (error: unknown, options?: { fallback?: string }) => string
  logError?: (prefix: string, error: unknown) => void
}

export interface AutosaveSaveRunContext {
  sequence: number
  latest: boolean
}

export interface AutosaveSaveRunOptions<TStatus extends string, TResult> {
  guard: LatestSaveGuard
  status: AutosaveStatusController<TStatus>
  save: () => Promise<TResult>
  onSuccess?: (result: TResult, context: AutosaveSaveRunContext) => void | Promise<void>
  onError?: (error: unknown, context: AutosaveSaveRunContext) => void | Promise<void>
  markSaved?: boolean | ((context: AutosaveSaveRunContext) => boolean)
  error?: AutosaveStatusErrorOptions | ((error: unknown, context: AutosaveSaveRunContext) => AutosaveStatusErrorOptions)
}

export type AutosaveSaveRunResult<TResult> =
  | ({ ok: true; result: TResult } & AutosaveSaveRunContext)
  | ({ ok: false; error: unknown } & AutosaveSaveRunContext)

/**
 * Coordinates the common save status/error refs used by autosaved client
 * resources. The caller decides which statuses exist in its wider state
 * machine; this controller only owns the saving/saved/error transitions.
 */
export const createAutosaveStatusController = <TStatus extends string>(
  refs: AutosaveStatusRefs<TStatus>,
  labels: AutosaveStatusLabels<TStatus>,
  options: AutosaveStatusControllerOptions = {},
): AutosaveStatusController<TStatus> => {
  const normalizeError = options.getErrorMessage ?? getDefaultErrorMessage
  const logError = options.logError ?? ((prefix: string, error: unknown) => console.error(prefix, error))

  return {
    setStatus: (status) => {
      refs.status.value = status
    },
    clearError: () => {
      refs.error.value = null
    },
    markSaving: () => {
      refs.status.value = labels.saving
      refs.error.value = null
    },
    markSaved: () => {
      refs.status.value = labels.saved
    },
    markError: (error, errorOptions = {}) => {
      const message = normalizeError(error, { fallback: errorOptions.fallback })
      refs.status.value = labels.error
      refs.error.value = message
      if (errorOptions.logPrefix) logError(errorOptions.logPrefix, error)
      return message
    },
  }
}

/**
 * Runs one autosave request with the shared latest-save guard and status
 * transitions. Resource-specific callers keep ownership of request payloads
 * and server-snapshot adoption, while this helper centralizes the stale-save
 * status/error rules used by editable maps and sheets.
 */
export const runLatestAutosave = async <TStatus extends string, TResult>(
  options: AutosaveSaveRunOptions<TStatus, TResult>,
): Promise<AutosaveSaveRunResult<TResult>> => {
  const sequence = options.guard.begin()
  options.status.markSaving()

  try {
    const result = await options.save()
    const context: AutosaveSaveRunContext = {
      sequence,
      latest: options.guard.isLatest(sequence),
    }

    await options.onSuccess?.(result, context)

    const shouldMarkSaved =
      typeof options.markSaved === 'function'
        ? options.markSaved(context)
        : options.markSaved !== false
    if (context.latest && shouldMarkSaved) options.status.markSaved()

    return { ok: true, result, ...context }
  } catch (error: unknown) {
    const context: AutosaveSaveRunContext = {
      sequence,
      latest: options.guard.isLatest(sequence),
    }

    await options.onError?.(error, context)

    if (context.latest) {
      const errorOptions =
        typeof options.error === 'function' ? options.error(error, context) : options.error
      options.status.markError(error, errorOptions)
    }

    return { ok: false, error, ...context }
  }
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
