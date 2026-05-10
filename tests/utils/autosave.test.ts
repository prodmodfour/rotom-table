import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDebouncedAutosaveTask, createLatestSaveGuard } from '~/utils/autosave'

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
