import { ref } from 'vue'
import { getErrorMessage } from '~/utils/errorMessages'

export type TakeLibraryDropPayload<TPayload> = (
  event: DragEvent,
  targetPath: string,
) => TPayload | null

export interface UseLibraryDropMoveOptions<TPayload> {
  takeDropPayload: TakeLibraryDropPayload<TPayload>
  movePayload: (payload: TPayload, targetPath: string) => Promise<void> | void
  onError?: (error: unknown) => void
}

/**
 * Shared drag/drop persistence state for library browsers.
 *
 * `useLibraryDragDrop` owns pointer/hover/drop validation mechanics; this
 * composable owns the repeated async persistence wrapper once a valid payload
 * has been captured: busy state, error normalization, and optional logging.
 */
export const useLibraryDropMove = <TPayload>(options: UseLibraryDropMoveOptions<TPayload>) => {
  const moving = ref(false)
  const moveError = ref<string | null>(null)

  const persistDroppedPayload = async (
    payload: TPayload,
    targetPath: string,
  ): Promise<boolean> => {
    moving.value = true
    moveError.value = null

    try {
      await options.movePayload(payload, targetPath)
      return true
    } catch (error: unknown) {
      moveError.value = getErrorMessage(error)
      options.onError?.(error)
      return false
    } finally {
      moving.value = false
    }
  }

  const onDrop = async (event: DragEvent, targetPath: string): Promise<boolean> => {
    const payload = options.takeDropPayload(event, targetPath)
    if (!payload) return false
    return persistDroppedPayload(payload, targetPath)
  }

  return {
    moving,
    moveError,
    persistDroppedPayload,
    onDrop,
  }
}
