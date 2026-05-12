import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  buildTokenMoveMenuOptions,
  moveEntriesForPlacement,
  type TokenSheetMoveEntry,
} from '~/utils/mapTokenMoves'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { MapFieldEffects, MapHazardV2, TabletopMap } from '~/types/map'
import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
  MoveAutomationFieldEffectApply,
  MoveAutomationHpUpdate,
  MoveAutomationLogEntry,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerMove, TrainerSheet } from '~/types/trainerSheet'

interface BooleanRef {
  readonly value: boolean
}

type SheetMapRef<T> = Ref<Map<string, T> | undefined>
type MaybePromise<T> = T | Promise<T>

type SheetUpdateOptions = { allowAnyTarget?: boolean }

type SheetUpdateHandler<TUpdate> = (
  update: TUpdate,
  options?: SheetUpdateOptions,
) => MaybePromise<void>

export interface UseMoveAutomationPanelOptions {
  map: Ref<TabletopMap | null>
  spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  pokemonBySlug: SheetMapRef<CharacterSheet>
  trainerBySlug: SheetMapRef<TrainerSheet>
  canEditMap: BooleanRef
  canControlPlacement: (id: string) => boolean
  modifyHp: SheetUpdateHandler<MoveAutomationHpUpdate>
  modifyCombatStages: SheetUpdateHandler<MoveAutomationCombatStageUpdate>
  modifyConditions: SheetUpdateHandler<MoveAutomationConditionUpdate>
  applyMoveFieldEffect: (effect: MoveAutomationFieldEffectApply) => MaybePromise<void>
  placeHazard: (hazard: MapHazardV2) => MaybePromise<void>
  now?: () => number
  maxLogEntries?: number
}

const DEFAULT_MAX_LOG_ENTRIES = 100

export const appendMoveAutomationLogEntry = (
  metadata: Record<string, unknown> | undefined,
  transaction: MoveAutomationTransaction,
  options: { now?: () => number; maxLogEntries?: number } = {},
): Record<string, unknown> => {
  const next = { ...(metadata ?? {}) }
  const previous = Array.isArray(next.moveLog) ? next.moveLog : []
  const entry: MoveAutomationLogEntry = {
    at: options.now?.() ?? Date.now(),
    userId: transaction.userId,
    userName: transaction.userName,
    moveName: transaction.moveName,
    scriptKind: transaction.scriptKind,
    scriptVersion: transaction.scriptVersion,
    lines: transaction.logLines,
  }
  next.moveLog = [...previous, entry].slice(-(options.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES))
  return next
}

export const useMoveAutomationPanel = ({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canEditMap,
  canControlPlacement,
  modifyHp,
  modifyCombatStages,
  modifyConditions,
  applyMoveFieldEffect,
  placeHazard,
  now,
  maxLogEntries = DEFAULT_MAX_LOG_ENTRIES,
}: UseMoveAutomationPanelOptions) => {
  const moveAutomationId = ref<string | null>(null)
  const moveAutomationInitialMoveName = ref<string | null>(null)

  const moveAutomationUser = computed(() =>
    moveAutomationId.value
      ? spawnedPokemon.value.find((pokemon) => pokemon.id === moveAutomationId.value) ?? null
      : null,
  )

  const sheetLookup = () => ({
    pokemon: pokemonBySlug.value,
    trainer: trainerBySlug.value,
  })

  const moveEntriesForId = (id: string | null | undefined): TokenSheetMoveEntry[] => {
    if (!map.value || !id) return []
    return moveEntriesForPlacement(
      map.value.placements.find((item) => item.id === id),
      sheetLookup(),
    )
  }

  const moveAutomationMoves = computed<Array<CharacterSheetMove | TrainerMove>>(() =>
    moveEntriesForId(moveAutomationId.value).map((entry) => entry.move),
  )

  const tokenMoveOptionsById = computed(() => {
    const out: Record<string, ReturnType<typeof buildTokenMoveMenuOptions>> = {}
    if (!map.value) return out
    for (const token of spawnedPokemon.value) {
      out[token.id] = buildTokenMoveMenuOptions(token, moveEntriesForId(token.id))
    }
    return out
  })

  const openMoveAutomation = (input: string | { id: string; moveName?: string | null }) => {
    const id = typeof input === 'string' ? input : input.id
    if (!canControlPlacement(id)) return
    moveAutomationId.value = id
    moveAutomationInitialMoveName.value = typeof input === 'string' ? null : input.moveName?.trim() || null
  }

  const closeMoveAutomation = () => {
    moveAutomationId.value = null
    moveAutomationInitialMoveName.value = null
  }

  const appendMoveAutomationLog = (transaction: MoveAutomationTransaction) => {
    if (!map.value) return
    map.value.metadata = appendMoveAutomationLogEntry(map.value.metadata, transaction, {
      now,
      maxLogEntries,
    })
  }

  const applyMoveAutomation = async (transaction: MoveAutomationTransaction) => {
    if (!map.value || !canControlPlacement(transaction.userId)) return
    for (const update of transaction.hpUpdates) await modifyHp(update, { allowAnyTarget: true })
    for (const update of transaction.combatStageUpdates) await modifyCombatStages(update, { allowAnyTarget: true })
    for (const update of transaction.conditionUpdates) await modifyConditions(update, { allowAnyTarget: true })
    if (canEditMap.value) {
      for (const effect of transaction.fieldEffectsToApply) await applyMoveFieldEffect(effect)
      for (const hazard of transaction.hazardsToAdd) await placeHazard(hazard)
    }
    appendMoveAutomationLog(transaction)
    closeMoveAutomation()
  }

  return {
    moveAutomationId,
    moveAutomationUser,
    moveAutomationMoves,
    moveAutomationInitialMoveName,
    tokenMoveOptionsById,
    openMoveAutomation,
    closeMoveAutomation,
    appendMoveAutomationLog,
    applyMoveAutomation,
  }
}

export type { SheetUpdateOptions }
