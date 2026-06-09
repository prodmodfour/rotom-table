import { ref } from 'vue'
import {
  MOVE_AUTOMATION_FEEDBACK_TIMING_MS,
  moveAutomationFeedbackDamagePhaseDelayMs,
  moveAutomationFeedbackHasEffectivenessPhase,
  moveAutomationFeedbackHasFinalResolutionPhase,
} from '~/composables/map-editor/useMoveAutomationPanel'
import type { MoveAutomationFeedbackPhase, MoveAutomationFeedbackState } from '~/types/moveAutomation'

type MaybePromise<T> = T | Promise<T>

export interface MapActionMoveFeedbackPublishRequest {
  actorPlacementId: string
  feedback: MoveAutomationFeedbackState
}

export type MapActionMoveFeedbackPublishHandler = (
  request: MapActionMoveFeedbackPublishRequest,
) => MaybePromise<unknown>

export interface UseMapActionMoveFeedbackOptions {
  publishMoveFeedback?: MapActionMoveFeedbackPublishHandler
}

const warnMoveFeedbackPublishFailure = (error: unknown) => {
  console.warn('[useMapActionMoveFeedback] move feedback publish failed', error)
}

const initialReplayFeedback = (feedback: MoveAutomationFeedbackState): MoveAutomationFeedbackState => ({
  ...feedback,
  phase: 'rolling',
})

/**
 * Runtime-only bridge for move roll feedback map action events.
 *
 * Local move automation remains authoritative for mechanics and invokes
 * `broadcastMoveFeedback` only after a real local resolution starts. Remote
 * replay owns a separate feedback ref and advances the same display phases
 * without applying move automation transactions, HP/status/stage changes,
 * hazards, field effects, or logs.
 */
export const useMapActionMoveFeedback = (options: UseMapActionMoveFeedbackOptions = {}) => {
  const remoteMoveAutomationFeedback = ref<MoveAutomationFeedbackState | null>(null)
  const remoteFeedbackTimers: Array<ReturnType<typeof setTimeout>> = []

  const clearRemoteFeedbackTimers = () => {
    while (remoteFeedbackTimers.length) {
      const timer = remoteFeedbackTimers.pop()
      if (timer) clearTimeout(timer)
    }
  }

  const clearRemoteMoveFeedback = () => {
    clearRemoteFeedbackTimers()
    remoteMoveAutomationFeedback.value = null
  }

  const setRemoteFeedbackPhase = (
    feedback: MoveAutomationFeedbackState,
    phase: MoveAutomationFeedbackPhase,
  ): boolean => {
    if (remoteMoveAutomationFeedback.value?.id !== feedback.id) return false
    remoteMoveAutomationFeedback.value = { ...feedback, phase }
    return true
  }

  const scheduleRemoteFeedbackStep = (delay: number, step: () => void) => {
    remoteFeedbackTimers.push(setTimeout(step, delay))
  }

  const replayMoveFeedback = (feedback: MoveAutomationFeedbackState) => {
    clearRemoteFeedbackTimers()

    const replayFeedback = initialReplayFeedback(feedback)
    const hasFinalPhase = moveAutomationFeedbackHasFinalResolutionPhase(replayFeedback)
    const hasEffectivenessPhase = hasFinalPhase && moveAutomationFeedbackHasEffectivenessPhase(replayFeedback)
    const feedbackStillCurrent = () => remoteMoveAutomationFeedback.value?.id === replayFeedback.id

    remoteMoveAutomationFeedback.value = replayFeedback
    scheduleRemoteFeedbackStep(MOVE_AUTOMATION_FEEDBACK_TIMING_MS.d20RollAnimation, () => {
      setRemoteFeedbackPhase(replayFeedback, 'hit-roll')
    })

    const outcomeDelay = MOVE_AUTOMATION_FEEDBACK_TIMING_MS.d20RollAnimation
      + MOVE_AUTOMATION_FEEDBACK_TIMING_MS.hitRollVisible
    scheduleRemoteFeedbackStep(outcomeDelay, () => {
      setRemoteFeedbackPhase(replayFeedback, 'outcome')
    })

    if (hasFinalPhase) {
      const effectivenessDelay = outcomeDelay + MOVE_AUTOMATION_FEEDBACK_TIMING_MS.hitResultVisible
      if (hasEffectivenessPhase) {
        scheduleRemoteFeedbackStep(effectivenessDelay, () => {
          setRemoteFeedbackPhase(replayFeedback, 'effectiveness')
        })
      }

      const finalDelay = moveAutomationFeedbackDamagePhaseDelayMs(replayFeedback)
      scheduleRemoteFeedbackStep(finalDelay, () => {
        setRemoteFeedbackPhase(replayFeedback, 'damage')
      })
      scheduleRemoteFeedbackStep(finalDelay + MOVE_AUTOMATION_FEEDBACK_TIMING_MS.finalResultVisible, () => {
        if (feedbackStillCurrent()) remoteMoveAutomationFeedback.value = null
      })
      return
    }

    scheduleRemoteFeedbackStep(outcomeDelay + MOVE_AUTOMATION_FEEDBACK_TIMING_MS.hitResultVisible, () => {
      if (feedbackStillCurrent()) remoteMoveAutomationFeedback.value = null
    })
  }

  const broadcastMoveFeedback = (feedback: MoveAutomationFeedbackState) => {
    if (!options.publishMoveFeedback) return

    const actorPlacementId = feedback.userId.trim()
    if (!actorPlacementId) return

    try {
      void Promise.resolve(options.publishMoveFeedback({
        actorPlacementId,
        feedback,
      })).catch(warnMoveFeedbackPublishFailure)
    } catch (error) {
      warnMoveFeedbackPublishFailure(error)
    }
  }

  return {
    remoteMoveAutomationFeedback,
    broadcastMoveFeedback,
    replayMoveFeedback,
    clearRemoteMoveFeedback,
  }
}
