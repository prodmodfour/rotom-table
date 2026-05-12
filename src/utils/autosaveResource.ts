import { createAutosaveDirtyScheduler } from './autosaveDirtyScheduler'
import { createAutosaveSnapshotTracker } from './autosaveSnapshots'
import { createAutosaveStatusController } from './autosaveStatus'
import { createDebouncedAutosaveTask, createLatestSaveGuard } from './autosaveTasks'
import type { AutosaveResourceController, AutosaveResourceControllerOptions } from './autosaveTypes'

/**
 * Bundles the autosave primitives shared by editable resources while keeping
 * resource-specific persistence and realtime behavior in the caller. This is
 * intentionally a small coordinator, not a framework: callers still decide how
 * to serialize persisted payloads, run saves, and mark pending UI state.
 */
export const createAutosaveResourceController = <TValue, TStatus extends string>(
  options: AutosaveResourceControllerOptions<TValue, TStatus>,
): AutosaveResourceController<TValue, TStatus> => {
  const statusController = createAutosaveStatusController<TStatus>(
    options.refs,
    options.labels,
    options.statusOptions,
  )
  const snapshot = createAutosaveSnapshotTracker(options.serialize, options.initialValue)
  const guard = createLatestSaveGuard()
  const task = createDebouncedAutosaveTask(options.save, options.debounceMs, options.timers)
  const dirtyScheduler = createAutosaveDirtyScheduler<TValue>({
    snapshot,
    task,
    markPending: options.markPending,
  })

  return {
    statusController,
    snapshot,
    guard,
    task,
    dirtyScheduler,
    scheduleIfDirty: dirtyScheduler.scheduleIfDirty,
    saveNow: task.runNow,
    cancelPendingSave: task.cancel,
  }
}
