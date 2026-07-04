import { getCurrentScope, onScopeDispose, ref } from 'vue'
import {
  LIVE_PLAY_BATCH_MAX_TERRAIN_VOXELS,
  type EditTerrainVoxelOperation,
  type EditTerrainVoxelsPayload,
} from '#shared/livePlayBatchCommands'
import type { MapVoxelV2 } from '~/types/map'

export interface LivePlayTerrainBrushDispatchResult {
  readonly dispatched: boolean
  readonly message?: string
  readonly uncertain?: boolean
}

export interface LivePlayTerrainBrushBatcherOptions {
  readonly dispatchEditTerrainVoxels: (payload: EditTerrainVoxelsPayload) => Promise<LivePlayTerrainBrushDispatchResult>
  readonly debounceMs?: number
  readonly maxOperationsPerCommand?: number
}

interface QueuedTerrainOperation {
  readonly order: number
  readonly operation: EditTerrainVoxelOperation
}

const DEFAULT_TERRAIN_BRUSH_DEBOUNCE_MS = 75

const terrainCellKey = (cell: { readonly x: number; readonly y: number; readonly z: number }): string => (
  `${cell.x},${cell.y},${cell.z}`
)

const terrainOperationCell = (operation: EditTerrainVoxelOperation): { readonly x: number; readonly y: number; readonly z: number } => (
  operation.action === 'upsert' ? operation.voxel : operation.cell
)

const cloneTerrainVoxel = (voxel: MapVoxelV2): MapVoxelV2 => ({
  x: voxel.x,
  y: voxel.y,
  z: voxel.z,
  materialId: voxel.materialId,
  ...(voxel.color === undefined ? {} : { color: voxel.color }),
  ...(voxel.ghost === undefined ? {} : { ghost: voxel.ghost }),
  ...(voxel.blocksMovement === undefined ? {} : { blocksMovement: voxel.blocksMovement }),
  ...(voxel.blocksSight === undefined ? {} : { blocksSight: voxel.blocksSight }),
  ...(voxel.tags === undefined ? {} : { tags: [...voxel.tags] }),
})

const cloneTerrainCell = (cell: { readonly x: number; readonly y: number; readonly z: number }) => ({
  x: cell.x,
  y: cell.y,
  z: cell.z,
})

const cloneTerrainOperation = (operation: EditTerrainVoxelOperation): EditTerrainVoxelOperation => (
  operation.action === 'upsert'
    ? { action: 'upsert', voxel: cloneTerrainVoxel(operation.voxel) }
    : { action: 'remove', cell: cloneTerrainCell(operation.cell) }
)

const normalizedMaxOperationsPerCommand = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return LIVE_PLAY_BATCH_MAX_TERRAIN_VOXELS
  return Math.min(
    LIVE_PLAY_BATCH_MAX_TERRAIN_VOXELS,
    Math.max(1, Math.floor(value)),
  )
}

const chunkTerrainOperations = (
  operations: readonly EditTerrainVoxelOperation[],
  maxOperationsPerCommand: number,
): EditTerrainVoxelOperation[][] => {
  const chunks: EditTerrainVoxelOperation[][] = []
  for (let index = 0; index < operations.length; index += maxOperationsPerCommand) {
    chunks.push(operations.slice(index, index + maxOperationsPerCommand))
  }
  return chunks
}

const shouldContinueAfterDispatch = (result: LivePlayTerrainBrushDispatchResult): boolean => (
  result.dispatched && result.uncertain !== true
)

/**
 * Coalesces live-play terrain brush edits into bounded editTerrainVoxels requests.
 *
 * The batcher intentionally does not mutate local terrain; accepted patches from the
 * authoritative command pipeline remain responsible for changing map state.
 */
export const useLivePlayTerrainBrushBatcher = ({
  dispatchEditTerrainVoxels,
  debounceMs = DEFAULT_TERRAIN_BRUSH_DEBOUNCE_MS,
  maxOperationsPerCommand: maxOperationsPerCommandOption,
}: LivePlayTerrainBrushBatcherOptions) => {
  const pendingOperationCount = ref(0)
  const queuedOperations = new Map<string, QueuedTerrainOperation>()
  const maxOperationsPerCommand = normalizedMaxOperationsPerCommand(maxOperationsPerCommandOption)
  const normalizedDebounceMs = Number.isFinite(debounceMs) ? Math.max(0, Math.floor(debounceMs)) : DEFAULT_TERRAIN_BRUSH_DEBOUNCE_MS
  let nextOperationOrder = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let activeFlush: Promise<readonly LivePlayTerrainBrushDispatchResult[]> | null = null

  const syncPendingOperationCount = (): void => {
    pendingOperationCount.value = queuedOperations.size
  }

  const clearScheduledFlush = (): void => {
    if (flushTimer === null) return
    clearTimeout(flushTimer)
    flushTimer = null
  }

  const drainQueuedOperations = (): EditTerrainVoxelOperation[] => {
    const operations = Array.from(queuedOperations.values())
      .sort((left, right) => left.order - right.order)
      .map(({ operation }) => cloneTerrainOperation(operation))
    queuedOperations.clear()
    syncPendingOperationCount()
    return operations
  }

  const dispatchOperations = async (
    operations: readonly EditTerrainVoxelOperation[],
  ): Promise<readonly LivePlayTerrainBrushDispatchResult[]> => {
    const results: LivePlayTerrainBrushDispatchResult[] = []
    for (const chunk of chunkTerrainOperations(operations, maxOperationsPerCommand)) {
      const result = await dispatchEditTerrainVoxels({ operations: chunk })
      results.push(result)
      if (!shouldContinueAfterDispatch(result)) break
    }
    return results
  }

  const flush = async (): Promise<readonly LivePlayTerrainBrushDispatchResult[]> => {
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

  const queueOperation = (operation: EditTerrainVoxelOperation): void => {
    const key = terrainCellKey(terrainOperationCell(operation))
    const existing = queuedOperations.get(key)
    queuedOperations.set(key, {
      order: existing?.order ?? nextOperationOrder,
      operation: cloneTerrainOperation(operation),
    })
    if (!existing) nextOperationOrder += 1
    syncPendingOperationCount()
    scheduleFlush()
  }

  const queueUpsert = (voxel: MapVoxelV2): void => {
    queueOperation({ action: 'upsert', voxel })
  }

  const queueRemove = (cell: { readonly x: number; readonly y: number; readonly z: number }): void => {
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
