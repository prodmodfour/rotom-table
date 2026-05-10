import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bindAutosaveUnloadFlushers,
  createAutosaveSnapshotTracker,
  createAutosaveStatusController,
  createDebouncedAutosaveTask,
  createLatestSaveGuard,
  sendJsonWithUnloadFallback,
} from '~/utils/autosave'

describe('createAutosaveStatusController', () => {
  type TestStatus = 'idle' | 'saving' | 'saved' | 'error'

  const createRefs = (status: TestStatus = 'idle', error: string | null = null) => ({
    status: { value: status },
    error: { value: error },
  })

  it('owns common saving, saved, and clear-error transitions', () => {
    const refs = createRefs('idle', 'old error')
    const controller = createAutosaveStatusController<TestStatus>(refs, {
      saving: 'saving',
      saved: 'saved',
      error: 'error',
    })

    controller.markSaving()
    expect(refs.status.value).toBe('saving')
    expect(refs.error.value).toBeNull()

    controller.markSaved()
    expect(refs.status.value).toBe('saved')

    refs.error.value = 'transient'
    controller.clearError()
    expect(refs.error.value).toBeNull()

    controller.setStatus('idle')
    expect(refs.status.value).toBe('idle')
  })

  it('normalizes, stores, and optionally logs errors', () => {
    const refs = createRefs()
    const logError = vi.fn()
    const error = { data: { statusMessage: 'Disk full' } }
    const controller = createAutosaveStatusController<TestStatus>(
      refs,
      { saving: 'saving', saved: 'saved', error: 'error' },
      { logError },
    )

    const message = controller.markError(error, { logPrefix: '[save failed]' })

    expect(message).toBe('Disk full')
    expect(refs.status.value).toBe('error')
    expect(refs.error.value).toBe('Disk full')
    expect(logError).toHaveBeenCalledWith('[save failed]', error)
  })

  it('supports injected error normalization and fallback messages', () => {
    const refs = createRefs()
    const getErrorMessage = vi.fn(() => 'Custom fallback')
    const controller = createAutosaveStatusController<TestStatus>(
      refs,
      { saving: 'saving', saved: 'saved', error: 'error' },
      { getErrorMessage },
    )

    expect(controller.markError(null, { fallback: 'Save failed' })).toBe('Custom fallback')
    expect(getErrorMessage).toHaveBeenCalledWith(null, { fallback: 'Save failed' })
    expect(refs.error.value).toBe('Custom fallback')
  })
})

describe('createDebouncedAutosaveTask', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces scheduled tasks and exposes pending state', async () => {
    vi.useFakeTimers()
    const task = vi.fn()
    const autosave = createDebouncedAutosaveTask(task, 50)

    autosave.schedule()
    autosave.schedule()
    expect(autosave.hasPending()).toBe(true)
    expect(task).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(49)
    expect(task).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(task).toHaveBeenCalledTimes(1)
    expect(autosave.hasPending()).toBe(false)
  })

  it('cancels pending tasks without running them', async () => {
    vi.useFakeTimers()
    const task = vi.fn()
    const autosave = createDebouncedAutosaveTask(task, 10)

    autosave.schedule()
    expect(autosave.cancel()).toBe(true)
    expect(autosave.cancel()).toBe(false)

    await vi.advanceTimersByTimeAsync(20)
    expect(task).not.toHaveBeenCalled()
    expect(autosave.hasPending()).toBe(false)
  })

  it('runs immediately and flushes only when a task is pending', async () => {
    vi.useFakeTimers()
    const task = vi.fn()
    const autosave = createDebouncedAutosaveTask(task, 100)

    await autosave.runNow()
    expect(task).toHaveBeenCalledTimes(1)

    expect(await autosave.flushPending()).toBe(false)
    expect(task).toHaveBeenCalledTimes(1)

    autosave.schedule()
    expect(await autosave.flushPending()).toBe(true)
    expect(task).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(100)
    expect(task).toHaveBeenCalledTimes(2)
  })
})

describe('createLatestSaveGuard', () => {
  it('marks only the latest begun sequence as current', () => {
    const guard = createLatestSaveGuard()

    const first = guard.begin()
    expect(guard.current()).toBe(first)
    expect(guard.isLatest(first)).toBe(true)

    const second = guard.begin()
    expect(guard.current()).toBe(second)
    expect(guard.isLatest(first)).toBe(false)
    expect(guard.isLatest(second)).toBe(true)
  })
})

describe('createAutosaveSnapshotTracker', () => {
  const serialize = (value: { name: string; count?: number }) => JSON.stringify(value)

  it('starts empty when no initial value is provided', () => {
    const tracker = createAutosaveSnapshotTracker(serialize)

    expect(tracker.currentJson()).toBe('')
    expect(tracker.isDirty({ name: 'map' })).toBe(true)
  })

  it('tracks clean and dirty values through the provided serializer', () => {
    const tracker = createAutosaveSnapshotTracker(serialize, { name: 'sheet', count: 1 })

    expect(tracker.isClean({ name: 'sheet', count: 1 })).toBe(true)
    expect(tracker.isDirty({ name: 'sheet', count: 2 })).toBe(true)

    const json = tracker.markClean({ name: 'sheet', count: 2 })
    expect(json).toBe('{"name":"sheet","count":2}')
    expect(tracker.currentJson()).toBe(json)
    expect(tracker.isClean({ name: 'sheet', count: 2 })).toBe(true)
  })

  it('can adopt a precomputed serialized payload', () => {
    const tracker = createAutosaveSnapshotTracker(serialize, { name: 'old' })
    const nextJson = '{"name":"new"}'

    expect(tracker.markCleanJson(nextJson)).toBe(nextJson)
    expect(tracker.isCleanJson(nextJson)).toBe(true)
    expect(tracker.isClean({ name: 'new' })).toBe(true)
  })
})

describe('sendJsonWithUnloadFallback', () => {
  const blobFactory = (body: string, options: BlobPropertyBag): BodyInit =>
    ({ body, type: options.type }) as unknown as BodyInit

  it('prefers sendBeacon with an application/json blob', () => {
    const sendBeacon = vi.fn(() => true)
    const fetcher = vi.fn()

    const result = sendJsonWithUnloadFallback('/api/save', '{"ok":true}', {
      sendBeacon,
      fetch: fetcher,
      createBlob: blobFactory,
    })

    expect(result).toEqual({ transport: 'beacon', queued: true })
    expect(sendBeacon).toHaveBeenCalledWith('/api/save', { body: '{"ok":true}', type: 'application/json' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('falls back to keepalive fetch when beacon is unavailable or rejected', () => {
    const sendBeacon = vi.fn(() => false)
    const fetcher = vi.fn()

    const result = sendJsonWithUnloadFallback('/api/save', '{"ok":true}', {
      sendBeacon,
      fetch: fetcher,
      createBlob: blobFactory,
    })

    expect(result).toEqual({ transport: 'fetch', queued: true })
    expect(fetcher).toHaveBeenCalledWith('/api/save', {
      method: 'POST',
      body: '{"ok":true}',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
    })
  })

  it('reports no queued unload request when both transports fail', () => {
    const result = sendJsonWithUnloadFallback('/api/save', '{}', {
      sendBeacon: vi.fn(() => {
        throw new Error('beacon failed')
      }),
      fetch: vi.fn(() => {
        throw new Error('fetch failed')
      }),
      createBlob: blobFactory,
    })

    expect(result).toEqual({ transport: 'none', queued: false })
  })
})

describe('bindAutosaveUnloadFlushers', () => {
  it('binds and removes pagehide and beforeunload listeners once', () => {
    const listeners = new Map<string, () => void>()
    const target = {
      addEventListener: vi.fn((type: 'pagehide' | 'beforeunload', listener: () => void) => {
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: 'pagehide' | 'beforeunload', listener: () => void) => {
        if (listeners.get(type) === listener) listeners.delete(type)
      }),
    }
    const flush = vi.fn()

    const remove = bindAutosaveUnloadFlushers(flush, target)

    expect(remove).toEqual(expect.any(Function))
    expect(target.addEventListener).toHaveBeenCalledWith('pagehide', flush)
    expect(target.addEventListener).toHaveBeenCalledWith('beforeunload', flush)
    listeners.get('pagehide')?.()
    listeners.get('beforeunload')?.()
    expect(flush).toHaveBeenCalledTimes(2)

    remove?.()
    remove?.()

    expect(target.removeEventListener).toHaveBeenCalledTimes(2)
    expect(listeners.size).toBe(0)
  })
})
