import type { RealtimeEventRetentionPolicy } from './realtimeEventRetentionConfig'
import {
  createSqliteRealtimeEventRepository,
  type PlanRealtimeEventRetentionInput,
  type RealtimeEventRepository,
  type RealtimeEventRetentionPruneResult,
} from '../storage/realtimeEventRepository'

export interface RealtimeEventRetentionSchedulerLogger {
  info?(message: string, context?: Record<string, unknown>): void
  error?(message: string, context?: Record<string, unknown>): void
}

type IntervalHandle = ReturnType<typeof setInterval>

export interface RealtimeEventRetentionSchedulerTimers {
  setInterval(handler: () => void, intervalMs: number): IntervalHandle
  clearInterval(handle: IntervalHandle): void
}

export interface RealtimeEventRetentionSchedulerOptions {
  readonly policy: RealtimeEventRetentionPolicy
  readonly repository?: Pick<RealtimeEventRepository, 'pruneRetention'>
  readonly repositoryFactory?: () => Pick<RealtimeEventRepository, 'pruneRetention'>
  readonly timers?: RealtimeEventRetentionSchedulerTimers
  readonly clock?: () => number
  readonly logger?: RealtimeEventRetentionSchedulerLogger
}

export interface RealtimeEventRetentionScheduler {
  start(): void
  stop(): void
  runOnce(triggerReason?: string): RealtimeEventRetentionPruneResult | null
  readonly running: boolean
}

const defaultTimers: RealtimeEventRetentionSchedulerTimers = {
  setInterval: (handler, intervalMs) => setInterval(handler, intervalMs),
  clearInterval: (handle) => clearInterval(handle),
}

const defaultRepositoryFactory = (): Pick<RealtimeEventRepository, 'pruneRetention'> => (
  createSqliteRealtimeEventRepository()
)

const retentionInput = (
  policy: RealtimeEventRetentionPolicy,
  clock: () => number,
): PlanRealtimeEventRetentionInput => ({ policy, now: clock() })

const logCompletedPrune = (
  logger: RealtimeEventRetentionSchedulerLogger,
  result: RealtimeEventRetentionPruneResult,
  triggerReason: string,
): void => {
  if (result.deletedCount <= 0) return
  logger.info?.('[realtime-retention] prune completed', {
    deletedCount: result.deletedCount,
    previousEarliestSequence: result.previousCursorState.earliestAvailableSequence,
    currentEarliestSequence: result.currentCursorState.earliestAvailableSequence,
    latestSequence: result.currentCursorState.latestSequence,
    triggerReason,
  })
}

export const createRealtimeEventRetentionScheduler = (
  options: RealtimeEventRetentionSchedulerOptions,
): RealtimeEventRetentionScheduler => {
  const timers = options.timers ?? defaultTimers
  const clock = options.clock ?? Date.now
  const logger = options.logger ?? console
  const repositoryFactory = options.repository
    ? () => options.repository as Pick<RealtimeEventRepository, 'pruneRetention'>
    : (options.repositoryFactory ?? defaultRepositoryFactory)

  let interval: IntervalHandle | null = null
  let running = false
  let pruning = false

  const runOnce = (triggerReason = 'scheduled'): RealtimeEventRetentionPruneResult | null => {
    if (!options.policy.enabled) return null
    if (pruning) return null

    pruning = true
    try {
      const result = repositoryFactory().pruneRetention(retentionInput(options.policy, clock))
      logCompletedPrune(logger, result, triggerReason)
      return result
    } catch (error) {
      logger.error?.('[realtime-retention] prune failed', { triggerReason, error })
      return null
    } finally {
      pruning = false
    }
  }

  return {
    start: () => {
      if (running || !options.policy.enabled) return
      interval = timers.setInterval(() => { runOnce('scheduled') }, options.policy.pruneIntervalMs)
      running = true
    },
    stop: () => {
      if (interval !== null) {
        timers.clearInterval(interval)
        interval = null
      }
      running = false
    },
    runOnce,
    get running() {
      return running
    },
  }
}
