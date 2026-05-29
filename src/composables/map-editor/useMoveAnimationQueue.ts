import { computed, ref } from 'vue'
import {
  MOVE_ANIMATION_DUPLICATE_POLICY,
  applyMoveAnimationBatchDedupe,
  applyMoveAnimationDedupe,
  createMoveAnimationIdGenerator,
  type MoveAnimationDedupeOptions,
  type MoveAnimationIdGenerator,
  type MoveAnimationIdGeneratorOptions,
  type MoveAnimationQueueDedupeBatchResult,
  type MoveAnimationQueueDedupeResult,
} from './moveAnimationQueuePolicy'
import type {
  MoveAnimationEvent,
  MoveAnimationEventByKind,
  MoveAnimationId,
  MoveVfxKind,
} from '~/types/moveAnimation'
import { animationProgress } from '~/utils/isometric/moveVfxTiming'

type OptionalQueueManagedFields<T extends MoveAnimationEvent> = Omit<T, 'id' | 'createdAtMs'>
  & Partial<Pick<T, 'id' | 'createdAtMs'>>

/**
 * Queue input accepted by `useMoveAnimationQueue`.
 *
 * Callers may provide a stable id/created timestamp when they have one, or let
 * the per-queue instance fill those transient fields. The resulting events are
 * client-local VFX requests only; this composable must not be serialized into
 * map, sheet, session, campaign, server, or log state.
 */
export type MoveAnimationQueueInput = {
  [Kind in MoveVfxKind]: OptionalQueueManagedFields<MoveAnimationEventByKind[Kind]>
}[MoveVfxKind]

export interface UseMoveAnimationQueueOptions extends MoveAnimationIdGeneratorOptions {
  /** Injected clock for deterministic tests and future renderer/page pruning. */
  readonly now?: () => number
  /** Injected id generator for deterministic tests; defaults to a per-queue generator. */
  readonly createId?: MoveAnimationIdGenerator
  /** Duplicate policy used by enqueue helpers unless overridden per call. */
  readonly duplicatePolicy?: MoveAnimationDedupeOptions['duplicatePolicy']
  /** Opportunistically prune already-expired entries before enqueueing. Defaults to true. */
  readonly pruneExpiredOnEnqueue?: boolean
}

export interface EnqueueMoveAnimationOptions extends MoveAnimationDedupeOptions {}

export interface EnqueueMoveAnimationResult extends MoveAnimationQueueDedupeResult {}

export interface EnqueueMoveAnimationsResult extends MoveAnimationQueueDedupeBatchResult {}

export interface MoveAnimationPruneResult {
  readonly activeEvents: readonly MoveAnimationEvent[]
  readonly removedEvents: readonly MoveAnimationEvent[]
}

const getSafeNowMs = (now: () => number): number => {
  const nowMs = now()
  return Number.isFinite(nowMs) ? nowMs : 0
}

export const isMoveAnimationExpired = (
  event: MoveAnimationEvent,
  nowMs: number,
): boolean => animationProgress(nowMs, event.createdAtMs, event.durationMs).complete

const materializeMoveAnimationEvent = (
  input: MoveAnimationQueueInput,
  nextId: MoveAnimationIdGenerator,
  nowMs: number,
): MoveAnimationEvent => ({
  ...input,
  id: input.id ?? nextId(),
  createdAtMs: input.createdAtMs ?? nowMs,
} as MoveAnimationEvent)

/**
 * Owns the transient, per-map active move-animation queue.
 *
 * The queue deliberately has no module-level state, timers, persistence hooks,
 * renderer imports, or gameplay knowledge. Map pages can create one instance,
 * move automation can enqueue typed VFX requests, and renderer integration can
 * consume/remove/clear events without creating circular dependencies. Its
 * `activeMoveAnimations` output is runtime renderer input only; do not copy it
 * into map save bodies, sheet save bodies, move usage logs, live-session
 * payloads, localStorage, or schema migrations.
 */
export const useMoveAnimationQueue = (options: UseMoveAnimationQueueOptions = {}) => {
  const now = options.now ?? Date.now
  const nextId = options.createId ?? createMoveAnimationIdGenerator({
    prefix: options.prefix,
    initialSequence: options.initialSequence,
  })
  const defaultDuplicatePolicy = options.duplicatePolicy
    ?? MOVE_ANIMATION_DUPLICATE_POLICY.ignore
  const pruneExpiredOnEnqueue = options.pruneExpiredOnEnqueue ?? true
  // Runtime-only queue contents. Keep this private so persistence code cannot
  // accidentally serialize active VFX as map, sheet, session, or log data.
  const activeEvents = ref<readonly MoveAnimationEvent[]>([])

  const activeMoveAnimations = computed<readonly MoveAnimationEvent[]>(() => activeEvents.value)

  const removeMoveAnimation = (id: MoveAnimationId): boolean => {
    const before = activeEvents.value
    const nextEvents = before.filter((event) => event.id !== id)
    if (nextEvents.length === before.length) return false

    activeEvents.value = nextEvents
    return true
  }

  const clearMoveAnimations = (): readonly MoveAnimationEvent[] => {
    const removedEvents = activeEvents.value
    if (removedEvents.length > 0) activeEvents.value = []
    return removedEvents
  }

  const pruneExpiredMoveAnimations = (
    nowMs = getSafeNowMs(now),
  ): MoveAnimationPruneResult => {
    const removedEvents: MoveAnimationEvent[] = []
    const nextEvents = activeEvents.value.filter((event) => {
      const expired = isMoveAnimationExpired(event, nowMs)
      if (expired) removedEvents.push(event)
      return !expired
    })

    if (removedEvents.length > 0) activeEvents.value = nextEvents

    return {
      activeEvents: activeEvents.value,
      removedEvents,
    }
  }

  const enqueueMoveAnimation = (
    input: MoveAnimationQueueInput,
    enqueueOptions: EnqueueMoveAnimationOptions = {},
  ): EnqueueMoveAnimationResult => {
    const nowMs = getSafeNowMs(now)
    if (pruneExpiredOnEnqueue) pruneExpiredMoveAnimations(nowMs)

    const event = materializeMoveAnimationEvent(input, nextId, nowMs)
    const result = applyMoveAnimationDedupe(activeEvents.value, event, {
      duplicatePolicy: enqueueOptions.duplicatePolicy ?? defaultDuplicatePolicy,
    })

    activeEvents.value = result.events
    return result
  }

  const enqueueMoveAnimations = (
    inputs: readonly MoveAnimationQueueInput[],
    enqueueOptions: EnqueueMoveAnimationOptions = {},
  ): EnqueueMoveAnimationsResult => {
    const nowMs = getSafeNowMs(now)
    if (pruneExpiredOnEnqueue) pruneExpiredMoveAnimations(nowMs)

    const events = inputs.map((input) => materializeMoveAnimationEvent(input, nextId, nowMs))
    const result = applyMoveAnimationBatchDedupe(activeEvents.value, events, {
      duplicatePolicy: enqueueOptions.duplicatePolicy ?? defaultDuplicatePolicy,
    })

    activeEvents.value = result.events
    return result
  }

  return {
    activeMoveAnimations,
    enqueueMoveAnimation,
    enqueueMoveAnimations,
    clearMoveAnimations,
    removeMoveAnimation,
    pruneExpiredMoveAnimations,
  }
}
