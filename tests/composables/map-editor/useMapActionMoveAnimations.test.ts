import { describe, expect, it, vi } from 'vitest'
import {
  actorPlacementIdForMoveAnimationBatch,
  useMapActionMoveAnimations,
} from '~/composables/map-editor/useMapActionMoveAnimations'
import type { MoveAnimationEvent } from '~/types/moveAnimation'

const moveAnimationEvent = (overrides: Partial<MoveAnimationEvent> = {}): MoveAnimationEvent => ({
  id: 'vfx-1',
  kind: 'projectile',
  moveName: 'Thunderbolt',
  userId: 'actor-1',
  targetId: 'target-1',
  createdAtMs: 1_000,
  durationMs: 600,
  ...overrides,
} as MoveAnimationEvent)

describe('useMapActionMoveAnimations', () => {
  it('enqueues locally before publishing the same planned VFX batch', async () => {
    const order: string[] = []
    const events = [moveAnimationEvent()]
    const enqueueLocalMoveAnimations = vi.fn(async () => {
      order.push('local-start')
      await Promise.resolve()
      order.push('local-done')
      return { ok: true }
    })
    const publishMoveAnimations = vi.fn(() => {
      order.push('publish')
    })

    const { enqueueAndBroadcastMoveAnimations } = useMapActionMoveAnimations({
      enqueueLocalMoveAnimations,
      publishMoveAnimations,
    })

    await enqueueAndBroadcastMoveAnimations(events)

    expect(enqueueLocalMoveAnimations).toHaveBeenCalledWith(events)
    expect(publishMoveAnimations).toHaveBeenCalledWith({
      actorPlacementId: 'actor-1',
      events,
    })
    expect(order).toEqual(['local-start', 'local-done', 'publish'])
  })

  it('replays remote batches through the local queue without republishing', () => {
    const events = [moveAnimationEvent({ id: 'remote-vfx-1', createdAtMs: 5_000 })]
    const enqueueLocalMoveAnimations = vi.fn()
    const publishMoveAnimations = vi.fn()

    const { replayMoveAnimations } = useMapActionMoveAnimations({
      enqueueLocalMoveAnimations,
      publishMoveAnimations,
    })

    replayMoveAnimations(events)

    expect(enqueueLocalMoveAnimations).toHaveBeenCalledWith(events)
    expect(publishMoveAnimations).not.toHaveBeenCalled()
  })

  it('keeps empty batches local-only because there is no actor placement to authorize', () => {
    const enqueueLocalMoveAnimations = vi.fn()
    const publishMoveAnimations = vi.fn()

    const { enqueueAndBroadcastMoveAnimations } = useMapActionMoveAnimations({
      enqueueLocalMoveAnimations,
      publishMoveAnimations,
    })

    enqueueAndBroadcastMoveAnimations([])

    expect(enqueueLocalMoveAnimations).toHaveBeenCalledWith([])
    expect(publishMoveAnimations).not.toHaveBeenCalled()
  })
})

describe('actorPlacementIdForMoveAnimationBatch', () => {
  it('uses the first non-empty move animation user id as the actor placement id', () => {
    expect(actorPlacementIdForMoveAnimationBatch([
      moveAnimationEvent({ id: 'blank-user', userId: '   ' }),
      moveAnimationEvent({ id: 'actor-vfx', userId: ' actor-2 ' }),
    ])).toBe('actor-2')
  })
})
