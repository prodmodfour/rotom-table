import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useMapActionMoveFeedback } from '~/composables/map-editor/useMapActionMoveFeedback'
import {
  MOVE_AUTOMATION_FEEDBACK_TIMING_MS,
  moveAutomationFeedbackDamagePhaseDelayMs,
} from '~/composables/map-editor/useMoveAutomationPanel'
import type { MoveAutomationFeedbackState } from '~/types/moveAutomation'

const feedbackState = (overrides: Partial<MoveAutomationFeedbackState> = {}): MoveAutomationFeedbackState => ({
  id: 'feedback-1',
  userId: 'actor-1',
  targetId: 'target-1',
  moveName: 'Thunderbolt',
  phase: 'rolling',
  naturalRoll: 18,
  modifiedRoll: 20,
  accuracyCheck: 4,
  userAccuracy: 1,
  targetEvasion: 0,
  targetEvasionLabel: 'Evasion 0',
  hit: true,
  crit: false,
  effectiveness: null,
  damageResolved: true,
  damageLoss: 24,
  conditions: [],
  ...overrides,
})

describe('useMapActionMoveFeedback', () => {
  it('broadcasts local move feedback with the actor placement id from the feedback user', () => {
    const publishMoveFeedback = vi.fn()
    const feedback = feedbackState({ userId: ' actor-2 ' })
    const { broadcastMoveFeedback } = useMapActionMoveFeedback({ publishMoveFeedback })

    broadcastMoveFeedback(feedback)

    expect(publishMoveFeedback).toHaveBeenCalledWith({
      actorPlacementId: 'actor-2',
      feedback,
    })
  })

  it('replays remote feedback phases without republishing', async () => {
    vi.useFakeTimers()
    const publishMoveFeedback = vi.fn()
    const feedback = feedbackState({ phase: 'damage' })
    const { remoteMoveAutomationFeedback, replayMoveFeedback } = useMapActionMoveFeedback({ publishMoveFeedback })

    try {
      replayMoveFeedback(feedback)
      expect(remoteMoveAutomationFeedback.value).toMatchObject({ id: 'feedback-1', phase: 'rolling' })

      await vi.advanceTimersByTimeAsync(MOVE_AUTOMATION_FEEDBACK_TIMING_MS.d20RollAnimation)
      expect(remoteMoveAutomationFeedback.value).toMatchObject({ phase: 'hit-roll' })

      await vi.advanceTimersByTimeAsync(MOVE_AUTOMATION_FEEDBACK_TIMING_MS.hitRollVisible)
      expect(remoteMoveAutomationFeedback.value).toMatchObject({ phase: 'outcome' })

      await vi.advanceTimersByTimeAsync(
        moveAutomationFeedbackDamagePhaseDelayMs(feedback)
        - MOVE_AUTOMATION_FEEDBACK_TIMING_MS.d20RollAnimation
        - MOVE_AUTOMATION_FEEDBACK_TIMING_MS.hitRollVisible,
      )
      expect(remoteMoveAutomationFeedback.value).toMatchObject({ phase: 'damage' })

      await vi.advanceTimersByTimeAsync(MOVE_AUTOMATION_FEEDBACK_TIMING_MS.finalResultVisible)
      expect(remoteMoveAutomationFeedback.value).toBeNull()
      expect(publishMoveFeedback).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears remote feedback timers so stale phases cannot resurface', async () => {
    vi.useFakeTimers()
    const { remoteMoveAutomationFeedback, replayMoveFeedback, clearRemoteMoveFeedback } = useMapActionMoveFeedback()

    try {
      replayMoveFeedback(feedbackState())
      clearRemoteMoveFeedback()
      await vi.advanceTimersByTimeAsync(moveAutomationFeedbackDamagePhaseDelayMs(feedbackState()) + 1)
      await nextTick()

      expect(remoteMoveAutomationFeedback.value).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
