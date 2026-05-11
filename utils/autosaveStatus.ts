import { getErrorMessage as getDefaultErrorMessage } from './errorMessages'
import type {
  AutosaveStatusController,
  AutosaveStatusControllerOptions,
  AutosaveStatusLabels,
  AutosaveStatusRefs,
} from './autosaveTypes'

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
