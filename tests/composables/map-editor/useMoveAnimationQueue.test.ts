import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { MOVE_ANIMATION_DUPLICATE_POLICY } from '~/composables/map-editor/moveAnimationQueuePolicy'
import {
  createTacticalVfxQueueInput,
  useMoveAnimationQueue,
  type MoveAnimationQueueInput,
} from '~/composables/map-editor/useMoveAnimationQueue'
import { MOVE_VFX_KIND, MOVE_VFX_SOURCE_KIND } from '~/types/moveAnimation'

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

  it('dedupes duplicate ids inside one batch without changing event order', () => {
    const queue = useMoveAnimationQueue({ now: () => 1000 })

    const result = queue.enqueueMoveAnimations([
      createInput({ id: 'same-resolution', moveName: 'Original Pulse' }),
      createInput({ id: 'same-resolution', moveName: 'Duplicate Pulse' }),
      createInput({ id: 'follow-up-resolution', moveName: 'Follow-Up Pulse' }),
    ])

    expect(result.results.map(({ action, index }) => ({ action, index }))).toEqual([
      { action: 'added', index: 0 },
      { action: 'ignored-duplicate', index: 0 },
      { action: 'added', index: 1 },
    ])
    expect(result.results[1]?.existingEvent).toEqual(expect.objectContaining({
      moveName: 'Original Pulse',
    }))
    expect(result.results[1]?.incomingEvent).toEqual(expect.objectContaining({
      moveName: 'Duplicate Pulse',
    }))
    expect(queue.activeMoveAnimations.value.map(({ id, moveName }) => ({ id, moveName }))).toEqual([
      { id: 'same-resolution', moveName: 'Original Pulse' },
      { id: 'follow-up-resolution', moveName: 'Follow-Up Pulse' },
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

  it('honors queue-level duplicate replacement while allowing enqueue overrides', () => {
    const queue = useMoveAnimationQueue({
      now: () => 1000,
      duplicatePolicy: MOVE_ANIMATION_DUPLICATE_POLICY.replace,
    })

    expect(queue.enqueueMoveAnimation(createInput({
      id: 'configurable-resolution',
      moveName: 'Original Pulse',
    })).action).toBe('added')
    expect(queue.enqueueMoveAnimation(createInput({
      id: 'configurable-resolution',
      moveName: 'Queue-Level Replacement',
    })).action).toBe('replaced')
    expect(queue.activeMoveAnimations.value).toEqual([
      expect.objectContaining({ moveName: 'Queue-Level Replacement' }),
    ])

    expect(queue.enqueueMoveAnimation(createInput({
      id: 'configurable-resolution',
      moveName: 'Ignored Per-Call Duplicate',
    }), {
      duplicatePolicy: MOVE_ANIMATION_DUPLICATE_POLICY.ignore,
    }).action).toBe('ignored-duplicate')
    expect(queue.activeMoveAnimations.value).toEqual([
      expect.objectContaining({ moveName: 'Queue-Level Replacement' }),
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

  it('keeps delayed events active until their start offset and duration have elapsed', () => {
    let nowMs = 1000
    const queue = useMoveAnimationQueue({ now: () => nowMs })

    queue.enqueueMoveAnimation(createInput({
      id: 'delayed-follow-up',
      durationMs: 100,
      startOffsetMs: 200,
    }))

    nowMs = 1250
    expect(queue.pruneExpiredMoveAnimations().removedEvents).toEqual([])
    expect(queue.activeMoveAnimations.value.map((event) => event.id)).toEqual(['delayed-follow-up'])

    nowMs = 1300
    const pruned = queue.pruneExpiredMoveAnimations()

    expect(pruned.removedEvents.map((event) => event.id)).toEqual(['delayed-follow-up'])
    expect(pruned.activeEvents).toEqual([])
  })

  it('keeps expired events until explicit pruning when enqueue pruning is disabled', () => {
    let nowMs = 1000
    const queue = useMoveAnimationQueue({
      now: () => nowMs,
      pruneExpiredOnEnqueue: false,
    })

    queue.enqueueMoveAnimation(createInput({ id: 'short-lived', durationMs: 50 }))
    nowMs = 5000
    queue.enqueueMoveAnimation(createInput({ id: 'new-event' }))

    expect(queue.activeMoveAnimations.value.map((event) => event.id)).toEqual([
      'short-lived',
      'new-event',
    ])

    const pruned = queue.pruneExpiredMoveAnimations(nowMs)

    expect(pruned.removedEvents.map((event) => event.id)).toEqual(['short-lived'])
    expect(pruned.activeEvents.map((event) => event.id)).toEqual(['new-event'])
  })

  it('clears active VFX and skips new enqueue requests when move animations are disabled', () => {
    const moveAnimationsEnabled = ref(true)
    const queue = useMoveAnimationQueue({
      now: () => 1000,
      moveAnimationsEnabled,
    })

    queue.enqueueMoveAnimation(createInput({ id: 'before-disable' }))
    expect(queue.activeMoveAnimations.value.map((event) => event.id)).toEqual(['before-disable'])

    moveAnimationsEnabled.value = false
    expect(queue.activeMoveAnimations.value).toEqual([])

    const skippedSingle = queue.enqueueMoveAnimation(createInput({ id: 'while-disabled' }))
    const skippedBatch = queue.enqueueMoveAnimations([
      createInput({ id: 'disabled-batch-a' }),
      createInput({ id: 'disabled-batch-b' }),
    ])

    expect(skippedSingle.action).toBe('skipped-disabled')
    expect(skippedSingle.events).toEqual([])
    expect(skippedBatch.results).toEqual([])
    expect(queue.activeMoveAnimations.value).toEqual([])

    moveAnimationsEnabled.value = true
    queue.enqueueMoveAnimation(createInput({ moveName: 'After Disable' }))

    expect(queue.activeMoveAnimations.value).toEqual([
      expect.objectContaining({
        id: 'move-vfx-000001',
        moveName: 'After Disable',
      }),
    ])
  })

  it('materializes generic tactical VFX input without requiring non-move callers to provide a move name', () => {
    const input = createTacticalVfxQueueInput({
      sourceKind: MOVE_VFX_SOURCE_KIND.ability,
      sourceLabel: 'Intimidate',
      userId: 'user-token',
      durationMs: 320,
      kind: MOVE_VFX_KIND.selfPulse,
    })

    expect(input).toEqual({
      sourceKind: MOVE_VFX_SOURCE_KIND.ability,
      sourceLabel: 'Intimidate',
      moveName: 'Intimidate',
      userId: 'user-token',
      durationMs: 320,
      kind: MOVE_VFX_KIND.selfPulse,
    })
  })

  it('exposes generic enqueue aliases for future non-move VFX triggers', () => {
    const queue = useMoveAnimationQueue({ now: () => 2500 })

    const result = queue.enqueueTacticalVfx({
      id: 'manual-vfx',
      sourceKind: MOVE_VFX_SOURCE_KIND.manual,
      sourceLabel: 'Manual ping',
      userId: 'user-token',
      durationMs: 400,
      kind: MOVE_VFX_KIND.targetFlash,
      targetId: 'target-token',
    })

    expect(result.action).toBe('added')
    expect(queue.activeTacticalVfx.value).toEqual([
      {
        id: 'manual-vfx',
        sourceKind: MOVE_VFX_SOURCE_KIND.manual,
        sourceLabel: 'Manual ping',
        moveName: 'Manual ping',
        userId: 'user-token',
        createdAtMs: 2500,
        durationMs: 400,
        kind: MOVE_VFX_KIND.targetFlash,
        targetId: 'target-token',
      },
    ])
  })
})
