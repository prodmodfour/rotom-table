import type { Ref } from 'vue'
import { getErrorMessage } from '~/utils/errorMessages'
import type { LibraryContextState } from '~/composables/library/useLibraryContextMenu'

type MaybePromise<T> = T | Promise<T>

export interface UseLibraryContextSubmitOptions<TTarget> {
  ctx: Ref<LibraryContextState<TTarget> | null>
  closeContext: () => void
  onMove: (target: TTarget, destination: string, state: LibraryContextState<TTarget>) => MaybePromise<void>
  onRename: (target: TTarget, name: string, state: LibraryContextState<TTarget>) => MaybePromise<void>
  onDelete: (target: TTarget, state: LibraryContextState<TTarget>) => MaybePromise<void>
  nameRequiredMessage?: string
  errorMessage?: (error: unknown) => string
}

/**
 * Shared submit state machine for library context-menu actions.
 *
 * Maps and sheets keep their domain-specific persistence handlers, while this
 * composable owns the common busy/error lifecycle, rename validation, error
 * normalization, and close-on-success behavior.
 */
export const useLibraryContextSubmit = <TTarget>(options: UseLibraryContextSubmitOptions<TTarget>) => {
  const submitContext = async (): Promise<boolean> => {
    const state = options.ctx.value
    if (!state || state.busy) return false

    state.busy = true
    state.error = null

    try {
      if (state.mode === 'move') {
        await options.onMove(state.target, state.input, state)
      } else if (state.mode === 'rename') {
        const name = state.input.trim()
        if (!name) {
          state.error = options.nameRequiredMessage ?? 'Name required.'
          return false
        }
        await options.onRename(state.target, name, state)
      } else if (state.mode === 'delete') {
        await options.onDelete(state.target, state)
      }

      options.closeContext()
      return true
    } catch (error: unknown) {
      state.error = (options.errorMessage ?? getErrorMessage)(error)
      return false
    } finally {
      if (options.ctx.value) options.ctx.value.busy = false
    }
  }

  return { submitContext }
}
