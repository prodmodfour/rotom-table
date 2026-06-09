import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPokeballThrowVfxEvents,
  useMapActionPokeballCapture,
} from '~/composables/map-editor/useMapActionPokeballCapture'
import { MOVE_AUTOMATION_FEEDBACK_TIMING_MS } from '~/composables/map-editor/useMoveAutomationPanel'
import { MOVE_VFX_KIND, MOVE_VFX_SOURCE_KIND } from '~/types/moveAnimation'
import type { MoveAutomationFeedbackState } from '~/types/moveAutomation'
import type { PokeballCaptureAttemptResult } from '~/utils/pokeballCapture'

const feedback = {
  id: 'capture-trainer-pidgey-100',
  userId: 'trainer',
  targetId: 'pidgey',
  moveName: 'Throw Basic Ball',
  phase: 'rolling',
  naturalRoll: 18,
  modifiedRoll: 18,
  accuracyCheck: 6,
  userAccuracy: 0,
  targetEvasion: 0,
  targetEvasionLabel: 'Evasion 0',
  hit: true,
  crit: false,
  effectiveness: null,
  damageResolved: false,
  damageLoss: 0,
  conditions: [],
} satisfies MoveAutomationFeedbackState

const captureResult = {
  id: 'capture-trainer-pidgey-100',
  trainerId: 'trainer',
  trainerName: 'Lenora',
  targetId: 'pidgey',
  targetName: 'Pidgey',
  targetSpecies: 'Pidgey',
  targetSpriteUrl: '/pidgey.png',
  pokeballName: 'Basic Ball',
  success: true,
  hit: true,
  shakeCount: 3,
  accuracyRoll: 20,
  modifiedAccuracyRoll: 20,
  accuracyCheck: 6,
  userAccuracy: 0,
  targetEvasion: 0,
  targetEvasionLabel: 'Evasion 0',
  captureRoll: 1,
  adjustedCaptureRoll: 1,
  captureRate: 100,
  naturalTwentyCaptureBonus: -10,
  naturalCaptureSuccess: false,
  failureReason: null,
  breakdown: {
    captureRate: 100,
    captureRateLines: [{ label: 'Base', value: 100 }],
    rollModifier: 0,
    rollModifierLines: [{ label: 'Basic Ball modifier', value: 0 }],
    hitChance: {
      targetId: 'pidgey',
      percent: 75,
      label: '75%',
      tone: 'high',
      title: '75% to hit and capture.',
    },
    captureChance: 100,
    captureChanceLabel: '100%',
    naturalTwentyCaptureChance: 100,
    naturalTwentyCaptureChanceLabel: '100%',
    combinedChance: 75,
    combinedChanceLabel: '75%',
    capturable: true,
    uncatchableReason: null,
    notes: [],
  },
} satisfies PokeballCaptureAttemptResult

describe('useMapActionPokeballCapture', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('creates a transient arc VFX request from trainer token to target token', () => {
    const events = createPokeballThrowVfxEvents({
      userId: 'trainer',
      targetId: 'pidgey',
      pokeballName: 'Basic Ball',
      resultId: 'capture-trainer-pidgey-100',
    }, 5_000)

    expect(events).toEqual([
      expect.objectContaining({
        id: 'pokeball-throw-capture-trainer-pidgey-100',
        kind: MOVE_VFX_KIND.arc,
        sourceKind: MOVE_VFX_SOURCE_KIND.manual,
        sourceLabel: 'Throw Basic Ball',
        moveName: 'Throw Basic Ball',
        userId: 'trainer',
        targetId: 'pidgey',
        createdAtMs: 5_000,
        durationMs: 500,
      }),
    ])
  })

  it('broadcasts throw VFX, capture feedback, and capture result through injected visual-only publishers', () => {
    const enqueueAndBroadcastMoveAnimations = vi.fn()
    const publishPokeballFeedback = vi.fn()
    const publishPokeballResult = vi.fn()
    const capture = useMapActionPokeballCapture({
      enqueueAndBroadcastMoveAnimations,
      publishPokeballFeedback,
      publishPokeballResult,
      nowMs: () => 5_000,
    })

    capture.enqueueAndBroadcastPokeballThrow({
      userId: 'trainer',
      targetId: 'pidgey',
      pokeballName: 'Basic Ball',
      resultId: captureResult.id,
    })
    capture.broadcastPokeballFeedback(feedback)
    capture.broadcastPokeballResult({ trainerId: 'trainer', result: captureResult, error: null })

    expect(enqueueAndBroadcastMoveAnimations).toHaveBeenCalledWith([
      expect.objectContaining({ kind: MOVE_VFX_KIND.arc, userId: 'trainer', targetId: 'pidgey' }),
    ])
    expect(publishPokeballFeedback).toHaveBeenCalledWith({
      actorPlacementId: 'trainer',
      feedback,
    })
    expect(publishPokeballResult).toHaveBeenCalledWith({
      actorPlacementId: 'trainer',
      result: captureResult,
      error: null,
    })
  })

  it('replays remote capture feedback phases without applying capture mechanics', async () => {
    vi.useFakeTimers()
    const capture = useMapActionPokeballCapture()

    capture.replayPokeballFeedback({ ...feedback, phase: 'outcome' })

    expect(capture.remotePokeballCaptureFeedback.value).toMatchObject({
      id: feedback.id,
      phase: 'rolling',
    })

    await vi.advanceTimersByTimeAsync(MOVE_AUTOMATION_FEEDBACK_TIMING_MS.d20RollAnimation)
    expect(capture.remotePokeballCaptureFeedback.value?.phase).toBe('hit-roll')

    await vi.advanceTimersByTimeAsync(MOVE_AUTOMATION_FEEDBACK_TIMING_MS.hitRollVisible)
    expect(capture.remotePokeballCaptureFeedback.value?.phase).toBe('outcome')

    await vi.advanceTimersByTimeAsync(MOVE_AUTOMATION_FEEDBACK_TIMING_MS.hitResultVisible)
    expect(capture.remotePokeballCaptureFeedback.value).toBeNull()
  })

  it('replays remote capture result modal and miss errors through page-local refs', () => {
    const capture = useMapActionPokeballCapture()

    capture.replayPokeballResult({ result: captureResult, error: null })

    expect(capture.remotePokeballCaptureResult.value).toEqual(captureResult)
    expect(capture.remotePokeballCaptureError.value).toBeNull()

    capture.replayPokeballResult({ result: null, error: 'The Poké Ball missed.' })

    expect(capture.remotePokeballCaptureResult.value).toBeNull()
    expect(capture.remotePokeballCaptureError.value).toBe('The Poké Ball missed.')
  })
})
