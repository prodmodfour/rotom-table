import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLivePlayHazardBrushBatcher } from '~/composables/map-editor/useLivePlayHazardBrushBatcher'
import type { EditHazardsPayload } from '#shared/livePlayBatchCommands'
import type { PlaceHazardPayload, RemoveHazardPayload } from '#shared/livePlayCommands'
import type { MapHazardKind } from '~/types/map'

const hazard = (x: number, kind: 'spikes' | 'fire' | 'toxic-spikes' = 'spikes') => ({
  kind,
  x,
  y: 0,
  z: 0,
})

const dispatched = { dispatched: true }

describe('useLivePlayHazardBrushBatcher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces rapid hazard edits into one debounced editHazards command', async () => {
    vi.useFakeTimers()
    const dispatchEditHazards = vi.fn<(
      payload: EditHazardsPayload,
    ) => Promise<{ dispatched: boolean }>>().mockResolvedValue(dispatched)
    const dispatchPlaceHazard = vi.fn<(
      payload: PlaceHazardPayload,
    ) => Promise<{ dispatched: boolean }>>().mockResolvedValue(dispatched)
    const dispatchRemoveHazard = vi.fn<(
      payload: RemoveHazardPayload,
    ) => Promise<{ dispatched: boolean }>>().mockResolvedValue(dispatched)
    const batcher = useLivePlayHazardBrushBatcher({
      dispatchEditHazards,
      dispatchPlaceHazard,
      dispatchRemoveHazard,
      debounceMs: 25,
    })

    batcher.queueUpsert(hazard(0))
    batcher.queueRemove({ x: 1, y: 0, z: 0, kind: 'fire' })

    expect(batcher.pendingOperationCount.value).toBe(2)
    expect(dispatchEditHazards).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(24)
    expect(dispatchEditHazards).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(dispatchEditHazards).toHaveBeenCalledTimes(1)
    expect(dispatchEditHazards).toHaveBeenCalledWith({
      operations: [
        { action: 'upsert', hazard: hazard(0) },
        { action: 'remove', cell: { x: 1, y: 0, z: 0, kind: 'fire' } },
      ],
    })
    expect(dispatchPlaceHazard).not.toHaveBeenCalled()
    expect(dispatchRemoveHazard).not.toHaveBeenCalled()
    expect(batcher.pendingOperationCount.value).toBe(0)
  })

  it('preserves existing single-cell place and remove commands for solitary direct clicks', async () => {
    const dispatchEditHazards = vi.fn<(
      payload: EditHazardsPayload,
    ) => Promise<{ dispatched: boolean }>>().mockResolvedValue(dispatched)
    const dispatchPlaceHazard = vi.fn<(
      payload: PlaceHazardPayload,
    ) => Promise<{ dispatched: boolean }>>().mockResolvedValue(dispatched)
    const dispatchRemoveHazard = vi.fn<(
      payload: RemoveHazardPayload,
    ) => Promise<{ dispatched: boolean }>>().mockResolvedValue(dispatched)
    const batcher = useLivePlayHazardBrushBatcher({
      dispatchEditHazards,
      dispatchPlaceHazard,
      dispatchRemoveHazard,
      debounceMs: 100,
    })

    batcher.queueUpsert(hazard(0, 'toxic-spikes'))
    await batcher.flush()
    batcher.queueRemove({ x: 1, y: 0, z: 0, kind: 'fire' })
    await batcher.flush()

    expect(dispatchEditHazards).not.toHaveBeenCalled()
    expect(dispatchPlaceHazard).toHaveBeenCalledTimes(1)
    expect(dispatchPlaceHazard).toHaveBeenCalledWith({ hazard: hazard(0, 'toxic-spikes') })
    expect(dispatchRemoveHazard).toHaveBeenCalledTimes(1)
    expect(dispatchRemoveHazard).toHaveBeenCalledWith({ cell: { x: 1, y: 0, z: 0, kind: 'fire' } })
  })

  it('keeps the last edit for a cell so contradictory brush gestures validate as one final operation', async () => {
    const dispatchEditHazards = vi.fn<(
      payload: EditHazardsPayload,
    ) => Promise<{ dispatched: boolean }>>().mockResolvedValue(dispatched)
    const batcher = useLivePlayHazardBrushBatcher({
      dispatchEditHazards,
      dispatchPlaceHazard: vi.fn().mockResolvedValue(dispatched),
      dispatchRemoveHazard: vi.fn().mockResolvedValue(dispatched),
      debounceMs: 100,
    })

    batcher.queueUpsert(hazard(0, 'spikes'))
    batcher.queueRemove({ x: 0, y: 0, z: 0 })
    batcher.queueUpsert(hazard(0, 'fire'))
    batcher.queueUpsert(hazard(1, 'spikes'))
    await batcher.flush()

    expect(dispatchEditHazards).toHaveBeenCalledTimes(1)
    expect(dispatchEditHazards).toHaveBeenCalledWith({
      operations: [
        { action: 'upsert', hazard: hazard(0, 'fire') },
        { action: 'upsert', hazard: hazard(1, 'spikes') },
      ],
    })
  })

  it('splits very large strokes into bounded sequential editHazards chunks', async () => {
    const dispatchEditHazards = vi.fn<(
      payload: EditHazardsPayload,
    ) => Promise<{ dispatched: boolean }>>().mockResolvedValue(dispatched)
    const batcher = useLivePlayHazardBrushBatcher({
      dispatchEditHazards,
      dispatchPlaceHazard: vi.fn().mockResolvedValue(dispatched),
      dispatchRemoveHazard: vi.fn().mockResolvedValue(dispatched),
      debounceMs: 100,
      maxOperationsPerCommand: 2,
    })

    batcher.queueUpsert(hazard(0))
    batcher.queueUpsert(hazard(1))
    batcher.queueRemove({ x: 2, y: 0, z: 0 })
    batcher.queueUpsert(hazard(3, 'fire'))
    batcher.queueUpsert(hazard(4))

    await batcher.flush()

    expect(dispatchEditHazards).toHaveBeenCalledTimes(3)
    expect(dispatchEditHazards.mock.calls.map(([payload]) => payload.operations)).toEqual([
      [
        { action: 'upsert', hazard: hazard(0) },
        { action: 'upsert', hazard: hazard(1) },
      ],
      [
        { action: 'remove', cell: { x: 2, y: 0, z: 0 } },
        { action: 'upsert', hazard: hazard(3, 'fire') },
      ],
      [
        { action: 'upsert', hazard: hazard(4) },
      ],
    ])
  })

  it('stops sending split chunks after a rejected or uncertain hazard batch', async () => {
    const dispatchEditHazards = vi.fn<(
      payload: EditHazardsPayload,
    ) => Promise<{ dispatched: boolean; uncertain?: boolean }>>()
      .mockResolvedValueOnce({ dispatched: false })
      .mockResolvedValue(dispatched)
    const batcher = useLivePlayHazardBrushBatcher({
      dispatchEditHazards,
      dispatchPlaceHazard: vi.fn().mockResolvedValue(dispatched),
      dispatchRemoveHazard: vi.fn().mockResolvedValue(dispatched),
      debounceMs: 100,
      maxOperationsPerCommand: 1,
    })

    batcher.queueUpsert(hazard(0))
    batcher.queueUpsert(hazard(1))
    const results = await batcher.flush()

    expect(results).toEqual([{ dispatched: false }])
    expect(dispatchEditHazards).toHaveBeenCalledTimes(1)
  })

  it('clones queued payloads so caller-side mutations cannot change the durable command body', async () => {
    const dispatchEditHazards = vi.fn<(
      payload: EditHazardsPayload,
    ) => Promise<{ dispatched: boolean }>>().mockResolvedValue(dispatched)
    const batcher = useLivePlayHazardBrushBatcher({
      dispatchEditHazards,
      dispatchPlaceHazard: vi.fn().mockResolvedValue(dispatched),
      dispatchRemoveHazard: vi.fn().mockResolvedValue(dispatched),
      debounceMs: 100,
    })
    const mutableHazard = { ...hazard(0), owner: 'ally' }
    const mutableCell: { x: number; y: number; z: number; kind: MapHazardKind } = { x: 1, y: 0, z: 0, kind: 'fire' }

    batcher.queueUpsert(mutableHazard)
    batcher.queueRemove(mutableCell)
    mutableHazard.kind = 'fire'
    mutableHazard.owner = 'mutated'
    mutableCell.kind = 'spikes'
    await batcher.flush()

    expect(dispatchEditHazards).toHaveBeenCalledWith({
      operations: [
        { action: 'upsert', hazard: { ...hazard(0), owner: 'ally' } },
        { action: 'remove', cell: { x: 1, y: 0, z: 0, kind: 'fire' } },
      ],
    })
  })
})
