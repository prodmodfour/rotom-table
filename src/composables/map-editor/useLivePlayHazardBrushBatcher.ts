import { getCurrentScope, onScopeDispose, ref } from 'vue'
import {
  LIVE_PLAY_BATCH_MAX_HAZARD_CELLS,
  type EditHazardOperation,
  type EditHazardsPayload,
} from '#shared/livePlayBatchCommands'
import type { PlaceHazardPayload, RemoveHazardPayload } from '#shared/livePlayCommands'
import type { MapHazardKind, MapHazardV2 } from '~/types/map'

export interface LivePlayHazardBrushDispatchResult {
  readonly dispatched: boolean
  readonly message?: string
  readonly uncertain?: boolean
}

export interface LivePlayHazardBrushBatcherOptions {
  readonly dispatchEditHazards: (payload: EditHazardsPayload) => Promise<LivePlayHazardBrushDispatchResult>
  readonly dispatchPlaceHazard: (payload: PlaceHazardPayload) => Promise<LivePlayHazardBrushDispatchResult>
  readonly dispatchRemoveHazard: (payload: RemoveHazardPayload) => Promise<LivePlayHazardBrushDispatchResult>
  readonly debounceMs?: number
  readonly maxOperationsPerCommand?: number
}

interface QueuedHazardOperation {
  readonly order: number
  readonly operation: EditHazardOperation
}

const DEFAULT_HAZARD_BRUSH_DEBOUNCE_MS = 75

const hazardCellKey = (cell: { readonly x: number; readonly y: number; readonly z: number }): string => (
  `${cell.x},${cell.y},${cell.z}`
)

const hazardOperationCell = (operation: EditHazardOperation): { readonly x: number; readonly y: number; readonly z: number } => (
  operation.action === 'upsert' ? operation.hazard : operation.cell
)

const cloneHazard = (hazard: MapHazardV2): MapHazardV2 => ({
  kind: hazard.kind,
  x: hazard.x,
  y: hazard.y,
  z: hazard.z,
  ...(hazard.layer === undefined ? {} : { layer: hazard.layer }),
  ...(hazard.owner === undefined ? {} : { owner: hazard.owner }),
})

const cloneHazardCell = (cell: { readonly x: number; readonly y: number; readonly z: number; readonly kind?: MapHazardKind }) => ({
  x: cell.x,
  y: cell.y,
  z: cell.z,
  ...(cell.kind === undefined ? {} : { kind: cell.kind }),
})

const cloneHazardOperation = (operation: EditHazardOperation): EditHazardOperation => (
  operation.action === 'upsert'
    ? { action: 'upsert', hazard: cloneHazard(operation.hazard) }
    : { action: 'remove', cell: cloneHazardCell(operation.cell) }
)

const normalizedMaxOperationsPerCommand = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return LIVE_PLAY_BATCH_MAX_HAZARD_CELLS
  return Math.min(
    LIVE_PLAY_BATCH_MAX_HAZARD_CELLS,
    Math.max(1, Math.floor(value)),
  )
}

const chunkHazardOperations = (
  operations: readonly EditHazardOperation[],
  maxOperationsPerCommand: number,
): EditHazardOperation[][] => {
  const chunks: EditHazardOperation[][] = []
  for (let index = 0; index < operations.length; index += maxOperationsPerCommand) {
    chunks.push(operations.slice(index, index + maxOperationsPerCommand))
  }
  return chunks
}

const shouldContinueAfterDispatch = (result: LivePlayHazardBrushDispatchResult): boolean => (
  result.dispatched && result.uncertain !== true
)

/**
 * Coalesces rapid live-play hazard brush edits into bounded editHazards requests.
 *
 * A solitary click still uses the existing single-cell place/remove command so the
 * brush batch path only takes over once a stroke actually contains multiple cells.
 * The batcher intentionally does not mutate local hazards; accepted patches from
 * the authoritative command pipeline remain responsible for changing map state.
 */
export const useLivePlayHazardBrushBatcher = ({
  dispatchEditHazards,
  dispatchPlaceHazard,
  dispatchRemoveHazard,
  debounceMs = DEFAULT_HAZARD_BRUSH_DEBOUNCE_MS,
  maxOperationsPerCommand: maxOperationsPerCommandOption,
}: LivePlayHazardBrushBatcherOptions) => {
  const pendingOperationCount = ref(0)
  const queuedOperations = new Map<string, QueuedHazardOperation>()
  const maxOperationsPerCommand = normalizedMaxOperationsPerCommand(maxOperationsPerCommandOption)
  const normalizedDebounceMs = Number.isFinite(debounceMs) ? Math.max(0, Math.floor(debounceMs)) : DEFAULT_HAZARD_BRUSH_DEBOUNCE_MS
  let nextOperationOrder = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let activeFlush: Promise<readonly LivePlayHazardBrushDispatchResult[]> | null = null

  const syncPendingOperationCount = (): void => {
    pendingOperationCount.value = queuedOperations.size
  }

  const clearScheduledFlush = (): void => {
    if (flushTimer === null) return
    clearTimeout(flushTimer)
    flushTimer = null
  }

  const drainQueuedOperations = (): EditHazardOperation[] => {
    const operations = Array.from(queuedOperations.values())
      .sort((left, right) => left.order - right.order)
      .map(({ operation }) => cloneHazardOperation(operation))
    queuedOperations.clear()
    syncPendingOperationCount()
    return operations
  }

  const dispatchSingleOperation = async (
    operation: EditHazardOperation,
  ): Promise<LivePlayHazardBrushDispatchResult> => (
    operation.action === 'upsert'
      ? dispatchPlaceHazard({ hazard: cloneHazard(operation.hazard) })
      : dispatchRemoveHazard({ cell: cloneHazardCell(operation.cell) })
  )

  const dispatchBatchedOperations = async (
    operations: readonly EditHazardOperation[],
  ): Promise<readonly LivePlayHazardBrushDispatchResult[]> => {
    const results: LivePlayHazardBrushDispatchResult[] = []
    for (const chunk of chunkHazardOperations(operations, maxOperationsPerCommand)) {
      const result = await dispatchEditHazards({ operations: chunk.map((operation) => cloneHazardOperation(operation)) })
      results.push(result)
      if (!shouldContinueAfterDispatch(result)) break
    }
    return results
  }

  const dispatchOperations = async (
    operations: readonly EditHazardOperation[],
  ): Promise<readonly LivePlayHazardBrushDispatchResult[]> => {
    if (operations.length === 1) return [await dispatchSingleOperation(operations[0]!)]
    return dispatchBatchedOperations(operations)
  }

  const flush = async (): Promise<readonly LivePlayHazardBrushDispatchResult[]> => {
    clearScheduledFlush()

    if (activeFlush) {
      await activeFlush
      if (queuedOperations.size === 0) return []
      return flush()
    }

    if (queuedOperations.size === 0) return []

    const operations = drainQueuedOperations()
    activeFlush = dispatchOperations(operations).finally(() => {
      activeFlush = null
    })
    return activeFlush
  }

  const scheduleFlush = (): void => {
    clearScheduledFlush()
    if (normalizedDebounceMs === 0) {
      void flush()
      return
    }
    flushTimer = setTimeout(() => {
      void flush()
    }, normalizedDebounceMs)
  }

  const queueOperation = (operation: EditHazardOperation): void => {
    const key = hazardCellKey(hazardOperationCell(operation))
    const existing = queuedOperations.get(key)
    queuedOperations.set(key, {
      order: existing?.order ?? nextOperationOrder,
      operation: cloneHazardOperation(operation),
    })
    if (!existing) nextOperationOrder += 1
    syncPendingOperationCount()
    scheduleFlush()
  }

  const queueUpsert = (hazard: MapHazardV2): void => {
    queueOperation({ action: 'upsert', hazard })
  }

  const queueRemove = (cell: { readonly x: number; readonly y: number; readonly z: number; readonly kind?: MapHazardKind }): void => {
    queueOperation({ action: 'remove', cell })
  }

  const dispose = (): void => {
    clearScheduledFlush()
    void flush()
  }

  if (getCurrentScope()) {
    onScopeDispose(dispose)
  }

  return {
    pendingOperationCount,
    queueUpsert,
    queueRemove,
    flush,
    dispose,
  }
}
