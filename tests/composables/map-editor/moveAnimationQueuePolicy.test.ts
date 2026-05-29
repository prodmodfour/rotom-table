import { describe, expect, it } from 'vitest'
import {
  MOVE_ANIMATION_DUPLICATE_POLICY,
  MOVE_ANIMATION_ID_PREFIX,
  applyMoveAnimationBatchDedupe,
  applyMoveAnimationDedupe,
  createMoveAnimationIdGenerator,
  formatMoveAnimationId,
  normalizeMoveAnimationIdPrefix,
} from '~/composables/map-editor/moveAnimationQueuePolicy'
import { MOVE_VFX_KIND } from '~/types/moveAnimation'
import type { MoveAnimationEvent } from '~/types/moveAnimation'

const createEvent = (
  id: string,
  overrides: Partial<MoveAnimationEvent> = {},
): MoveAnimationEvent => ({
  id,
  moveName: 'Test Move',
  userId: 'user-token',
  createdAtMs: 1000,
  durationMs: 560,
  kind: MOVE_VFX_KIND.selfPulse,
  ...overrides,
} as MoveAnimationEvent)

describe('move animation queue policy', () => {
  it('normalizes deterministic id prefixes for queue-owned ids', () => {
    expect(MOVE_ANIMATION_ID_PREFIX).toBe('move-vfx')
    expect(normalizeMoveAnimationIdPrefix(' Move VFX ')).toBe('move-vfx')
    expect(normalizeMoveAnimationIdPrefix('Battle #42')).toBe('battle-42')
    expect(normalizeMoveAnimationIdPrefix('')).toBe(MOVE_ANIMATION_ID_PREFIX)
    expect(normalizeMoveAnimationIdPrefix(null)).toBe(MOVE_ANIMATION_ID_PREFIX)
  })

  it('formats ids with a deterministic prefix and monotonic-friendly suffix', () => {
    expect(formatMoveAnimationId(1)).toBe('move-vfx-000001')
    expect(formatMoveAnimationId(42, 'battle vfx')).toBe('battle-vfx-000042')
    expect(formatMoveAnimationId(0)).toBe('move-vfx-000001')
    expect(formatMoveAnimationId(Number.NaN)).toBe('move-vfx-000001')
  })

  it('creates per-queue id generators with monotonically increasing suffixes', () => {
    const nextId = createMoveAnimationIdGenerator()

    expect(nextId()).toBe('move-vfx-000001')
    expect(nextId()).toBe('move-vfx-000002')
    expect(nextId()).toBe('move-vfx-000003')

    const localNextId = createMoveAnimationIdGenerator({
      prefix: 'Map A',
      initialSequence: 7,
    })

    expect(localNextId()).toBe('map-a-000007')
    expect(localNextId()).toBe('map-a-000008')
  })

  it('adds new ids so intentional multi-effect sequences remain possible', () => {
    const existing = [createEvent('move-vfx-000001')]
    const incoming = createEvent('move-vfx-000002')
    const result = applyMoveAnimationDedupe(existing, incoming)

    expect(result.action).toBe('added')
    expect(result.index).toBe(1)
    expect(result.events).toEqual([existing[0], incoming])
    expect(existing).toHaveLength(1)
  })

  it('ignores duplicate ids by default instead of appending or restarting effects', () => {
    const original = createEvent('move-vfx-000001', {
      moveName: 'Original Pulse',
      createdAtMs: 1000,
    })
    const duplicate = createEvent('move-vfx-000001', {
      moveName: 'Duplicate Pulse',
      createdAtMs: 1250,
    })
    const existing = [original]

    const result = applyMoveAnimationDedupe(existing, duplicate)

    expect(result.action).toBe('ignored-duplicate')
    expect(result.index).toBe(0)
    expect(result.events).toBe(existing)
    expect(result.events).toEqual([original])
    expect(result.existingEvent).toBe(original)
    expect(result.incomingEvent).toBe(duplicate)
  })

  it('can replace a duplicate only when the caller explicitly opts into replacement', () => {
    const original = createEvent('move-vfx-000001', { moveName: 'Original Pulse' })
    const replacement = createEvent('move-vfx-000001', {
      moveName: 'Corrected Pulse',
      durationMs: 240,
    })

    const result = applyMoveAnimationDedupe([original], replacement, {
      duplicatePolicy: MOVE_ANIMATION_DUPLICATE_POLICY.replace,
    })

    expect(result.action).toBe('replaced')
    expect(result.index).toBe(0)
    expect(result.events).toEqual([replacement])
    expect(result.existingEvent).toBe(original)
  })

  it('applies the same policy across batches without creating duplicate active ids', () => {
    const first = createEvent('move-vfx-000001')
    const second = createEvent('move-vfx-000002')
    const duplicateSecond = createEvent('move-vfx-000002', { moveName: 'Duplicate Beam' })

    const result = applyMoveAnimationBatchDedupe([], [first, second, duplicateSecond])

    expect(result.events).toEqual([first, second])
    expect(result.results.map(({ action }) => action)).toEqual([
      'added',
      'added',
      'ignored-duplicate',
    ])
  })
})
