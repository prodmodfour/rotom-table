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

export interface AutosaveDirtyScheduler<TValue> {
  scheduleIfDirty: (value: TValue | null | undefined) => boolean
}

export interface AutosaveDirtySchedulerOptions<TValue> {
  snapshot: Pick<AutosaveSnapshotTracker<TValue>, 'isClean'>
  task: Pick<DebouncedAutosaveTask, 'schedule'>
  markPending: () => void
}

export interface AutosaveResourceController<TValue, TStatus extends string> {
  statusController: AutosaveStatusController<TStatus>
  snapshot: AutosaveSnapshotTracker<TValue>
  guard: LatestSaveGuard
  task: DebouncedAutosaveTask
  dirtyScheduler: AutosaveDirtyScheduler<TValue>
  scheduleIfDirty: (value: TValue | null | undefined) => boolean
  saveNow: () => Promise<void>
  cancelPendingSave: () => boolean
}

export interface AutosaveResourceControllerOptions<TValue, TStatus extends string> {
  refs: AutosaveStatusRefs<TStatus>
  labels: AutosaveStatusLabels<TStatus>
  serialize: (value: TValue) => string
  initialValue?: TValue
  save: () => Promise<void> | void
  debounceMs: number
  markPending: () => void
  timers?: DebouncedAutosaveTaskTimers
  statusOptions?: AutosaveStatusControllerOptions
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
