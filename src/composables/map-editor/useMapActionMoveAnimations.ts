import type { MoveAnimationEvent } from '~/types/moveAnimation'

type MaybePromise<T> = T | Promise<T>

export interface MapActionMoveAnimationsPublishRequest {
  actorPlacementId: string
  events: readonly MoveAnimationEvent[]
}

export type MapActionMoveAnimationsEnqueueHandler = (
  events: readonly MoveAnimationEvent[],
) => MaybePromise<unknown>

export type MapActionMoveAnimationsPublishHandler = (
  request: MapActionMoveAnimationsPublishRequest,
) => MaybePromise<unknown>

export interface UseMapActionMoveAnimationsOptions {
  enqueueLocalMoveAnimations: MapActionMoveAnimationsEnqueueHandler
  publishMoveAnimations?: MapActionMoveAnimationsPublishHandler
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> => (
  typeof value === 'object'
  && value !== null
  && 'then' in value
  && typeof (value as { then?: unknown }).then === 'function'
)

const warnMoveAnimationsPublishFailure = (error: unknown) => {
  console.warn('[useMapActionMoveAnimations] move animation publish failed', error)
}

export const actorPlacementIdForMoveAnimationBatch = (
  events: readonly MoveAnimationEvent[],
): string | null => {
  const userId = events.find((event) => event.userId.trim().length > 0)?.userId.trim()
  return userId ?? null
}

/**
 * Bridges planned move VFX into map-scoped transient action events.
 *
 * Local enqueue remains the only renderer input for this tab, so browser-level
 * Move VFX enable/disable and reduced-motion preferences continue to apply on
 * both the sender and receiver. Publishing is fire-and-forget visual sync only;
 * remote replay calls the local queue and must not invoke move automation or
 * persist gameplay state.
 */
export const useMapActionMoveAnimations = (options: UseMapActionMoveAnimationsOptions) => {
  const publishMoveAnimations = (events: readonly MoveAnimationEvent[]) => {
    if (!options.publishMoveAnimations) return

    const actorPlacementId = actorPlacementIdForMoveAnimationBatch(events)
    if (!actorPlacementId) return

    try {
      void Promise.resolve(options.publishMoveAnimations({
        actorPlacementId,
        events,
      })).catch(warnMoveAnimationsPublishFailure)
    } catch (error) {
      warnMoveAnimationsPublishFailure(error)
    }
  }

  const enqueueAndBroadcastMoveAnimations = (events: readonly MoveAnimationEvent[]): MaybePromise<unknown> => {
    const localResult = options.enqueueLocalMoveAnimations(events)

    if (isPromiseLike(localResult)) {
      return Promise.resolve(localResult).then((result) => {
        publishMoveAnimations(events)
        return result
      })
    }

    publishMoveAnimations(events)
    return localResult
  }

  const replayMoveAnimations = (
    events: readonly MoveAnimationEvent[],
  ): MaybePromise<unknown> => options.enqueueLocalMoveAnimations(events)

  return {
    enqueueAndBroadcastMoveAnimations,
    replayMoveAnimations,
  }
}
