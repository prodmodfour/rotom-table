import { ref } from 'vue'
import { MOVE_VFX_KIND, MOVE_VFX_SOURCE_KIND, type MoveAnimationEvent } from '~/types/moveAnimation'
import type { MoveAutomationFeedbackPhase, MoveAutomationFeedbackState } from '~/types/moveAutomation'
import { MOVE_AUTOMATION_FEEDBACK_TIMING_MS } from '~/composables/map-editor/useMoveAutomationPanel'
import { MOVE_VFX_DEFAULT_DURATIONS_MS } from '~/utils/isometric/moveVfxTiming'
import { MOVE_VFX_TONE, moveVfxColorForTone } from '~/utils/moveAnimationPalette'
import { playDiceRollSound } from '~/utils/soundEffects'
import type { PokeballCaptureAttemptResult } from '~/utils/pokeballCapture'

type MaybePromise<T> = T | Promise<T>

export interface MapActionPokeballThrowRequest {
  readonly userId: string
  readonly targetId: string
  readonly pokeballName: string
  readonly resultId?: string
  readonly createdAtMs?: number
}

export interface MapActionPokeballFeedbackPublishRequest {
  actorPlacementId: string
  feedback: MoveAutomationFeedbackState
}

export interface MapActionPokeballResultPublishRequest {
  actorPlacementId: string
  result: PokeballCaptureAttemptResult | null
  error?: string | null
}

export type MapActionPokeballFeedbackPublishHandler = (
  request: MapActionPokeballFeedbackPublishRequest,
) => MaybePromise<unknown>

export type MapActionPokeballResultPublishHandler = (
  request: MapActionPokeballResultPublishRequest,
) => MaybePromise<unknown>

export type MapActionPokeballVfxEnqueueHandler = (
  events: readonly MoveAnimationEvent[],
) => MaybePromise<unknown>

export interface UseMapActionPokeballCaptureOptions {
  enqueueAndBroadcastMoveAnimations?: MapActionPokeballVfxEnqueueHandler
  publishPokeballFeedback?: MapActionPokeballFeedbackPublishHandler
  publishPokeballResult?: MapActionPokeballResultPublishHandler
  nowMs?: () => number
}

const defaultAnimationNowMs = (): number => {
  const performanceNow = globalThis.performance?.now
  if (typeof performanceNow === 'function') return performanceNow.call(globalThis.performance)
  return Date.now()
}

const safeNowMs = (nowMs: () => number): number => {
  const value = nowMs()
  return Number.isFinite(value) ? value : 0
}

const sanitizeEventIdPart = (value: string): string => (
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'pokeball'
)

const throwLabel = (pokeballName: string): string => {
  const trimmed = pokeballName.trim()
  return trimmed ? `Throw ${trimmed}` : 'Throw Poké Ball'
}

const warnPokeballCapturePublishFailure = (stage: string, error: unknown) => {
  console.warn(`[useMapActionPokeballCapture] ${stage} publish failed`, error)
}

const initialPokeballFeedback = (feedback: MoveAutomationFeedbackState): MoveAutomationFeedbackState => ({
  ...feedback,
  phase: 'rolling',
})

export const createPokeballThrowVfxEvents = (
  request: MapActionPokeballThrowRequest,
  nowMs: number,
): readonly MoveAnimationEvent[] => {
  const userId = request.userId.trim()
  const targetId = request.targetId.trim()
  if (!userId || !targetId) return []

  const sourceLabel = throwLabel(request.pokeballName)
  const idSource = request.resultId?.trim() || `${userId}-${targetId}-${Math.round(nowMs)}`

  return [{
    id: `pokeball-throw-${sanitizeEventIdPart(idSource)}`,
    kind: MOVE_VFX_KIND.arc,
    sourceKind: MOVE_VFX_SOURCE_KIND.manual,
    sourceLabel,
    moveName: sourceLabel,
    userId,
    targetId,
    createdAtMs: Number.isFinite(request.createdAtMs) ? request.createdAtMs as number : nowMs,
    durationMs: MOVE_VFX_DEFAULT_DURATIONS_MS.normal,
    arcHeight: 1.4,
    palette: moveVfxColorForTone(MOVE_VFX_TONE.neutral),
  }]
}

/**
 * Runtime-only bridge for Poké Ball capture map action events.
 *
 * Local capture resolution remains the only path that consumes inventory,
 * updates trainer sheets, deletes captured tokens, writes capture logs, or saves
 * map/sheet state. Remote replay only enqueues transient VFX and drives local
 * display refs for feedback/result UI.
 */
export const useMapActionPokeballCapture = (options: UseMapActionPokeballCaptureOptions = {}) => {
  const nowMs = options.nowMs ?? defaultAnimationNowMs
  const remotePokeballCaptureFeedback = ref<MoveAutomationFeedbackState | null>(null)
  const remotePokeballCaptureResult = ref<PokeballCaptureAttemptResult | null>(null)
  const remotePokeballCaptureError = ref<string | null>(null)
  const remoteFeedbackTimers: Array<ReturnType<typeof setTimeout>> = []

  const clearRemoteFeedbackTimers = () => {
    while (remoteFeedbackTimers.length) {
      const timer = remoteFeedbackTimers.pop()
      if (timer) clearTimeout(timer)
    }
  }

  const clearRemotePokeballCaptureFeedback = () => {
    clearRemoteFeedbackTimers()
    remotePokeballCaptureFeedback.value = null
  }

  const clearRemotePokeballCapture = () => {
    clearRemotePokeballCaptureFeedback()
    remotePokeballCaptureResult.value = null
    remotePokeballCaptureError.value = null
  }

  const dismissRemotePokeballCaptureResult = () => {
    remotePokeballCaptureResult.value = null
  }

  const setRemoteFeedbackPhase = (
    feedback: MoveAutomationFeedbackState,
    phase: MoveAutomationFeedbackPhase,
  ): boolean => {
    if (remotePokeballCaptureFeedback.value?.id !== feedback.id) return false
    remotePokeballCaptureFeedback.value = { ...feedback, phase }
    return true
  }

  const scheduleRemoteFeedbackStep = (delay: number, step: () => void) => {
    remoteFeedbackTimers.push(setTimeout(step, delay))
  }

  const replayPokeballFeedback = (feedback: MoveAutomationFeedbackState) => {
    clearRemoteFeedbackTimers()
    remotePokeballCaptureResult.value = null
    remotePokeballCaptureError.value = null

    const replayFeedback = initialPokeballFeedback(feedback)
    const feedbackStillCurrent = () => remotePokeballCaptureFeedback.value?.id === replayFeedback.id

    remotePokeballCaptureFeedback.value = replayFeedback
    void playDiceRollSound({ dedupeKey: replayFeedback.id })
    scheduleRemoteFeedbackStep(MOVE_AUTOMATION_FEEDBACK_TIMING_MS.d20RollAnimation, () => {
      setRemoteFeedbackPhase(replayFeedback, 'hit-roll')
    })

    const outcomeDelay = MOVE_AUTOMATION_FEEDBACK_TIMING_MS.d20RollAnimation
      + MOVE_AUTOMATION_FEEDBACK_TIMING_MS.hitRollVisible
    scheduleRemoteFeedbackStep(outcomeDelay, () => {
      setRemoteFeedbackPhase(replayFeedback, 'outcome')
    })
    scheduleRemoteFeedbackStep(outcomeDelay + MOVE_AUTOMATION_FEEDBACK_TIMING_MS.hitResultVisible, () => {
      if (feedbackStillCurrent()) remotePokeballCaptureFeedback.value = null
    })
  }

  const enqueueAndBroadcastPokeballThrow = (request: MapActionPokeballThrowRequest) => {
    if (!options.enqueueAndBroadcastMoveAnimations) return

    const events = createPokeballThrowVfxEvents(request, safeNowMs(nowMs))
    if (events.length === 0) return

    try {
      void Promise.resolve(options.enqueueAndBroadcastMoveAnimations(events)).catch((error) => {
        warnPokeballCapturePublishFailure('throw VFX', error)
      })
    } catch (error) {
      warnPokeballCapturePublishFailure('throw VFX', error)
    }
  }

  const broadcastPokeballFeedback = (feedback: MoveAutomationFeedbackState) => {
    if (!options.publishPokeballFeedback) return

    const actorPlacementId = feedback.userId.trim()
    if (!actorPlacementId) return

    try {
      void Promise.resolve(options.publishPokeballFeedback({
        actorPlacementId,
        feedback,
      })).catch((error) => {
        warnPokeballCapturePublishFailure('feedback', error)
      })
    } catch (error) {
      warnPokeballCapturePublishFailure('feedback', error)
    }
  }

  const replayPokeballResult = (payload: {
    readonly result: PokeballCaptureAttemptResult | null
    readonly error?: string | null
  }) => {
    clearRemotePokeballCaptureFeedback()
    remotePokeballCaptureResult.value = payload.result?.hit ? payload.result : null
    remotePokeballCaptureError.value = payload.error ?? (
      payload.result && !payload.result.hit
        ? payload.result.failureReason ?? 'The Poké Ball missed.'
        : null
    )
  }

  const broadcastPokeballResult = (request: {
    readonly trainerId: string
    readonly result: PokeballCaptureAttemptResult | null
    readonly error?: string | null
  }) => {
    if (!options.publishPokeballResult) return

    const actorPlacementId = request.trainerId.trim() || request.result?.trainerId.trim() || ''
    const error = request.error?.trim() || null
    if (!actorPlacementId || (!request.result && !error)) return

    try {
      void Promise.resolve(options.publishPokeballResult({
        actorPlacementId,
        result: request.result,
        error,
      })).catch((publishError) => {
        warnPokeballCapturePublishFailure('result', publishError)
      })
    } catch (publishError) {
      warnPokeballCapturePublishFailure('result', publishError)
    }
  }

  return {
    remotePokeballCaptureFeedback,
    remotePokeballCaptureResult,
    remotePokeballCaptureError,
    enqueueAndBroadcastPokeballThrow,
    broadcastPokeballFeedback,
    replayPokeballFeedback,
    broadcastPokeballResult,
    replayPokeballResult,
    clearRemotePokeballCapture,
    clearRemotePokeballCaptureFeedback,
    dismissRemotePokeballCaptureResult,
  }
}
