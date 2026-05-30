import type { GridAnchor } from '~/types/map'
import type { MoveAnimationEvent } from '~/types/moveAnimation'
import {
  animationProgress,
  type MoveVfxAnimationProgress,
} from '~/utils/isometric/moveVfxTiming'

/** Ordering strategies for multi-target VFX start offsets. */
export const MOVE_ANIMATION_TARGET_SEQUENCE_ORDER = {
  inputOrder: 'input-order',
  distanceFromOrigin: 'distance-from-origin',
  stableId: 'stable-id',
} as const

export type MoveAnimationTargetSequenceOrder = (
  typeof MOVE_ANIMATION_TARGET_SEQUENCE_ORDER
)[keyof typeof MOVE_ANIMATION_TARGET_SEQUENCE_ORDER]

export interface MoveAnimationSequencingTarget {
  readonly targetId: string
  readonly position?: GridAnchor | null
}

export interface MoveAnimationTargetStartOffset {
  readonly targetId: string
  /** Zero-based order after applying the requested stable sequencing strategy. */
  readonly order: number
  /** Non-negative offset from an event's `createdAtMs` before the visual should begin. */
  readonly startOffsetMs: number
}

export interface CreateMoveAnimationTargetStartOffsetsOptions {
  readonly order?: MoveAnimationTargetSequenceOrder
  /** User/source cell for distance-based sequencing. Missing origins fall back to stable id order. */
  readonly origin?: GridAnchor | null
  readonly baseOffsetMs?: number
  readonly stepMs?: number
  /** Maximum offset spread between the first and last target, excluding `baseOffsetMs`. */
  readonly maxTotalStaggerMs?: number
}

export type MoveAnimationTargetStartOffsetMode = 'add' | 'replace'

export interface ApplyMoveAnimationTargetStartOffsetsOptions {
  /** `add` preserves existing launch/impact delays and layers the target stagger on top. */
  readonly mode?: MoveAnimationTargetStartOffsetMode
}

export const MOVE_ANIMATION_TARGET_STAGGER_STEP_MS = 80
export const MOVE_ANIMATION_TARGET_STAGGER_MAX_TOTAL_MS = 320

interface NormalizedSequencingTarget {
  readonly targetId: string
  readonly position?: GridAnchor
  readonly inputIndex: number
}

const finiteNonNegativeMs = (value: unknown, fallback = 0): number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
)

const normalizeTargetId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const isFiniteGridAnchor = (value: GridAnchor | null | undefined): value is GridAnchor => (
  Boolean(value)
  && Number.isFinite(value?.x)
  && Number.isFinite(value?.y)
  && Number.isFinite(value?.z)
)

const squaredGridDistance = (from: GridAnchor, to: GridAnchor): number => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  return (dx * dx) + (dy * dy) + (dz * dz)
}

const stableTargetIdCompare = (
  left: NormalizedSequencingTarget,
  right: NormalizedSequencingTarget,
): number => left.targetId.localeCompare(right.targetId)

const normalizeSequencingTargets = (
  targets: readonly MoveAnimationSequencingTarget[],
): NormalizedSequencingTarget[] => {
  const seen = new Set<string>()
  const normalized: NormalizedSequencingTarget[] = []

  targets.forEach((target, inputIndex) => {
    const targetId = normalizeTargetId(target.targetId)
    if (!targetId || seen.has(targetId)) return

    seen.add(targetId)
    normalized.push({
      targetId,
      inputIndex,
      ...(isFiniteGridAnchor(target.position) ? { position: target.position } : {}),
    })
  })

  return normalized
}

const orderSequencingTargets = (
  targets: readonly NormalizedSequencingTarget[],
  options: CreateMoveAnimationTargetStartOffsetsOptions,
): NormalizedSequencingTarget[] => {
  const ordered = [...targets]
  const order = options.order ?? MOVE_ANIMATION_TARGET_SEQUENCE_ORDER.inputOrder

  if (order === MOVE_ANIMATION_TARGET_SEQUENCE_ORDER.stableId) {
    ordered.sort(stableTargetIdCompare)
    return ordered
  }

  if (order === MOVE_ANIMATION_TARGET_SEQUENCE_ORDER.distanceFromOrigin) {
    const origin = options.origin
    if (!isFiniteGridAnchor(origin)) {
      ordered.sort(stableTargetIdCompare)
      return ordered
    }

    ordered.sort((left, right) => {
      const leftDistance = left.position ? squaredGridDistance(origin, left.position) : Number.POSITIVE_INFINITY
      const rightDistance = right.position ? squaredGridDistance(origin, right.position) : Number.POSITIVE_INFINITY
      if (leftDistance !== rightDistance) return leftDistance - rightDistance
      return stableTargetIdCompare(left, right)
    })
    return ordered
  }

  ordered.sort((left, right) => left.inputIndex - right.inputIndex)
  return ordered
}

/**
 * Creates bounded per-target start offsets for noisy multi-target VFX batches.
 *
 * The helper is pure and scheduler-free: it never starts timers or mutates the
 * supplied targets. Callers can order by confirmed target order, source-to-target
 * distance, or stable id, then apply the resulting `startOffsetMs` values to
 * target-flash/semantic follow-up events. The offset spread is capped so large
 * area moves stay snappy at the table.
 */
export const createMoveAnimationTargetStartOffsets = (
  targets: readonly MoveAnimationSequencingTarget[],
  options: CreateMoveAnimationTargetStartOffsetsOptions = {},
): readonly MoveAnimationTargetStartOffset[] => {
  const orderedTargets = orderSequencingTargets(normalizeSequencingTargets(targets), options)
  if (orderedTargets.length === 0) return []

  const baseOffsetMs = finiteNonNegativeMs(options.baseOffsetMs)
  const requestedStepMs = finiteNonNegativeMs(options.stepMs, MOVE_ANIMATION_TARGET_STAGGER_STEP_MS)
  const maxTotalStaggerMs = finiteNonNegativeMs(
    options.maxTotalStaggerMs,
    MOVE_ANIMATION_TARGET_STAGGER_MAX_TOTAL_MS,
  )
  const cappedStepMs = orderedTargets.length > 1
    ? Math.min(requestedStepMs, maxTotalStaggerMs / (orderedTargets.length - 1))
    : 0

  return orderedTargets.map((target, order) => ({
    targetId: target.targetId,
    order,
    startOffsetMs: Math.round(baseOffsetMs + (cappedStepMs * order)),
  }))
}

const targetIdForEvent = (event: MoveAnimationEvent): string | null => {
  if (!('targetId' in event)) return null
  return normalizeTargetId(event.targetId)
}

/** Returns a sanitized non-negative start offset for a transient VFX event. */
export const moveAnimationEventStartOffsetMs = (
  event: Pick<MoveAnimationEvent, 'startOffsetMs'>,
): number => finiteNonNegativeMs(event.startOffsetMs)

/** Returns the effective wall-clock start time for delayed/staggered events. */
export const moveAnimationEventStartMs = (
  event: Pick<MoveAnimationEvent, 'createdAtMs' | 'startOffsetMs'>,
): number => finiteNonNegativeMs(event.createdAtMs) + moveAnimationEventStartOffsetMs(event)

/** Computes animation progress using `createdAtMs + startOffsetMs` as the effective start. */
export const moveAnimationEventProgress = (
  event: Pick<MoveAnimationEvent, 'createdAtMs' | 'durationMs' | 'startOffsetMs'>,
  nowMs: number,
): MoveVfxAnimationProgress => animationProgress(
  nowMs,
  moveAnimationEventStartMs(event),
  event.durationMs,
)

export const hasMoveAnimationEventStarted = (
  event: Pick<MoveAnimationEvent, 'createdAtMs' | 'startOffsetMs'>,
  nowMs: number,
): boolean => finiteNonNegativeMs(nowMs) >= moveAnimationEventStartMs(event)

/**
 * Applies per-target stagger offsets to event batches without mutating the
 * original events. Non-targeted events are returned unchanged. Existing
 * `startOffsetMs` values are preserved and added to by default so callers can
 * layer target staggering on top of launch/impact timing.
 */
export const applyMoveAnimationTargetStartOffsets = <T extends MoveAnimationEvent>(
  events: readonly T[],
  offsets: readonly MoveAnimationTargetStartOffset[],
  options: ApplyMoveAnimationTargetStartOffsetsOptions = {},
): readonly T[] => {
  const offsetByTargetId = new Map<string, number>()
  offsets.forEach((offset) => {
    const targetId = normalizeTargetId(offset.targetId)
    if (!targetId) return
    offsetByTargetId.set(targetId, finiteNonNegativeMs(offset.startOffsetMs))
  })

  if (offsetByTargetId.size === 0) return events

  const mode = options.mode ?? 'add'
  return events.map((event) => {
    const targetId = targetIdForEvent(event)
    if (!targetId || !offsetByTargetId.has(targetId)) return event

    const offset = offsetByTargetId.get(targetId) ?? 0
    const startOffsetMs = mode === 'replace'
      ? offset
      : moveAnimationEventStartOffsetMs(event) + offset

    return {
      ...event,
      startOffsetMs,
    } as T
  })
}
