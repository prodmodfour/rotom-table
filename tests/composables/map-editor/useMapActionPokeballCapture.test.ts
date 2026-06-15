import { computed, ref } from 'vue'
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

const escapeResult = {
  ...captureResult,
  id: 'capture-trainer-pidgey-200',
  success: false,
  shakeCount: 1,
  captureRoll: 92,
  adjustedCaptureRoll: 92,
  naturalTwentyCaptureBonus: 0,
  naturalCaptureSuccess: false,
  failureReason: 'The Pokémon broke free.',
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
    expect(publishPokeballResult.mock.calls[0]?.[0].result).toBe(captureResult)
    expect(publishPokeballResult.mock.calls[0]?.[0].result).toMatchObject({
      id: captureResult.id,
      trainerId: 'trainer',
      targetId: 'pidgey',
      targetName: 'Pidgey',
      pokeballName: 'Basic Ball',
      success: true,
      hit: true,
      breakdown: captureResult.breakdown,
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

  it('replays remote capture result modal and miss errors through page-local refs without publishing or mechanics', () => {
    const enqueueAndBroadcastMoveAnimations = vi.fn()
    const publishPokeballFeedback = vi.fn()
    const publishPokeballResult = vi.fn()
    const capture = useMapActionPokeballCapture({
      enqueueAndBroadcastMoveAnimations,
      publishPokeballFeedback,
      publishPokeballResult,
    })

    capture.replayPokeballResult({ result: captureResult, error: null })

    expect(capture.remotePokeballCaptureResult.value).toEqual(captureResult)
    expect(capture.remotePokeballCaptureError.value).toBeNull()
    expect(enqueueAndBroadcastMoveAnimations).not.toHaveBeenCalled()
    expect(publishPokeballFeedback).not.toHaveBeenCalled()
    expect(publishPokeballResult).not.toHaveBeenCalled()

    capture.replayPokeballResult({ result: null, error: 'The Poké Ball missed.' })

    expect(capture.remotePokeballCaptureResult.value).toBeNull()
    expect(capture.remotePokeballCaptureError.value).toBe('The Poké Ball missed.')
  })

  it('makes a remote pokeball-result truthy for the page display and replaces it with the latest result', () => {
    const capture = useMapActionPokeballCapture()
    const localResult = ref<PokeballCaptureAttemptResult | null>(null)
    const displayedPokeballCaptureResult = computed(() => (
      localResult.value ?? capture.remotePokeballCaptureResult.value
    ))

    capture.replayPokeballResult({ result: captureResult, error: null })

    expect(displayedPokeballCaptureResult.value).toEqual(captureResult)
    expect(displayedPokeballCaptureResult.value?.id).toBe('capture-trainer-pidgey-100')

    capture.replayPokeballResult({ result: escapeResult, error: null })

    expect(capture.remotePokeballCaptureResult.value).toEqual(escapeResult)
    expect(displayedPokeballCaptureResult.value).toEqual(escapeResult)
    expect(displayedPokeballCaptureResult.value?.id).toBe('capture-trainer-pidgey-200')
  })

  it('keeps local and remote modal dismissal page-local', () => {
    const firstViewer = useMapActionPokeballCapture()
    const secondViewer = useMapActionPokeballCapture()

    firstViewer.replayPokeballResult({ result: captureResult, error: null })
    secondViewer.replayPokeballResult({ result: captureResult, error: null })

    firstViewer.dismissRemotePokeballCaptureResult()

    expect(firstViewer.remotePokeballCaptureResult.value).toBeNull()
    expect(secondViewer.remotePokeballCaptureResult.value).toEqual(captureResult)

    const localResult = ref<PokeballCaptureAttemptResult | null>(captureResult)
    const displayedPokeballCaptureResult = computed(() => (
      localResult.value ?? firstViewer.remotePokeballCaptureResult.value
    ))

    firstViewer.replayPokeballResult({ result: escapeResult, error: null })
    expect(displayedPokeballCaptureResult.value).toEqual(captureResult)

    localResult.value = null
    expect(displayedPokeballCaptureResult.value).toEqual(escapeResult)

    firstViewer.dismissRemotePokeballCaptureResult()
    expect(displayedPokeballCaptureResult.value).toBeNull()
  })

  it('preserves an already-visible remote result when only transient feedback is cleared', () => {
    const capture = useMapActionPokeballCapture()

    capture.replayPokeballResult({ result: captureResult, error: null })
    capture.clearRemotePokeballCaptureFeedback()

    expect(capture.remotePokeballCaptureResult.value).toEqual(captureResult)

    capture.clearRemotePokeballCapture()
    expect(capture.remotePokeballCaptureResult.value).toBeNull()
  })
})
