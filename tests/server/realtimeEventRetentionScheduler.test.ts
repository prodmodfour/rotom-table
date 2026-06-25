import { describe, expect, it, vi } from 'vitest'
import type { RealtimeEventRetentionPolicy } from '../../server/realtime/realtimeEventRetentionConfig'
import { createRealtimeEventRetentionScheduler } from '../../server/realtime/realtimeEventRetentionScheduler'
import type { RealtimeEventRetentionPruneResult } from '../../server/storage/realtimeEventRepository'

const policy = (overrides: Partial<RealtimeEventRetentionPolicy> = {}): RealtimeEventRetentionPolicy => ({
  enabled: true,
  retentionDays: 30,
  maxRows: 250_000,
  pruneIntervalMs: 10_000,
  ...overrides,
})

const pruneResult = (overrides: Partial<RealtimeEventRetentionPruneResult> = {}): RealtimeEventRetentionPruneResult => ({
  policy: policy(),
  now: 1_000,
  ageCutoffTimestamp: -2_591_999_000,
  rowCount: 0,
  cursorState: { latestSequence: 0, earliestAvailableSequence: 1 },
  oldestTimestamp: null,
  newestTimestamp: null,
  ageCutoffSequence: 0,
  rowCountCutoffSequence: 0,
  cutoffSequence: 0,
  eligibleByAge: 0,
  eligibleByCount: 0,
  estimatedDeleteCount: 0,
  cutoffReason: 'none',
  deletedCount: 0,
  deletedThroughSequence: 0,
  previousCursorState: { latestSequence: 0, earliestAvailableSequence: 1 },
  currentCursorState: { latestSequence: 0, earliestAvailableSequence: 1 },
  ...overrides,
})

const manualTimers = () => {
  const intervals = new Map<number, () => void>()
  let nextId = 1
  const cleared: number[] = []
  return {
    intervals,
    cleared,
    timers: {
      setInterval: vi.fn((handler: () => void) => {
        const id = nextId++
        intervals.set(id, handler)
        return id as unknown as ReturnType<typeof setInterval>
      }),
      clearInterval: vi.fn((handle: ReturnType<typeof setInterval>) => {
        const id = handle as unknown as number
        cleared.push(id)
        intervals.delete(id)
      }),
    },
  }
}

describe('realtime event retention scheduler', () => {
  it('starts, runs periodically, and stops its timer', () => {
    const timers = manualTimers()
    const repository = { pruneRetention: vi.fn(() => pruneResult()) }
    const scheduler = createRealtimeEventRetentionScheduler({
      policy: policy({ pruneIntervalMs: 60_000 }),
      repository,
      timers: timers.timers,
      clock: () => 123,
      logger: { info: vi.fn(), error: vi.fn() },
    })

    scheduler.start()
    scheduler.start()
    expect(scheduler.running).toBe(true)
    expect(timers.timers.setInterval).toHaveBeenCalledOnce()
    expect(timers.timers.setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000)

    timers.intervals.get(1)?.()
    expect(repository.pruneRetention).toHaveBeenCalledWith({ policy: policy({ pruneIntervalMs: 60_000 }), now: 123 })

    scheduler.stop()
    expect(scheduler.running).toBe(false)
    expect(timers.cleared).toEqual([1])
  })

  it('does not touch the database when disabled', () => {
    const timers = manualTimers()
    const repositoryFactory = vi.fn()
    const scheduler = createRealtimeEventRetentionScheduler({
      policy: policy({ enabled: false }),
      repositoryFactory,
      timers: timers.timers,
      logger: { info: vi.fn(), error: vi.fn() },
    })

    scheduler.start()
    expect(timers.timers.setInterval).not.toHaveBeenCalled()
    expect(scheduler.runOnce()).toBeNull()
    expect(repositoryFactory).not.toHaveBeenCalled()
  })

  it('isolates prune errors from request handling', () => {
    const failure = new Error('database busy')
    const logger = { info: vi.fn(), error: vi.fn() }
    const scheduler = createRealtimeEventRetentionScheduler({
      policy: policy(),
      repository: { pruneRetention: vi.fn(() => { throw failure }) },
      logger,
    })

    expect(scheduler.runOnce('scheduled')).toBeNull()
    expect(logger.error).toHaveBeenCalledWith('[realtime-retention] prune failed', {
      triggerReason: 'scheduled',
      error: failure,
    })
  })

  it('logs completed scheduled prunes only when rows were deleted', () => {
    const logger = { info: vi.fn(), error: vi.fn() }
    const repository = {
      pruneRetention: vi.fn()
        .mockReturnValueOnce(pruneResult())
        .mockReturnValueOnce(pruneResult({
          deletedCount: 2,
          deletedThroughSequence: 4,
          previousCursorState: { latestSequence: 7, earliestAvailableSequence: 1 },
          currentCursorState: { latestSequence: 7, earliestAvailableSequence: 5 },
        })),
    }
    const scheduler = createRealtimeEventRetentionScheduler({ policy: policy(), repository, logger })

    scheduler.runOnce('scheduled')
    expect(logger.info).not.toHaveBeenCalled()
    scheduler.runOnce('scheduled')
    expect(logger.info).toHaveBeenCalledWith('[realtime-retention] prune completed', {
      deletedCount: 2,
      previousEarliestSequence: 1,
      currentEarliestSequence: 5,
      latestSequence: 7,
      triggerReason: 'scheduled',
    })
  })
})
