import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import {
  appendPokeballCaptureLogEntry,
  buildPokeballCaptureBreakdown,
  buildTrainerPokeballOptions,
  linkedPokemonSlugSet,
  resolvePokeballCaptureAttempt,
  trainerThrowingRangeMeters,
  unlinkedPokemonTargetsInPokeballRange,
  type PokeballCaptureAttemptResult,
  type PokeballCaptureOutcomeEvent,
  type TokenPokeballOption,
} from '~/utils/pokeballCapture'
import { getErrorMessage } from '~/utils/errorMessages'
import type { CharacterSheet } from '~/types/characterSheet'
import type { MoveAutomationFeedbackState, MoveAutomationTargetingOverlayState } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

type SheetMapRef<T> = Ref<Map<string, T> | undefined>
type MaybePromise<T> = T | Promise<T>

const D20_ROLL_ANIMATION_MS = 650
const HIT_ROLL_VISIBLE_MS = 850
const HIT_RESULT_VISIBLE_MS = 600

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> => (
  value !== null
  && (typeof value === 'object' || typeof value === 'function')
  && typeof (value as { then?: unknown }).then === 'function'
)

const warnPokeballThrowNotificationFailure = (error: unknown) => {
  console.warn('[usePokeballCapturePanel] Poké Ball throw notification failed', error)
}

const warnPokeballCaptureCallbackFailure = (stage: string, error: unknown) => {
  console.warn(`[usePokeballCapturePanel] ${stage} callback failed`, error)
}

const notifyPokeballCaptureCallback = <TEvent>(
  stage: string,
  callback: ((event: TEvent) => MaybePromise<unknown>) | undefined,
  event: TEvent,
) => {
  if (!callback) return

  try {
    void Promise.resolve(callback(event)).catch((error) => {
      warnPokeballCaptureCallbackFailure(stage, error)
    })
  } catch (error) {
    warnPokeballCaptureCallbackFailure(stage, error)
  }
}

export interface PokeballThrowVisualEvent {
  userId: string
  targetId: string
  pokeballName: string
  resultId: string
}

export interface PokeballCaptureFeedbackEvent {
  feedback: MoveAutomationFeedbackState
}

export interface PokeballCaptureResultVisualEvent {
  trainerId: string
  result: PokeballCaptureAttemptResult | null
  error?: string | null
}

export interface UsePokeballCapturePanelOptions {
  map: Ref<TabletopMap | null>
  spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  pokemonBySlug: SheetMapRef<CharacterSheet>
  trainerBySlug: SheetMapRef<TrainerSheet>
  canControlPlacement: (id: string) => boolean
  applyCaptureOutcome?: (event: PokeballCaptureOutcomeEvent) => MaybePromise<void>
  onBeforePokeballThrow?: (event: { userId: string; pokeballName: string }) => MaybePromise<unknown>
  onPokeballThrow?: (event: PokeballThrowVisualEvent) => MaybePromise<unknown>
  onPokeballFeedback?: (event: PokeballCaptureFeedbackEvent) => MaybePromise<unknown>
  onPokeballResult?: (event: PokeballCaptureResultVisualEvent) => MaybePromise<unknown>
  now?: () => number
  maxLogEntries?: number
}

interface ActivePokeballCaptureRequest {
  trainerId: string
  pokeball: TokenPokeballOption
  rangeMeters: number
}

export const usePokeballCapturePanel = ({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canControlPlacement,
  applyCaptureOutcome,
  onBeforePokeballThrow,
  onPokeballThrow,
  onPokeballFeedback,
  onPokeballResult,
  now,
  maxLogEntries,
}: UsePokeballCapturePanelOptions) => {
  const activePokeballCapture = ref<ActivePokeballCaptureRequest | null>(null)
  const pokeballCaptureResult = ref<PokeballCaptureAttemptResult | null>(null)
  const pokeballCaptureFeedback = ref<MoveAutomationFeedbackState | null>(null)
  const pokeballCaptureError = ref<string | null>(null)
  const feedbackTimers: Array<ReturnType<typeof setTimeout>> = []
  let pendingCaptureOutcomeApplier: (() => void) | null = null

  const findToken = (id: string | null | undefined): SpawnedPokemon | null => (
    id ? spawnedPokemon.value.find((token) => token.id === id) ?? null : null
  )

  const trainerSheetForToken = (token: SpawnedPokemon | null | undefined): TrainerSheet | null => {
    if (!token || token.sheetKind !== 'trainer') return null
    return trainerBySlug.value?.get(token.sheetSlug) ?? null
  }

  const pokemonSheetForToken = (token: SpawnedPokemon | null | undefined): CharacterSheet | null => {
    if (!token || token.sheetKind !== 'pokemon') return null
    return pokemonBySlug.value?.get(token.sheetSlug) ?? null
  }

  const tokenPokeballOptionsById = computed<Record<string, TokenPokeballOption[]>>(() => {
    const out: Record<string, TokenPokeballOption[]> = {}
    for (const token of spawnedPokemon.value) {
      if (token.sheetKind !== 'trainer') continue
      const sheet = trainerSheetForToken(token)
      if (!sheet) continue
      out[token.id] = buildTrainerPokeballOptions(sheet)
    }
    return out
  })

  const findPokeballOption = (trainerId: string, pokeballName: string | null | undefined): TokenPokeballOption | null => {
    const name = pokeballName?.trim()
    if (!name) return null
    return tokenPokeballOptionsById.value[trainerId]?.find((option) => option.name === name) ?? null
  }

  const linkedSlugs = computed(() => linkedPokemonSlugSet(trainerBySlug.value?.values() ?? []))

  const clearFeedbackTimers = () => {
    while (feedbackTimers.length) {
      const timer = feedbackTimers.pop()
      if (timer) clearTimeout(timer)
    }
  }

  const pokeballCaptureFeedbackForResult = (result: PokeballCaptureAttemptResult): MoveAutomationFeedbackState => ({
    id: result.id,
    userId: result.trainerId,
    targetId: result.targetId,
    moveName: `Throw ${result.pokeballName}`,
    phase: 'rolling',
    naturalRoll: result.accuracyRoll,
    modifiedRoll: result.modifiedAccuracyRoll,
    accuracyCheck: result.accuracyCheck,
    userAccuracy: result.userAccuracy,
    targetEvasion: result.targetEvasion,
    targetEvasionLabel: result.targetEvasionLabel,
    hit: result.hit,
    crit: false,
    effectiveness: null,
    damageResolved: false,
    damageLoss: 0,
    conditions: [],
  })

  const appendPokeballCaptureLog = (event: PokeballCaptureOutcomeEvent) => {
    if (!map.value) return
    map.value.metadata = appendPokeballCaptureLogEntry(map.value.metadata, event, {
      now,
      maxLogEntries,
    })
  }

  const revealPokeballCaptureResult = (event: PokeballCaptureOutcomeEvent) => {
    appendPokeballCaptureLog(event)
    const visibleResult = event.result.hit ? event.result : null
    const visibleError = event.result.hit ? null : (event.result.failureReason ?? 'The Poké Ball missed.')
    pokeballCaptureResult.value = visibleResult
    pokeballCaptureError.value = visibleError
    notifyPokeballCaptureCallback('result', onPokeballResult, {
      trainerId: event.trainerId,
      result: visibleResult,
      error: visibleError,
    })

    if (applyCaptureOutcome) {
      void Promise.resolve(applyCaptureOutcome(event)).catch((error) => {
        const errorMessage = getErrorMessage(error, { fallback: 'Poké Ball inventory update failed' })
        pokeballCaptureError.value = errorMessage
        notifyPokeballCaptureCallback('result', onPokeballResult, {
          trainerId: event.trainerId,
          result: visibleResult,
          error: errorMessage,
        })
      })
    }
  }

  const flushPendingCaptureOutcome = () => {
    const apply = pendingCaptureOutcomeApplier
    pendingCaptureOutcomeApplier = null
    apply?.()
  }

  const showPokeballCaptureResolution = (event: PokeballCaptureOutcomeEvent) => {
    flushPendingCaptureOutcome()
    clearFeedbackTimers()

    const feedback = pokeballCaptureFeedbackForResult(event.result)
    let outcomeApplied = false
    const feedbackStillCurrent = () => pokeballCaptureFeedback.value?.id === feedback.id
    const setFeedbackPhase = (phase: MoveAutomationFeedbackState['phase']): boolean => {
      if (!feedbackStillCurrent()) return false
      pokeballCaptureFeedback.value = { ...feedback, phase }
      return true
    }
    const applyOutcomeOnce = () => {
      if (outcomeApplied) return
      outcomeApplied = true
      pendingCaptureOutcomeApplier = null
      clearFeedbackTimers()
      pokeballCaptureFeedback.value = null
      revealPokeballCaptureResult(event)
    }
    const scheduleFeedbackStep = (delay: number, step: () => void) => {
      feedbackTimers.push(setTimeout(step, delay))
    }

    pendingCaptureOutcomeApplier = applyOutcomeOnce
    pokeballCaptureFeedback.value = feedback
    notifyPokeballCaptureCallback('feedback', onPokeballFeedback, { feedback })
    scheduleFeedbackStep(D20_ROLL_ANIMATION_MS, () => {
      setFeedbackPhase('hit-roll')
    })

    const outcomeDelay = D20_ROLL_ANIMATION_MS + HIT_ROLL_VISIBLE_MS
    scheduleFeedbackStep(outcomeDelay, () => {
      setFeedbackPhase('outcome')
    })
    scheduleFeedbackStep(outcomeDelay + HIT_RESULT_VISIBLE_MS, () => {
      if (feedbackStillCurrent()) applyOutcomeOnce()
    })
  }

  const clearPokeballCaptureFeedback = () => {
    flushPendingCaptureOutcome()
    clearFeedbackTimers()
    pokeballCaptureFeedback.value = null
  }

  const targetsForRequest = (request: ActivePokeballCaptureRequest | null): SpawnedPokemon[] => {
    if (!request) return []
    const user = findToken(request.trainerId)
    if (!user) return []
    return unlinkedPokemonTargetsInPokeballRange({
      user,
      tokens: spawnedPokemon.value,
      rangeMeters: request.rangeMeters,
      linkedSlugs: linkedSlugs.value,
    })
  }

  const pokeballCaptureTargeting = computed<MoveAutomationTargetingOverlayState | null>(() => {
    const request = activePokeballCapture.value
    if (!request) return null

    const user = findToken(request.trainerId)
    const trainer = trainerSheetForToken(user)
    if (!user || !trainer) return null

    const targets = targetsForRequest(request)
    const hitChances = Object.fromEntries(targets.map((target) => {
      const breakdown = buildPokeballCaptureBreakdown({
        trainer,
        user,
        target,
        targetSheet: pokemonSheetForToken(target),
        pokeball: request.pokeball,
        pokemonBySlug: pokemonBySlug.value,
        currentRound: map.value?.initiative?.round ?? null,
      })
      return [target.id, breakdown.hitChance]
    }))

    return {
      userId: request.trainerId,
      moveName: `Throw ${request.pokeball.name}`,
      mode: 'target',
      rangeLabel: `${request.rangeMeters}m Throwing Range`,
      rangeMeters: request.rangeMeters,
      targetPrompt: `Choose an unlinked Pokémon within ${request.rangeMeters}m. Percent is chance to hit and capture.`,
      candidateIds: targets.map((target) => target.id),
      hitChances,
    }
  })

  const openPokeballCapture = (payload: { id: string; pokeballName?: string | null }) => {
    clearPokeballCaptureFeedback()
    pokeballCaptureError.value = null
    pokeballCaptureResult.value = null
    if (!canControlPlacement(payload.id)) return

    const user = findToken(payload.id)
    const trainer = trainerSheetForToken(user)
    if (!user || !trainer) return

    const pokeball = findPokeballOption(payload.id, payload.pokeballName)
    if (!pokeball) {
      pokeballCaptureError.value = 'Choose a Poké Ball with quantity remaining.'
      return
    }

    activePokeballCapture.value = {
      trainerId: payload.id,
      pokeball,
      rangeMeters: trainerThrowingRangeMeters(trainer),
    }
  }

  const cancelPokeballCaptureTargeting = () => {
    activePokeballCapture.value = null
  }

  const selectPokeballCaptureTarget = async (targetId: string) => {
    const request = activePokeballCapture.value
    if (!request) return

    const user = findToken(request.trainerId)
    const trainer = trainerSheetForToken(user)
    const target = findToken(targetId)
    if (!user || !trainer || !target) return

    const validTargets = targetsForRequest(request)
    if (!validTargets.some((candidate) => candidate.id === targetId)) return

    const livePokeball = findPokeballOption(request.trainerId, request.pokeball.name)
    if (!livePokeball) {
      const errorMessage = `${request.pokeball.name} is no longer available.`
      pokeballCaptureError.value = errorMessage
      activePokeballCapture.value = null
      notifyPokeballCaptureCallback('result', onPokeballResult, {
        trainerId: request.trainerId,
        result: null,
        error: errorMessage,
      })
      return
    }

    try {
      const notification = onBeforePokeballThrow?.({ userId: user.id, pokeballName: livePokeball.name })
      if (isPromiseLike(notification)) await notification
    } catch (error) {
      warnPokeballThrowNotificationFailure(error)
    }
    if (activePokeballCapture.value !== request || !canControlPlacement(request.trainerId)) return

    const currentUser = findToken(request.trainerId)
    const currentTrainer = trainerSheetForToken(currentUser)
    const currentTarget = findToken(targetId)
    const currentPokeball = findPokeballOption(request.trainerId, livePokeball.name)
    if (!currentUser || !currentTrainer || !currentTarget || !currentPokeball) return

    const result = resolvePokeballCaptureAttempt({
      trainer: currentTrainer,
      user: currentUser,
      target: currentTarget,
      targetSheet: pokemonSheetForToken(currentTarget),
      pokeball: currentPokeball,
      pokemonBySlug: pokemonBySlug.value,
      currentRound: map.value?.initiative?.round ?? null,
      now,
    })

    activePokeballCapture.value = null
    pokeballCaptureResult.value = null
    pokeballCaptureError.value = null
    notifyPokeballCaptureCallback('throw', onPokeballThrow, {
      userId: request.trainerId,
      targetId,
      pokeballName: currentPokeball.name,
      resultId: result.id,
    })
    showPokeballCaptureResolution({
      trainerId: request.trainerId,
      targetId,
      targetSlug: currentTarget.sheetSlug,
      pokeballName: currentPokeball.name,
      result,
    })
  }

  const dismissPokeballCaptureResult = () => {
    pokeballCaptureResult.value = null
  }

  onBeforeUnmount(() => {
    flushPendingCaptureOutcome()
    clearFeedbackTimers()
  })

  return {
    pokeballCaptureTargeting,
    pokeballCaptureResult,
    pokeballCaptureFeedback,
    pokeballCaptureError,
    tokenPokeballOptionsById,
    openPokeballCapture,
    selectPokeballCaptureTarget,
    cancelPokeballCaptureTargeting,
    dismissPokeballCaptureResult,
  }
}
