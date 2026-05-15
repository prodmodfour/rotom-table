import { ref } from 'vue'

export type SheetMoveDragRow = {
  automatic: boolean
  sheetIndex: number | null
}

type DraggableSheetMoveRow = SheetMoveDragRow & {
  automatic: false
  sheetIndex: number
}

type ReorderMoveRow = (fromIndex: number, toIndex: number) => void

export function useSheetMoveRowDragReorder(reorderMoveRow: ReorderMoveRow) {
  const draggedMoveIndex = ref<number | null>(null)
  const dragOverMoveIndex = ref<number | null>(null)

  const canDragMoveRow = (row: SheetMoveDragRow): row is DraggableSheetMoveRow =>
    !row.automatic && row.sheetIndex != null

  const isDraggingMoveRow = (row: SheetMoveDragRow): boolean =>
    canDragMoveRow(row) && draggedMoveIndex.value === row.sheetIndex

  const isMoveRowDropTarget = (row: SheetMoveDragRow): boolean =>
    canDragMoveRow(row)
    && dragOverMoveIndex.value === row.sheetIndex
    && draggedMoveIndex.value !== row.sheetIndex

  const moveRowDragClass = (row: SheetMoveDragRow): Record<string, boolean> => ({
    'move-row--automatic': row.automatic,
    'move-row--dragging': isDraggingMoveRow(row),
    'move-row--drag-over': isMoveRowDropTarget(row),
  })

  const resetMoveRowDrag = () => {
    draggedMoveIndex.value = null
    dragOverMoveIndex.value = null
  }

  const onMoveRowDragStart = (event: DragEvent, row: SheetMoveDragRow) => {
    if (!canDragMoveRow(row)) {
      event.preventDefault()
      return
    }

    draggedMoveIndex.value = row.sheetIndex
    dragOverMoveIndex.value = null

    const transfer = event.dataTransfer
    if (!transfer) return
    transfer.effectAllowed = 'move'
    transfer.setData('text/plain', String(row.sheetIndex))
  }

  const markMoveRowDropTarget = (event: DragEvent, row: SheetMoveDragRow) => {
    if (!canDragMoveRow(row) || draggedMoveIndex.value == null) return
    if (draggedMoveIndex.value === row.sheetIndex) {
      dragOverMoveIndex.value = null
      return
    }

    event.preventDefault()
    dragOverMoveIndex.value = row.sheetIndex

    const transfer = event.dataTransfer
    if (transfer) transfer.dropEffect = 'move'
  }

  const onMoveRowDrop = (event: DragEvent, row: SheetMoveDragRow) => {
    if (!canDragMoveRow(row) || draggedMoveIndex.value == null) return

    event.preventDefault()
    const fromIndex = draggedMoveIndex.value
    const toIndex = row.sheetIndex
    resetMoveRowDrag()

    if (fromIndex !== toIndex) reorderMoveRow(fromIndex, toIndex)
  }

  const reorderMoveRowByOffset = (row: SheetMoveDragRow, offset: number) => {
    if (!canDragMoveRow(row)) return
    reorderMoveRow(row.sheetIndex, row.sheetIndex + offset)
  }

  return {
    canDragMoveRow,
    moveRowDragClass,
    onMoveRowDragStart,
    onMoveRowDragEnter: markMoveRowDropTarget,
    onMoveRowDragOver: markMoveRowDropTarget,
    onMoveRowDrop,
    onMoveRowDragEnd: resetMoveRowDrag,
    reorderMoveRowByOffset,
  }
}
