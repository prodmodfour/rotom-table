import { describe, expect, it } from 'vitest'
import { MOVE_VFX_KIND, type MoveAnimationEvent } from '~/types/moveAnimation'
import {
  MOVE_ANIMATION_TARGET_SEQUENCE_ORDER,
  applyMoveAnimationTargetStartOffsets,
  createMoveAnimationTargetStartOffsets,
  hasMoveAnimationEventStarted,
  moveAnimationEventProgress,
  moveAnimationEventStartMs,
} from '~/utils/moveAnimationSequencing'

const targetFlashEvent = (
  overrides: Record<string, unknown> = {},
): MoveAnimationEvent => ({
  id: 'target-flash',
  moveName: 'Test Move',
  userId: 'user-token',
  createdAtMs: 100,
  durationMs: 240,
  kind: MOVE_VFX_KIND.targetFlash,
  targetId: 'target-a',
  ...overrides,
} as MoveAnimationEvent)

describe('move animation sequencing helpers', () => {
  it('preserves target order while capping total stagger duration', () => {
    const offsets = createMoveAnimationTargetStartOffsets([
      { targetId: 'target-a' },
      { targetId: 'target-b' },
      { targetId: 'target-c' },
      { targetId: 'target-d' },
      { targetId: 'target-e' },
    ], {
      stepMs: 100,
      maxTotalStaggerMs: 200,
    })

    expect(offsets.map((offset) => offset.targetId)).toEqual([
      'target-a',
      'target-b',
      'target-c',
      'target-d',
      'target-e',
    ])
    expect(offsets.map((offset) => offset.startOffsetMs)).toEqual([0, 50, 100, 150, 200])
  })

  it('can order targets by stable id for deterministic simultaneous batches', () => {
    const offsets = createMoveAnimationTargetStartOffsets([
      { targetId: 'target-b' },
      { targetId: 'target-a' },
      { targetId: 'target-c' },
    ], {
      order: MOVE_ANIMATION_TARGET_SEQUENCE_ORDER.stableId,
      baseOffsetMs: 40,
      stepMs: 30,
    })

    expect(offsets).toEqual([
      { targetId: 'target-a', order: 0, startOffsetMs: 40 },
      { targetId: 'target-b', order: 1, startOffsetMs: 70 },
      { targetId: 'target-c', order: 2, startOffsetMs: 100 },
    ])
  })

  it('can order target effects by distance from the user with stable tie-breaking', () => {
    const offsets = createMoveAnimationTargetStartOffsets([
      { targetId: 'far', position: { x: 5, y: 0, z: 0 } },
      { targetId: 'tie-b', position: { x: 0, y: 0, z: 2 } },
      { targetId: 'near', position: { x: 1, y: 0, z: 0 } },
      { targetId: 'missing-position' },
      { targetId: 'tie-a', position: { x: 2, y: 0, z: 0 } },
    ], {
      order: MOVE_ANIMATION_TARGET_SEQUENCE_ORDER.distanceFromOrigin,
      origin: { x: 0, y: 0, z: 0 },
      stepMs: 25,
    })

    expect(offsets.map((offset) => offset.targetId)).toEqual([
      'near',
      'tie-a',
      'tie-b',
      'far',
      'missing-position',
    ])
    expect(offsets.map((offset) => offset.startOffsetMs)).toEqual([0, 25, 50, 75, 100])
  })

  it('applies target start offsets without mutating non-target events or replacing existing delays by default', () => {
    const targetA = targetFlashEvent({ id: 'target-a-flash', targetId: 'target-a' })
    const targetB = targetFlashEvent({ id: 'target-b-flash', targetId: 'target-b', startOffsetMs: 25 })
    const selfPulse = targetFlashEvent({ id: 'self-pulse', kind: MOVE_VFX_KIND.selfPulse, targetId: undefined })

    const sequenced = applyMoveAnimationTargetStartOffsets([
      targetA,
      targetB,
      selfPulse,
    ], [
      { targetId: 'target-a', order: 0, startOffsetMs: 40 },
      { targetId: 'target-b', order: 1, startOffsetMs: 80 },
    ])

    expect(sequenced[0]).toEqual({ ...targetA, startOffsetMs: 40 })
    expect(sequenced[1]).toEqual({ ...targetB, startOffsetMs: 105 })
    expect(sequenced[2]).toBe(selfPulse)
  })

  it('computes progress from createdAt plus startOffsetMs for delayed renderer events', () => {
    const event = targetFlashEvent({ startOffsetMs: 150, durationMs: 50 })

    expect(moveAnimationEventStartMs(event)).toBe(250)
    expect(hasMoveAnimationEventStarted(event, 249)).toBe(false)
    expect(moveAnimationEventProgress(event, 249)).toMatchObject({ progress: 0, complete: false })
    expect(hasMoveAnimationEventStarted(event, 250)).toBe(true)
    expect(moveAnimationEventProgress(event, 250)).toMatchObject({ progress: 0, complete: false })
    expect(moveAnimationEventProgress(event, 275)).toMatchObject({ progress: 0.5, complete: false })
    expect(moveAnimationEventProgress(event, 300)).toMatchObject({ progress: 1, complete: true })
  })
})
