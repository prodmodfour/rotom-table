import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAutosaveSnapshotTracker,
  createDebouncedAutosaveTask,
  createLatestSaveGuard,
} from '~/utils/autosave'

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
