import type { MoveAnimationEvent } from '~/types/moveAnimation'

/**
 * Default deterministic prefix for transient move-animation queue ids.
 *
 * Queue instances should own their own id generator instead of sharing a module
 * global counter. That keeps SSR/tests deterministic, avoids cross-map leakage,
 * and lets move automation provide a caller-stable id when a watcher may re-run
 * for the same resolution moment.
 */
export const MOVE_ANIMATION_ID_PREFIX = 'move-vfx' as const

export const MOVE_ANIMATION_DUPLICATE_POLICY = {
  /**
   * Default queue behavior: keep the already-active event and do not restart it.
   * This prevents watcher/render churn from accidentally replaying the same VFX.
   */
  ignore: 'ignore',
  /**
   * Explicit corrective behavior for future callers that need to update an
   * active event in place. Intentional replays should usually use a new id.
   */
  replace: 'replace',
} as const

export type MoveAnimationDuplicatePolicy = (
  typeof MOVE_ANIMATION_DUPLICATE_POLICY
)[keyof typeof MOVE_ANIMATION_DUPLICATE_POLICY]

export type MoveAnimationIdGenerator = () => string

export interface MoveAnimationIdGeneratorOptions {
  /** Prefix before the monotonic sequence suffix. Defaults to `move-vfx`. */
  readonly prefix?: string | null
  /** First sequence number emitted by the generator. Defaults to 1. */
  readonly initialSequence?: number
}

export interface MoveAnimationDedupeOptions {
  /** Duplicate-id policy. The queue should use `ignore` unless a caller opts in. */
  readonly duplicatePolicy?: MoveAnimationDuplicatePolicy
}

export type MoveAnimationQueueDedupeAction = 'added' | 'ignored-duplicate' | 'replaced'

export interface MoveAnimationQueueDedupeResult {
  readonly events: readonly MoveAnimationEvent[]
  readonly action: MoveAnimationQueueDedupeAction
  readonly index: number
  readonly incomingEvent: MoveAnimationEvent
  readonly existingEvent?: MoveAnimationEvent
}

export interface MoveAnimationQueueDedupeBatchResult {
  readonly events: readonly MoveAnimationEvent[]
  readonly results: readonly MoveAnimationQueueDedupeResult[]
}

const ID_SEQUENCE_PAD_LENGTH = 6
const FIRST_ID_SEQUENCE = 1

const normalizeMoveAnimationSequence = (sequence: number | undefined): number => {
  if (!Number.isFinite(sequence)) return FIRST_ID_SEQUENCE
  return Math.max(FIRST_ID_SEQUENCE, Math.floor(sequence ?? FIRST_ID_SEQUENCE))
}

export const normalizeMoveAnimationIdPrefix = (prefix?: string | null): string => {
  const normalized = String(prefix ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || MOVE_ANIMATION_ID_PREFIX
}

export const formatMoveAnimationId = (
  sequence: number,
  prefix: string | null = MOVE_ANIMATION_ID_PREFIX,
): string => {
  const safeSequence = normalizeMoveAnimationSequence(sequence)
  const suffix = String(safeSequence).padStart(ID_SEQUENCE_PAD_LENGTH, '0')
  return `${normalizeMoveAnimationIdPrefix(prefix)}-${suffix}`
}

export const createMoveAnimationIdGenerator = (
  options: MoveAnimationIdGeneratorOptions = {},
): MoveAnimationIdGenerator => {
  const prefix = normalizeMoveAnimationIdPrefix(options.prefix)
  let nextSequence = normalizeMoveAnimationSequence(options.initialSequence)

  return () => {
    const id = formatMoveAnimationId(nextSequence, prefix)
    nextSequence += 1
    return id
  }
}

/**
 * Applies the move-animation queue duplicate-id policy without owning Vue state.
 *
 * The future `useMoveAnimationQueue` composable should call this helper when it
 * enqueues events. Identical ids are ignored by default: enqueueing the same id
 * twice keeps the original active effect and does not create, restart, or append
 * a duplicate. Intentional multi-effect sequences must use distinct ids; callers
 * that explicitly need to correct an active event may opt into `replace`.
 */
export const applyMoveAnimationDedupe = (
  activeEvents: readonly MoveAnimationEvent[],
  incomingEvent: MoveAnimationEvent,
  options: MoveAnimationDedupeOptions = {},
): MoveAnimationQueueDedupeResult => {
  const existingIndex = activeEvents.findIndex((event) => event.id === incomingEvent.id)

  if (existingIndex < 0) {
    return {
      events: [...activeEvents, incomingEvent],
      action: 'added',
      index: activeEvents.length,
      incomingEvent,
    }
  }

  const existingEvent = activeEvents[existingIndex] as MoveAnimationEvent
  const duplicatePolicy = options.duplicatePolicy ?? MOVE_ANIMATION_DUPLICATE_POLICY.ignore

  if (duplicatePolicy === MOVE_ANIMATION_DUPLICATE_POLICY.replace) {
    const events = [...activeEvents]
    events[existingIndex] = incomingEvent

    return {
      events,
      action: 'replaced',
      index: existingIndex,
      incomingEvent,
      existingEvent,
    }
  }

  return {
    events: activeEvents,
    action: 'ignored-duplicate',
    index: existingIndex,
    incomingEvent,
    existingEvent,
  }
}

export const applyMoveAnimationBatchDedupe = (
  activeEvents: readonly MoveAnimationEvent[],
  incomingEvents: readonly MoveAnimationEvent[],
  options: MoveAnimationDedupeOptions = {},
): MoveAnimationQueueDedupeBatchResult => {
  const results: MoveAnimationQueueDedupeResult[] = []
  let events: readonly MoveAnimationEvent[] = activeEvents

  for (const incomingEvent of incomingEvents) {
    const result = applyMoveAnimationDedupe(events, incomingEvent, options)
    events = result.events
    results.push(result)
  }

  return { events, results }
}
