import { describe, expect, it } from 'vitest'
import { createPointerInteractionMetricsSampler } from '~/utils/isometric/pointerMetricsSampler'

describe('pointer interaction metrics sampler', () => {
  it('aggregates pointermove, raycast, and pathfinding counts', () => {
    const sampler = createPointerInteractionMetricsSampler()

    sampler.recordPointerMoveEvent()
    sampler.recordPointerMoveEvent(2)
    sampler.recordPointerMoveFrame({ coalescedEventCount: 3 })
    sampler.recordRaycast('token-pick')
    sampler.recordRaycast('movement-plane', 2)
    sampler.recordPathfindingRequest()

    expect(sampler.snapshot()).toEqual({
      pointerMoveEventCount: 3,
      pointerMoveFrameCount: 1,
      coalescedPointerMoveEventCount: 3,
      lastPointerMoveFrameCoalescedEventCount: 3,
      raycastCount: 3,
      raycastCounts: {
        'token-pick': 1,
        'movement-plane': 2,
      },
      pathfindingRequestCount: 1,
    })
  })

  it('returns defensive snapshots and resets without sharing count maps', () => {
    const sampler = createPointerInteractionMetricsSampler()
    const afterRaycast = sampler.recordRaycast('build-pick')
    afterRaycast.raycastCounts['build-pick'] = 99

    expect(sampler.snapshot().raycastCounts['build-pick']).toBe(1)

    const reset = sampler.reset()
    expect(reset).toEqual({
      pointerMoveEventCount: 0,
      pointerMoveFrameCount: 0,
      coalescedPointerMoveEventCount: 0,
      lastPointerMoveFrameCoalescedEventCount: null,
      raycastCount: 0,
      raycastCounts: {},
      pathfindingRequestCount: 0,
    })
    expect(reset.raycastCounts).not.toBe(sampler.snapshot().raycastCounts)
  })

  it('sanitizes non-finite or negative increments', () => {
    const sampler = createPointerInteractionMetricsSampler()

    sampler.recordPointerMoveEvent(Number.POSITIVE_INFINITY)
    sampler.recordPointerMoveEvent(-1)
    sampler.recordPointerMoveFrame({ coalescedEventCount: Number.NaN })
    sampler.recordRaycast('hazard-pick', -4)
    sampler.recordPathfindingRequest(Number.NaN)

    expect(sampler.snapshot()).toEqual({
      pointerMoveEventCount: 0,
      pointerMoveFrameCount: 1,
      coalescedPointerMoveEventCount: 0,
      lastPointerMoveFrameCoalescedEventCount: 0,
      raycastCount: 0,
      raycastCounts: {
        'hazard-pick': 0,
      },
      pathfindingRequestCount: 0,
    })
  })
})
