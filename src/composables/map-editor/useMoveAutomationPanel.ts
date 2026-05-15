import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import {
  buildTokenMoveMenuOptions,
  moveEntriesForPlacement,
  type TokenSheetMoveEntry,
} from '~/utils/mapTokenMoves'
import {
  damageFormulaForMove,
  isSeamlessSingleTargetAttackScript,
} from '~/utils/moveAutomation'
import { buildMoveAutomationMoveEntries } from '~/utils/moveAutomationMoves'
import { resolveInstantMoveAutomation } from '~/utils/moveAutomationInstant'
import {
  moveAutomationTargetsInRange,
  parseSingleTargetMoveRangeMeters,
} from '~/utils/moveAutomationRange'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { MapFieldEffects, MapHazardV2, TabletopMap } from '~/types/map'
import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
  MoveAutomationFieldEffectApply,
  MoveAutomationHpUpdate,
  MoveAutomationFeedbackState,
  MoveAutomationLogEntry,
  MoveAutomationScript,
  MoveAutomationTargetingOverlayState,
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
const D20_ROLL_ANIMATION_MS = 850
const ROLL_RESULT_VISIBLE_MS = 1600

interface ActiveMoveTargetingRequest {
  userId: string
  moveName: string
  script: MoveAutomationScript
  damageFormula: string
  rangeMeters: number
}

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
  const activeMoveTargeting = ref<ActiveMoveTargetingRequest | null>(null)
  const moveAutomationFeedback = ref<MoveAutomationFeedbackState | null>(null)
  const feedbackTimers: Array<ReturnType<typeof setTimeout>> = []

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

  const findSpawnedPokemon = (id: string | null | undefined): SpawnedPokemon | null =>
    id ? spawnedPokemon.value.find((pokemon) => pokemon.id === id) ?? null : null

  const moveAutomationEntryForUse = (id: string, moveName: string) => {
    const user = findSpawnedPokemon(id)
    if (!user) return null
    const normalizedMoveName = moveName.trim().toLowerCase()
    const moves = moveEntriesForId(id).map((entry) => entry.move)
    return buildMoveAutomationMoveEntries(moves, {
      stabTypes: user.sheetKind === 'pokemon' ? user.defenderTypes : [],
      combatSkillRankValue: user.combatSkillRankValue,
    }).find((entry) =>
      entry.move.name.toLowerCase() === normalizedMoveName
        || entry.sheetMove.name.toLowerCase() === normalizedMoveName,
    ) ?? null
  }

  const moveAutomationTargeting = computed<MoveAutomationTargetingOverlayState | null>(() => {
    const request = activeMoveTargeting.value
    const user = findSpawnedPokemon(request?.userId)
    if (!request || !user || !canControlPlacement(request.userId)) return null
    const candidates = moveAutomationTargetsInRange({
      user,
      tokens: spawnedPokemon.value,
      rangeMeters: request.rangeMeters,
    })
    return {
      userId: request.userId,
      moveName: request.moveName,
      rangeLabel: `${request.rangeMeters}m`,
      rangeMeters: request.rangeMeters,
      candidateIds: candidates.map((candidate) => candidate.id),
    }
  })

  const tokenMoveOptionsById = computed(() => {
    const out: Record<string, ReturnType<typeof buildTokenMoveMenuOptions>> = {}
    if (!map.value) return out
    for (const token of spawnedPokemon.value) {
      out[token.id] = buildTokenMoveMenuOptions(token, moveEntriesForId(token.id))
    }
    return out
  })

  const clearFeedbackTimers = () => {
    while (feedbackTimers.length) {
      const timer = feedbackTimers.pop()
      if (timer) clearTimeout(timer)
    }
  }

  const clearMoveAutomationFeedback = () => {
    clearFeedbackTimers()
    moveAutomationFeedback.value = null
  }

  const beginSeamlessMoveTargeting = (id: string, moveName: string | null | undefined): boolean => {
    const trimmedMoveName = moveName?.trim()
    if (!trimmedMoveName) return false
    const user = findSpawnedPokemon(id)
    const entry = moveAutomationEntryForUse(id, trimmedMoveName)
    if (!user || !entry || !isSeamlessSingleTargetAttackScript(entry.script)) return false
    const rangeMeters = parseSingleTargetMoveRangeMeters(entry.script.range, {
      focusSkillRankValue: user.focusSkillRankValue,
    })
    const damageFormula = damageFormulaForMove(entry.move)
    if (rangeMeters == null || !damageFormula) return false

    clearMoveAutomationFeedback()
    closeMoveAutomation()
    activeMoveTargeting.value = {
      userId: id,
      moveName: entry.script.moveName,
      script: entry.script,
      damageFormula,
      rangeMeters,
    }
    return true
  }

  const openMoveAutomation = (input: string | { id: string; moveName?: string | null }) => {
    const id = typeof input === 'string' ? input : input.id
    if (!canControlPlacement(id)) return
    const moveName = typeof input === 'string' ? null : input.moveName?.trim() || null
    if (beginSeamlessMoveTargeting(id, moveName)) return

    clearMoveAutomationFeedback()
    activeMoveTargeting.value = null
    moveAutomationId.value = id
    moveAutomationInitialMoveName.value = moveName
  }

  const closeMoveAutomation = () => {
    moveAutomationId.value = null
    moveAutomationInitialMoveName.value = null
  }

  const cancelMoveAutomationTargeting = () => {
    activeMoveTargeting.value = null
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

  const showMoveAutomationResolution = (
    feedback: MoveAutomationFeedbackState,
    transaction: MoveAutomationTransaction,
  ) => {
    clearFeedbackTimers()
    moveAutomationFeedback.value = feedback
    feedbackTimers.push(setTimeout(() => {
      if (moveAutomationFeedback.value?.id !== feedback.id) return
      moveAutomationFeedback.value = { ...feedback, phase: 'result' }
      void applyMoveAutomation(transaction)
    }, D20_ROLL_ANIMATION_MS))
    feedbackTimers.push(setTimeout(() => {
      if (moveAutomationFeedback.value?.id === feedback.id) moveAutomationFeedback.value = null
    }, D20_ROLL_ANIMATION_MS + ROLL_RESULT_VISIBLE_MS))
  }

  const selectMoveAutomationTarget = (targetId: string) => {
    const request = activeMoveTargeting.value
    const overlay = moveAutomationTargeting.value
    if (!request || !overlay?.candidateIds.includes(targetId)) return
    const user = findSpawnedPokemon(request.userId)
    const target = findSpawnedPokemon(targetId)
    if (!user || !target) return

    const result = resolveInstantMoveAutomation({
      script: request.script,
      user,
      target,
      damageFormula: request.damageFormula,
      fieldEffects: map.value?.fieldEffects,
    })
    activeMoveTargeting.value = null
    showMoveAutomationResolution(result.feedback, result.transaction)
  }

  onBeforeUnmount(clearFeedbackTimers)

  return {
    moveAutomationId,
    moveAutomationUser,
    moveAutomationMoves,
    moveAutomationInitialMoveName,
    moveAutomationTargeting,
    moveAutomationFeedback,
    tokenMoveOptionsById,
    openMoveAutomation,
    closeMoveAutomation,
    cancelMoveAutomationTargeting,
    selectMoveAutomationTarget,
    appendMoveAutomationLog,
    applyMoveAutomation,
  }
}

export type { SheetUpdateOptions }
