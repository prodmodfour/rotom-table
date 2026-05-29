import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
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
import type { MoveAutomationTargetingOverlayState } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

type SheetMapRef<T> = Ref<Map<string, T> | undefined>
type MaybePromise<T> = T | Promise<T>

export interface UsePokeballCapturePanelOptions {
  map: Ref<TabletopMap | null>
  spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  pokemonBySlug: SheetMapRef<CharacterSheet>
  trainerBySlug: SheetMapRef<TrainerSheet>
  canControlPlacement: (id: string) => boolean
  applyCaptureOutcome?: (event: PokeballCaptureOutcomeEvent) => MaybePromise<void>
  now?: () => number
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
  now,
}: UsePokeballCapturePanelOptions) => {
  const activePokeballCapture = ref<ActivePokeballCaptureRequest | null>(null)
  const pokeballCaptureResult = ref<PokeballCaptureAttemptResult | null>(null)
  const pokeballCaptureError = ref<string | null>(null)

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

  const selectPokeballCaptureTarget = (targetId: string) => {
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
      pokeballCaptureError.value = `${request.pokeball.name} is no longer available.`
      activePokeballCapture.value = null
      return
    }

    const result = resolvePokeballCaptureAttempt({
      trainer,
      user,
      target,
      targetSheet: pokemonSheetForToken(target),
      pokeball: livePokeball,
      pokemonBySlug: pokemonBySlug.value,
      currentRound: map.value?.initiative?.round ?? null,
      now,
    })

    activePokeballCapture.value = null
    pokeballCaptureResult.value = result.hit ? result : null
    pokeballCaptureError.value = result.hit ? null : (result.failureReason ?? 'The Poké Ball missed.')

    if (applyCaptureOutcome) {
      void Promise.resolve(applyCaptureOutcome({
        trainerId: request.trainerId,
        targetId,
        targetSlug: target.sheetSlug,
        pokeballName: livePokeball.name,
        result,
      })).catch((error) => {
        pokeballCaptureError.value = getErrorMessage(error, { fallback: 'Poké Ball inventory update failed' })
      })
    }
  }

  const dismissPokeballCaptureResult = () => {
    pokeballCaptureResult.value = null
  }

  return {
    pokeballCaptureTargeting,
    pokeballCaptureResult,
    pokeballCaptureError,
    tokenPokeballOptionsById,
    openPokeballCapture,
    selectPokeballCaptureTarget,
    cancelPokeballCaptureTargeting,
    dismissPokeballCaptureResult,
  }
}
