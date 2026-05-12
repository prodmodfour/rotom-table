import type { AutosaveDirtyScheduler, AutosaveDirtySchedulerOptions } from './autosaveTypes'

/**
 * Schedules a debounced autosave only when the current resource differs from
 * the last clean server snapshot. UI-specific callers keep ownership of the
 * pending/saving status transition through markPending so existing error-copy
 * timing stays unchanged.
 */
export const createAutosaveDirtyScheduler = <TValue>(
  options: AutosaveDirtySchedulerOptions<TValue>,
): AutosaveDirtyScheduler<TValue> => ({
  scheduleIfDirty: (value) => {
    if (value == null) return false
    if (options.snapshot.isClean(value)) return false
    options.markPending()
    options.task.schedule()
    return true
  },
})
