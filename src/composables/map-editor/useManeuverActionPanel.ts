import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  maneuverOptionsForPlacement,
  type TokenManeuverMenuOption,
} from '~/utils/mapTokenManeuvers'
import {
  appendManeuverLogEntry,
  buildManeuverUseLogLines,
  DEFAULT_MANEUVER_LOG_ENTRIES,
} from '~/utils/maneuverLog'
import {
  moveAutomationTargetsInRange,
  parseSingleTargetMoveRangeMeters,
} from '~/utils/moveAutomationRange'
import type { MoveAutomationTargetingOverlayState } from '~/types/moveAutomation'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

type SheetMapRef<T> = Ref<Map<string, T> | undefined>

export interface ManeuverActionEvent {
  userId: string
  maneuverName: string
}

export interface UseManeuverActionPanelOptions {
  map: Ref<TabletopMap | null>
  spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  trainerBySlug: SheetMapRef<TrainerSheet>
  canControlPlacement: (id: string) => boolean
  onBeforeManeuverAction?: (event: ManeuverActionEvent) => void
  now?: () => number
  maxLogEntries?: number
}

interface ActiveManeuverTargetingRequest {
  userId: string
  maneuverName: string
  maneuver: TokenManeuverMenuOption
  targetLabel: string
  rangeMeters: number | null
}

const hasSelfRange = (range: string | null | undefined): boolean => /\bSelf\b/i.test(range ?? '')

const rangeImpliesTarget = (range: string | null | undefined): boolean => {
  const text = range?.trim()
  if (!text || hasSelfRange(text)) return false
  return /\bTarget\b|\bMelee\b|\b\d+\b/i.test(text)
}

const maneuverTargetLabel = (maneuver: TokenManeuverMenuOption): string | null =>
  rangeImpliesTarget(maneuver.range) ? maneuver.range : null

export const useManeuverActionPanel = ({
  map,
  spawnedPokemon,
  trainerBySlug,
  canControlPlacement,
  onBeforeManeuverAction,
  now,
  maxLogEntries = DEFAULT_MANEUVER_LOG_ENTRIES,
}: UseManeuverActionPanelOptions) => {
  const activeManeuverTargeting = ref<ActiveManeuverTargetingRequest | null>(null)

  const maneuverOptionsForId = (id: string | null | undefined): TokenManeuverMenuOption[] => {
    if (!map.value || !id) return []
    return maneuverOptionsForPlacement(
      map.value.placements.find((item) => item.id === id),
      { trainer: trainerBySlug.value },
    )
  }

  const findSpawnedPokemon = (id: string | null | undefined): SpawnedPokemon | null =>
    id ? spawnedPokemon.value.find((pokemon) => pokemon.id === id) ?? null : null

  const tokenManeuverOptionsById = computed(() => {
    const out: Record<string, TokenManeuverMenuOption[]> = {}
    if (!map.value) return out
    for (const token of spawnedPokemon.value) out[token.id] = maneuverOptionsForId(token.id)
    return out
  })

  const maneuverOptionForUse = (
    id: string,
    maneuverName: string,
  ): TokenManeuverMenuOption | null => {
    const normalizedManeuverName = maneuverName.trim().toLocaleLowerCase()
    if (!normalizedManeuverName) return null
    return tokenManeuverOptionsById.value[id]?.find((option) =>
      option.name.toLocaleLowerCase() === normalizedManeuverName,
    ) ?? null
  }

  const rangeMetersForManeuver = (
    user: SpawnedPokemon,
    maneuver: TokenManeuverMenuOption,
  ): number | null => parseSingleTargetMoveRangeMeters(maneuver.range, {
    focusSkillRankValue: user.focusSkillRankValue,
  })

  const targetCandidatesForManeuver = (
    user: SpawnedPokemon,
    rangeMeters: number | null,
  ): SpawnedPokemon[] => {
    if (rangeMeters == null) return spawnedPokemon.value.filter((token) => token.id !== user.id)
    return moveAutomationTargetsInRange({ user, tokens: spawnedPokemon.value, rangeMeters })
  }

  const maneuverActionTargeting = computed<MoveAutomationTargetingOverlayState | null>(() => {
    const request = activeManeuverTargeting.value
    const user = findSpawnedPokemon(request?.userId)
    if (!request || !user || !canControlPlacement(request.userId)) return null
    const candidates = targetCandidatesForManeuver(user, request.rangeMeters)
    return {
      userId: request.userId,
      moveName: request.maneuverName,
      mode: 'target',
      rangeLabel: request.targetLabel,
      rangeMeters: request.rangeMeters ?? 0,
      targetPrompt: `Choose a target for ${request.maneuverName} (${request.targetLabel}).`,
      candidateIds: candidates.map((token) => token.id),
    }
  })

  const performManeuverUse = (
    user: SpawnedPokemon,
    maneuver: TokenManeuverMenuOption,
    target: SpawnedPokemon | null = null,
  ): boolean => {
    if (!map.value || !canControlPlacement(user.id)) return false

    onBeforeManeuverAction?.({ userId: user.id, maneuverName: maneuver.name })
    map.value.metadata = appendManeuverLogEntry(map.value.metadata, {
      userId: user.id,
      userName: user.species,
      maneuverName: maneuver.name,
      lines: buildManeuverUseLogLines(user, maneuver, { target }),
    }, {
      now,
      maxLogEntries,
    })
    return true
  }

  const useManeuver = (input: { id: string; maneuverName?: string | null }): boolean => {
    if (!map.value || !canControlPlacement(input.id)) return false
    const maneuverName = input.maneuverName?.trim()
    if (!maneuverName) return false

    const user = findSpawnedPokemon(input.id)
    const maneuver = maneuverOptionForUse(input.id, maneuverName)
    if (!user || !maneuver) return false

    const targetLabel = maneuverTargetLabel(maneuver)
    if (targetLabel) {
      activeManeuverTargeting.value = {
        userId: user.id,
        maneuverName: maneuver.name,
        maneuver,
        targetLabel,
        rangeMeters: rangeMetersForManeuver(user, maneuver),
      }
      return true
    }

    activeManeuverTargeting.value = null
    return performManeuverUse(user, maneuver)
  }

  const cancelManeuverActionTargeting = () => {
    activeManeuverTargeting.value = null
  }

  const selectManeuverActionTarget = (targetId: string): boolean => {
    const request = activeManeuverTargeting.value
    const overlay = maneuverActionTargeting.value
    if (!request || !overlay?.candidateIds.includes(targetId)) return false

    const user = findSpawnedPokemon(request.userId)
    const target = findSpawnedPokemon(targetId)
    if (!user || !target) return false

    activeManeuverTargeting.value = null
    return performManeuverUse(user, request.maneuver, target)
  }

  return {
    maneuverActionTargeting,
    tokenManeuverOptionsById,
    useManeuver,
    cancelManeuverActionTargeting,
    selectManeuverActionTarget,
  }
}
