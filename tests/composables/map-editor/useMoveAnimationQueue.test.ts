import { describe, expect, it } from 'vitest'
import { MOVE_ANIMATION_DUPLICATE_POLICY } from '~/composables/map-editor/moveAnimationQueuePolicy'
import {
  useMoveAnimationQueue,
  type MoveAnimationQueueInput,
} from '~/composables/map-editor/useMoveAnimationQueue'
import { MOVE_VFX_KIND } from '~/types/moveAnimation'

const createInput = (
  overrides: Partial<MoveAnimationQueueInput> = {},
): MoveAnimationQueueInput => ({
  moveName: 'Test Move',
  userId: 'user-token',
  durationMs: 560,
  kind: MOVE_VFX_KIND.selfPulse,
  ...overrides,
} as MoveAnimationQueueInput)

describe('useMoveAnimationQueue', () => {
  it('enqueues a transient animation with queue-owned id and created timestamp defaults', () => {
    const queue = useMoveAnimationQueue({
      prefix: 'Map One',
      initialSequence: 4,
      now: () => 1234,
    })

    const result = queue.enqueueMoveAnimation(createInput())

    expect(result.action).toBe('added')
    expect(queue.activeMoveAnimations.value).toEqual([
      {
        id: 'map-one-000004',
        moveName: 'Test Move',
        userId: 'user-token',
        createdAtMs: 1234,
        durationMs: 560,
        kind: MOVE_VFX_KIND.selfPulse,
      },
    ])
  })

  it('keeps queue instances independent so map pages do not share global state', () => {
    const firstQueue = useMoveAnimationQueue({ now: () => 1000 })
    const secondQueue = useMoveAnimationQueue({ now: () => 2000 })

    firstQueue.enqueueMoveAnimation(createInput({ moveName: 'First Queue Move' }))
    secondQueue.enqueueMoveAnimation(createInput({ moveName: 'Second Queue Move' }))
    firstQueue.enqueueMoveAnimation(createInput({ moveName: 'First Queue Follow-Up' }))

    expect(firstQueue.activeMoveAnimations.value.map((event) => event.id)).toEqual([
      'move-vfx-000001',
      'move-vfx-000002',
    ])
    expect(secondQueue.activeMoveAnimations.value.map((event) => event.id)).toEqual([
      'move-vfx-000001',
    ])
    expect(secondQueue.activeMoveAnimations.value[0]?.createdAtMs).toBe(2000)
  })

  it('enqueues batches in order while preserving caller-provided stable ids', () => {
    const queue = useMoveAnimationQueue({ now: () => 1000 })

    const result = queue.enqueueMoveAnimations([
      createInput({ id: 'stable-launch', kind: MOVE_VFX_KIND.projectile, targetId: 'target-a' }),
      createInput({ kind: MOVE_VFX_KIND.targetFlash, targetId: 'target-a' }),
    ])

    expect(result.results.map(({ action }) => action)).toEqual(['added', 'added'])
    expect(queue.activeMoveAnimations.value.map((event) => event.id)).toEqual([
      'stable-launch',
      'move-vfx-000001',
    ])
    expect(queue.activeMoveAnimations.value.map((event) => event.kind)).toEqual([
      MOVE_VFX_KIND.projectile,
      MOVE_VFX_KIND.targetFlash,
    ])
  })

  it('uses duplicate-id ignore by default and replacement only when explicitly requested', () => {
    const queue = useMoveAnimationQueue({ now: () => 1000 })
    const original = createInput({ id: 'stable-resolution', moveName: 'Original Pulse' })
    const duplicate = createInput({ id: 'stable-resolution', moveName: 'Duplicate Pulse' })
    const replacement = createInput({ id: 'stable-resolution', moveName: 'Replacement Pulse' })

    expect(queue.enqueueMoveAnimation(original).action).toBe('added')
    expect(queue.enqueueMoveAnimation(duplicate).action).toBe('ignored-duplicate')
    expect(queue.activeMoveAnimations.value).toEqual([
      expect.objectContaining({ moveName: 'Original Pulse' }),
    ])

    expect(queue.enqueueMoveAnimation(replacement, {
      duplicatePolicy: MOVE_ANIMATION_DUPLICATE_POLICY.replace,
    }).action).toBe('replaced')
    expect(queue.activeMoveAnimations.value).toEqual([
      expect.objectContaining({ moveName: 'Replacement Pulse' }),
    ])
  })

  it('removes individual events and clears the queue without touching persistence', () => {
    const queue = useMoveAnimationQueue({ now: () => 1000 })

    queue.enqueueMoveAnimations([
      createInput({ id: 'launch' }),
      createInput({ id: 'impact' }),
    ])

    expect(queue.removeMoveAnimation('missing')).toBe(false)
    expect(queue.removeMoveAnimation('launch')).toBe(true)
    expect(queue.activeMoveAnimations.value.map((event) => event.id)).toEqual(['impact'])

    const removed = queue.clearMoveAnimations()

    expect(removed.map((event) => event.id)).toEqual(['impact'])
    expect(queue.activeMoveAnimations.value).toEqual([])
  })

  it('prunes expired events with injected time and opportunistically before enqueueing', () => {
    let nowMs = 1000
    const queue = useMoveAnimationQueue({ now: () => nowMs })

    queue.enqueueMoveAnimation(createInput({ id: 'quick', durationMs: 100 }))
    queue.enqueueMoveAnimation(createInput({ id: 'linger', durationMs: 500 }))

    nowMs = 1200
    const pruned = queue.pruneExpiredMoveAnimations()

    expect(pruned.removedEvents.map((event) => event.id)).toEqual(['quick'])
    expect(pruned.activeEvents.map((event) => event.id)).toEqual(['linger'])

    nowMs = 1600
    queue.enqueueMoveAnimation(createInput({ id: 'new-pulse' }))

    expect(queue.activeMoveAnimations.value.map((event) => event.id)).toEqual(['new-pulse'])
  })
})
