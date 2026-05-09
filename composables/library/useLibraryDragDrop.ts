import { ref, toValue, type MaybeRefOrGetter } from 'vue'

export interface LibraryDragTransfer {
  mimeType: string
  value: string
}

export interface UseLibraryDragDropOptions<TPayload> {
  canDrag: MaybeRefOrGetter<boolean>
  canDropPayloadOn: (payload: TPayload, targetPath: string) => boolean
}

/**
 * Shared drag/drop state for the maps and sheets library browsers.
 *
 * The composable only owns generic UI mechanics: the active payload, hovered
 * folder target, drag-event bookkeeping, and explicit drop validation before a
 * caller performs its app-specific persistence. Domain actions (move map, move
 * sheet, move folder) stay injected by the page.
 */
export const useLibraryDragDrop = <TPayload>(options: UseLibraryDragDropOptions<TPayload>) => {
  const drag = ref<TPayload | null>(null)
  const hoverTarget = ref<string | null>(null)

  const clearDrag = () => {
    drag.value = null
    hoverTarget.value = null
  }

  const startDrag = (
    event: DragEvent,
    payload: TPayload,
    transfer?: LibraryDragTransfer,
  ): boolean => {
    if (!toValue(options.canDrag)) {
      event.preventDefault()
      return false
    }

    drag.value = payload
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      if (transfer) event.dataTransfer.setData(transfer.mimeType, transfer.value)
    }
    return true
  }

  const canDropPayloadOn = (payload: TPayload, targetPath: string): boolean =>
    options.canDropPayloadOn(payload, targetPath)

  const canDropOn = (targetPath: string): boolean => {
    const payload = drag.value
    return toValue(options.canDrag) && payload !== null
      ? canDropPayloadOn(payload, targetPath)
      : false
  }

  const onDragEnd = () => {
    clearDrag()
  }

  const onDropEnter = (event: DragEvent, targetPath: string) => {
    if (!drag.value || !canDropOn(targetPath)) return
    event.preventDefault()
    hoverTarget.value = targetPath
  }

  const onDropOver = (event: DragEvent, targetPath: string) => {
    if (!drag.value || !canDropOn(targetPath)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    hoverTarget.value = targetPath
  }

  const onDropLeave = (targetPath: string) => {
    if (hoverTarget.value === targetPath) hoverTarget.value = null
  }

  const takeDropPayload = (event: DragEvent, targetPath: string): TPayload | null => {
    if (!toValue(options.canDrag)) return null

    event.preventDefault()
    event.stopPropagation()

    const payload = drag.value
    if (!payload || !canDropPayloadOn(payload, targetPath)) {
      clearDrag()
      return null
    }

    clearDrag()
    return payload
  }

  return {
    drag,
    hoverTarget,
    startDrag,
    canDropPayloadOn,
    canDropOn,
    onDragEnd,
    onDropEnter,
    onDropOver,
    onDropLeave,
    takeDropPayload,
    clearDrag,
  }
}
