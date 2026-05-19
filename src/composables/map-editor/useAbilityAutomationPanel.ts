import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  abilityEntriesForPlacement,
  buildTokenAbilityMenuOptions,
  type TokenAbilityMenuOption,
  type TokenSheetAbility,
} from '~/utils/mapTokenAbilities'
import {
  getMapAbilityAutomation,
  mapAbilityTargetCandidates,
  resolveMapAbilityAutomationTransaction,
} from '~/utils/abilityAutomation'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type {
  AbilityAutomationLogEntry,
  AbilityAutomationTransaction,
  AbilitySheetActivationUpdate,
} from '~/types/abilityAutomation'
import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
  MoveAutomationTargetingOverlayState,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const DEFAULT_MAX_LOG_ENTRIES = 100

interface SheetUpdateOptions {
  allowAnyTarget?: boolean
}

type SheetMapRef<T> = Ref<Map<string, T> | undefined>
type MaybePromise<T> = T | Promise<T>

type SheetUpdateHandler<TUpdate> = (
  update: TUpdate,
  options?: SheetUpdateOptions,
) => MaybePromise<void>

export interface UseAbilityAutomationPanelOptions {
  map: Ref<TabletopMap | null>
  spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  pokemonBySlug: SheetMapRef<CharacterSheet>
  trainerBySlug: SheetMapRef<TrainerSheet>
  canControlPlacement: (id: string) => boolean
  modifyCombatStages: SheetUpdateHandler<MoveAutomationCombatStageUpdate>
  modifyConditions: SheetUpdateHandler<MoveAutomationConditionUpdate>
  modifyAbilityActivation: SheetUpdateHandler<AbilitySheetActivationUpdate>
  now?: () => number
  maxLogEntries?: number
}

interface ActiveAbilityTargetingRequest {
  userId: string
  abilityName: string
  rangeLabel: string
  rangeMeters: number
}

export const appendAbilityAutomationLogEntry = (
  metadata: Record<string, unknown> | undefined,
  transaction: AbilityAutomationTransaction,
  options: { now?: () => number; maxLogEntries?: number } = {},
): Record<string, unknown> => {
  const next = { ...(metadata ?? {}) }
  const previous = Array.isArray(next.abilityLog) ? next.abilityLog : []
  const entry: AbilityAutomationLogEntry = {
    at: options.now?.() ?? Date.now(),
    userId: transaction.userId,
    userName: transaction.userName,
    abilityName: transaction.abilityName,
    category: transaction.category,
    lines: transaction.logLines,
  }
  next.abilityLog = [...previous, entry].slice(-(options.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES))
  return next
}

export const useAbilityAutomationPanel = ({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canControlPlacement,
  modifyCombatStages,
  modifyConditions,
  modifyAbilityActivation,
  now,
  maxLogEntries = DEFAULT_MAX_LOG_ENTRIES,
}: UseAbilityAutomationPanelOptions) => {
  const activeAbilityTargeting = ref<ActiveAbilityTargetingRequest | null>(null)

  const sheetLookup = () => ({
    pokemon: pokemonBySlug.value,
    trainer: trainerBySlug.value,
  })

  const abilityEntriesForId = (id: string | null | undefined): TokenSheetAbility[] => {
    if (!map.value || !id) return []
    return abilityEntriesForPlacement(
      map.value.placements.find((item) => item.id === id),
      sheetLookup(),
    )
  }

  const findSpawnedPokemon = (id: string | null | undefined): SpawnedPokemon | null =>
    id ? spawnedPokemon.value.find((pokemon) => pokemon.id === id) ?? null : null

  const tokenAbilityOptionsById = computed(() => {
    const out: Record<string, TokenAbilityMenuOption[]> = {}
    if (!map.value) return out
    for (const token of spawnedPokemon.value) {
      out[token.id] = buildTokenAbilityMenuOptions(abilityEntriesForId(token.id))
    }
    return out
  })

  const abilityOptionForUse = (
    id: string,
    abilityName: string,
  ): TokenAbilityMenuOption | null => {
    const normalizedAbilityName = abilityName.trim().toLowerCase()
    if (!normalizedAbilityName) return null
    return tokenAbilityOptionsById.value[id]?.find((option) =>
      option.name.toLowerCase() === normalizedAbilityName,
    ) ?? null
  }

  const abilityAutomationTargeting = computed<MoveAutomationTargetingOverlayState | null>(() => {
    const request = activeAbilityTargeting.value
    const user = findSpawnedPokemon(request?.userId)
    if (!request || !user || !canControlPlacement(request.userId)) return null
    const candidates = mapAbilityTargetCandidates(user, spawnedPokemon.value, request.abilityName)
    return {
      userId: request.userId,
      moveName: request.abilityName,
      rangeLabel: request.rangeLabel,
      rangeMeters: request.rangeMeters,
      candidateIds: candidates.map((candidate) => candidate.id),
    }
  })

  const appendAbilityAutomationLog = (transaction: AbilityAutomationTransaction) => {
    if (!map.value) return
    map.value.metadata = appendAbilityAutomationLogEntry(map.value.metadata, transaction, {
      now,
      maxLogEntries,
    })
  }

  const applyAbilityAutomationTransaction = async (transaction: AbilityAutomationTransaction) => {
    if (!map.value || !canControlPlacement(transaction.userId)) return
    for (const update of transaction.combatStageUpdates) {
      await modifyCombatStages(update, { allowAnyTarget: true })
    }
    for (const update of transaction.conditionUpdates) {
      await modifyConditions(update, { allowAnyTarget: true })
    }
    appendAbilityAutomationLog(transaction)
  }

  const activateSheetAbility = async (
    user: SpawnedPokemon,
    option: TokenAbilityMenuOption,
  ) => {
    await modifyAbilityActivation({
      id: user.id,
      abilityName: option.name,
      activated: true,
    })
    appendAbilityAutomationLog({
      userId: user.id,
      userName: user.species,
      abilityName: option.name,
      category: 'sheet',
      combatStageUpdates: [],
      conditionUpdates: [],
      logLines: [`${user.species} activated ${option.name}.`],
    })
  }

  const applySelfMapAbility = async (
    user: SpawnedPokemon,
    option: TokenAbilityMenuOption,
  ) => {
    const transaction = resolveMapAbilityAutomationTransaction({
      abilityName: option.name,
      user,
      fieldEffects: map.value?.fieldEffects,
    })
    if (transaction) await applyAbilityAutomationTransaction(transaction)
  }

  const beginMapAbilityTargeting = (
    user: SpawnedPokemon,
    option: TokenAbilityMenuOption,
  ) => {
    const mapAutomation = getMapAbilityAutomation(option.name)
    if (!mapAutomation) return
    activeAbilityTargeting.value = {
      userId: user.id,
      abilityName: mapAutomation.name,
      rangeLabel: mapAutomation.rangeLabel,
      rangeMeters: mapAutomation.rangeMeters,
    }
  }

  const openAbilityAutomation = async (input: string | { id: string; abilityName?: string | null }) => {
    const id = typeof input === 'string' ? input : input.id
    if (!canControlPlacement(id)) return
    const abilityName = typeof input === 'string' ? null : input.abilityName?.trim() || null
    if (!abilityName) return

    const user = findSpawnedPokemon(id)
    const option = abilityOptionForUse(id, abilityName)
    if (!user || !option?.automation) return

    activeAbilityTargeting.value = null
    if (option.automation.category === 'passive') return
    if (option.automation.category === 'sheet') {
      if (!option.activated) await activateSheetAbility(user, option)
      return
    }

    const mapAutomation = getMapAbilityAutomation(option.name)
    if (mapAutomation?.targetMode === 'self') {
      await applySelfMapAbility(user, option)
      return
    }

    beginMapAbilityTargeting(user, option)
  }

  const cancelAbilityAutomationTargeting = () => {
    activeAbilityTargeting.value = null
  }

  const selectAbilityAutomationTarget = async (targetId: string) => {
    const request = activeAbilityTargeting.value
    const overlay = abilityAutomationTargeting.value
    if (!request || !overlay?.candidateIds.includes(targetId)) return

    const user = findSpawnedPokemon(request.userId)
    const target = findSpawnedPokemon(targetId)
    if (!user || !target) return

    const transaction = resolveMapAbilityAutomationTransaction({
      abilityName: request.abilityName,
      user,
      target,
      fieldEffects: map.value?.fieldEffects,
    })
    activeAbilityTargeting.value = null
    if (!transaction) return

    await applyAbilityAutomationTransaction(transaction)
  }

  return {
    abilityAutomationTargeting,
    tokenAbilityOptionsById,
    openAbilityAutomation,
    cancelAbilityAutomationTargeting,
    selectAbilityAutomationTarget,
    appendAbilityAutomationLog,
    applyAbilityAutomationTransaction,
  }
}
