import type { AutosaveSaveRunContext, AutosaveSaveRunOptions, AutosaveSaveRunResult } from './autosaveTypes'

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
