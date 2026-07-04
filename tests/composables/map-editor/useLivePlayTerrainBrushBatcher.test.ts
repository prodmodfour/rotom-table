import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLivePlayTerrainBrushBatcher } from '~/composables/map-editor/useLivePlayTerrainBrushBatcher'
import type { EditTerrainVoxelsPayload } from '#shared/livePlayBatchCommands'

const upsert = (x: number, materialId = 'meadow_grass') => ({
  x,
  y: 0,
  z: 0,
  materialId,
})

const dispatched = { dispatched: true }

describe('useLivePlayTerrainBrushBatcher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces rapid terrain edits into one debounced editTerrainVoxels command', async () => {
    vi.useFakeTimers()
    const dispatchEditTerrainVoxels = vi.fn<(
      payload: EditTerrainVoxelsPayload,
    ) => Promise<{ dispatched: boolean }>>().mockResolvedValue(dispatched)
    const batcher = useLivePlayTerrainBrushBatcher({
      dispatchEditTerrainVoxels,
      debounceMs: 25,
    })

    batcher.queueUpsert(upsert(0))
    batcher.queueUpsert(upsert(1, 'stone'))

    expect(batcher.pendingOperationCount.value).toBe(2)
    expect(dispatchEditTerrainVoxels).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(24)
    expect(dispatchEditTerrainVoxels).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(dispatchEditTerrainVoxels).toHaveBeenCalledTimes(1)
    expect(dispatchEditTerrainVoxels).toHaveBeenCalledWith({
      operations: [
        { action: 'upsert', voxel: upsert(0) },
        { action: 'upsert', voxel: upsert(1, 'stone') },
      ],
    })
    expect(batcher.pendingOperationCount.value).toBe(0)
  })

  it('keeps the last edit for a cell so contradictory brush gestures validate as one final operation', async () => {
    const dispatchEditTerrainVoxels = vi.fn<(
      payload: EditTerrainVoxelsPayload,
    ) => Promise<{ dispatched: boolean }>>().mockResolvedValue(dispatched)
    const batcher = useLivePlayTerrainBrushBatcher({
      dispatchEditTerrainVoxels,
      debounceMs: 100,
    })

    batcher.queueUpsert(upsert(0, 'meadow_grass'))
    batcher.queueRemove({ x: 0, y: 0, z: 0 })
    batcher.queueUpsert(upsert(0, 'stone'))
    await batcher.flush()

    expect(dispatchEditTerrainVoxels).toHaveBeenCalledTimes(1)
    expect(dispatchEditTerrainVoxels).toHaveBeenCalledWith({
      operations: [{ action: 'upsert', voxel: upsert(0, 'stone') }],
    })
  })

  it('splits very large strokes into bounded sequential chunks', async () => {
    const dispatchEditTerrainVoxels = vi.fn<(
      payload: EditTerrainVoxelsPayload,
    ) => Promise<{ dispatched: boolean }>>().mockResolvedValue(dispatched)
    const batcher = useLivePlayTerrainBrushBatcher({
      dispatchEditTerrainVoxels,
      debounceMs: 100,
      maxOperationsPerCommand: 2,
    })

    batcher.queueUpsert(upsert(0))
    batcher.queueUpsert(upsert(1))
    batcher.queueRemove({ x: 2, y: 0, z: 0 })
    batcher.queueUpsert(upsert(3))
    batcher.queueUpsert(upsert(4))

    await batcher.flush()

    expect(dispatchEditTerrainVoxels).toHaveBeenCalledTimes(3)
    expect(dispatchEditTerrainVoxels.mock.calls.map(([payload]) => payload.operations)).toEqual([
      [
        { action: 'upsert', voxel: upsert(0) },
        { action: 'upsert', voxel: upsert(1) },
      ],
      [
        { action: 'remove', cell: { x: 2, y: 0, z: 0 } },
        { action: 'upsert', voxel: upsert(3) },
      ],
      [
        { action: 'upsert', voxel: upsert(4) },
      ],
    ])
  })

  it('stops sending split chunks after a rejected or uncertain terrain batch', async () => {
    const dispatchEditTerrainVoxels = vi.fn<(
      payload: EditTerrainVoxelsPayload,
    ) => Promise<{ dispatched: boolean; uncertain?: boolean }>>()
      .mockResolvedValueOnce({ dispatched: false })
      .mockResolvedValue(dispatched)
    const batcher = useLivePlayTerrainBrushBatcher({
      dispatchEditTerrainVoxels,
      debounceMs: 100,
      maxOperationsPerCommand: 1,
    })

    batcher.queueUpsert(upsert(0))
    batcher.queueUpsert(upsert(1))
    const results = await batcher.flush()

    expect(results).toEqual([{ dispatched: false }])
    expect(dispatchEditTerrainVoxels).toHaveBeenCalledTimes(1)
  })

  it('clones queued payloads so caller-side mutations cannot change the durable command body', async () => {
    const dispatchEditTerrainVoxels = vi.fn<(
      payload: EditTerrainVoxelsPayload,
    ) => Promise<{ dispatched: boolean }>>().mockResolvedValue(dispatched)
    const batcher = useLivePlayTerrainBrushBatcher({
      dispatchEditTerrainVoxels,
      debounceMs: 100,
    })
    const voxel = { ...upsert(0), tags: ['cover'] }

    batcher.queueUpsert(voxel)
    voxel.materialId = 'stone'
    voxel.tags.push('mutated')
    await batcher.flush()

    expect(dispatchEditTerrainVoxels).toHaveBeenCalledWith({
      operations: [{ action: 'upsert', voxel: { ...upsert(0), tags: ['cover'] } }],
    })
  })
})
