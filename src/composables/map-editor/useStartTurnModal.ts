import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  readStartTurnModalState,
  startTurnModalIsDismissed,
  type StartTurnModalConditionResolution,
  type StartTurnModalConditionResolutionAction,
  type StartTurnModalStateUpdatePayload,
} from '#shared/startTurnModalState'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { InitiativeRow } from './useInitiativeTracker'

export interface StartTurnModalConditionViewModel {
  readonly id: string
  readonly condition: string
  readonly occurrence: number
  readonly present: boolean
  readonly result: StartTurnModalConditionResolution | null
}

export interface StartTurnModalViewModel {
  readonly activeId: string
  readonly round: number
  readonly characterName: string
  readonly characterMeta: string | null
  readonly profileUrl: string | null
  readonly accentColor: string | null
  readonly conditions: readonly StartTurnModalConditionViewModel[]
}

export interface StartTurnModalCommandDispatchResult {
  readonly dispatched: boolean
}

export interface StartTurnModalConditionReplacePayload {
  readonly id: string
  readonly conditions: readonly string[]
}

export interface UseStartTurnModalOptions {
  readonly map: Ref<TabletopMap | null>
  readonly canViewMap: ComputedRef<boolean>
  readonly mapInPrepareMode: ComputedRef<boolean>
  readonly activeInitiativeId: ComputedRef<string | null>
  readonly initiativeRound: ComputedRef<number>
  readonly sortedInitiativeRows: ComputedRef<readonly InitiativeRow[]>
  readonly placementById: (id: string) => SheetPlacement | null
  readonly isGm: ComputedRef<boolean>
  readonly livePlayReady: ComputedRef<boolean>
  readonly commandSaving: ComputedRef<boolean>
  readonly updateTurn: (
    payload: StartTurnModalStateUpdatePayload,
  ) => void | StartTurnModalCommandDispatchResult | Promise<void | StartTurnModalCommandDispatchResult>
  readonly replaceConditions: (
    payload: StartTurnModalConditionReplacePayload,
  ) => void | StartTurnModalCommandDispatchResult | Promise<void | StartTurnModalCommandDispatchResult>
}

const conditionEntryId = (condition: string, occurrence: number): string => `${condition}\u241F${occurrence}`

const conditionEntries = (conditions: readonly string[]): Array<Pick<StartTurnModalConditionViewModel, 'id' | 'condition' | 'occurrence'>> => {
  const occurrences = new Map<string, number>()
  const entries: Array<Pick<StartTurnModalConditionViewModel, 'id' | 'condition' | 'occurrence'>> = []
  for (const rawCondition of conditions) {
    const condition = rawCondition.trim()
    if (!condition) continue
    const occurrence = occurrences.get(condition) ?? 0
    occurrences.set(condition, occurrence + 1)
    entries.push({
      id: conditionEntryId(condition, occurrence),
      condition,
      occurrence,
    })
  }
  return entries
}

const resolutionMatchesTurn = (
  resolution: StartTurnModalConditionResolution,
  turn: Pick<StartTurnModalViewModel, 'activeId' | 'round'>,
): boolean => resolution.activeId === turn.activeId && resolution.round === turn.round

const conditionRowsForTurn = (
  currentConditions: readonly string[],
  resolutions: readonly StartTurnModalConditionResolution[],
  turn: Pick<StartTurnModalViewModel, 'activeId' | 'round'>,
): StartTurnModalConditionViewModel[] => {
  const currentEntries = conditionEntries(currentConditions)
  const turnResolutions = resolutions.filter((resolution) => resolutionMatchesTurn(resolution, turn))
  const resolutionById = new Map(turnResolutions.map((resolution) => [
    conditionEntryId(resolution.condition, resolution.occurrence),
    resolution,
  ] as const))
  const currentIds = new Set(currentEntries.map((entry) => entry.id))
  return [
    ...currentEntries.map((entry) => ({
      ...entry,
      present: true,
      result: resolutionById.get(entry.id) ?? null,
    })),
    ...turnResolutions
      .filter((resolution) => !currentIds.has(conditionEntryId(resolution.condition, resolution.occurrence)))
      .map((resolution) => ({
        id: conditionEntryId(resolution.condition, resolution.occurrence),
        condition: resolution.condition,
        occurrence: resolution.occurrence,
        present: false,
        result: resolution,
      })),
  ]
}

const commandResultAllowsFollowUp = (result: void | StartTurnModalCommandDispatchResult): boolean => (
  result === undefined || result.dispatched !== false
)

const removeConditionOccurrence = (
  conditions: readonly string[],
  targetCondition: string,
  targetOccurrence: number,
): string[] => {
  let occurrence = 0
  let removed = false
  const next: string[] = []
  for (const condition of conditions) {
    if (condition.trim() !== targetCondition) {
      next.push(condition)
      continue
    }

    if (!removed && occurrence === targetOccurrence) {
      removed = true
      occurrence += 1
      continue
    }

    occurrence += 1
    next.push(condition)
  }
  return next
}

const sameConditions = (left: readonly string[], right: readonly string[]): boolean => (
  left.length === right.length && left.every((condition, index) => condition === right[index])
)

export const useStartTurnModal = (options: UseStartTurnModalOptions) => {
  const conditionActionBusy = ref(false)

  const activeStartTurnModal = computed<StartTurnModalViewModel | null>(() => {
    if (!options.map.value || !options.canViewMap.value || options.mapInPrepareMode.value) return null
    const activeId = options.activeInitiativeId.value
    if (!activeId) return null
    const round = options.initiativeRound.value
    if (startTurnModalIsDismissed(options.map.value.metadata, { activeId, round })) return null

    const row = options.sortedInitiativeRows.value.find((entry) => entry.id === activeId)
    const placement = options.placementById(activeId)
    const turn = { activeId, round }
    const state = readStartTurnModalState(options.map.value.metadata)
    return {
      activeId,
      round,
      characterName: row?.name ?? placement?.sheetSlug ?? 'Active character',
      characterMeta: row?.meta ?? (placement ? `${placement.sheetKind === 'pokemon' ? 'Pokémon' : 'Trainer'} token` : null),
      profileUrl: row?.profileUrl ?? null,
      accentColor: row?.accentColor ?? null,
      conditions: conditionRowsForTurn(row?.conditions ?? [], state.conditionResolutions, turn),
    }
  })

  const startTurnModalBusy = computed(() => (
    conditionActionBusy.value
    || !options.livePlayReady.value
    || options.commandSaving.value
  ))

  const closeStartTurnModal = () => {
    const modal = activeStartTurnModal.value
    if (!modal || !options.isGm.value || startTurnModalBusy.value) return
    void options.updateTurn({
      action: 'dismiss',
      activeId: modal.activeId,
      round: modal.round,
    })
  }

  const resolveStartTurnModalCondition = async (
    conditionId: string,
    resolution: StartTurnModalConditionResolutionAction,
  ): Promise<void> => {
    const modal = activeStartTurnModal.value
    if (!modal || !options.isGm.value || startTurnModalBusy.value) return
    const condition = modal.conditions.find((entry) => entry.id === conditionId)
    if (!condition) return

    conditionActionBusy.value = true
    try {
      const result = await options.updateTurn({
        action: 'resolveCondition',
        activeId: modal.activeId,
        round: modal.round,
        condition: condition.condition,
        occurrence: condition.occurrence,
        resolution,
      })
      if (!commandResultAllowsFollowUp(result)) return
      if (resolution !== 'remove') return

      const currentConditions = options.sortedInitiativeRows.value.find((entry) => entry.id === modal.activeId)?.conditions ?? []
      const nextConditions = removeConditionOccurrence(currentConditions, condition.condition, condition.occurrence)
      if (sameConditions(currentConditions, nextConditions)) return
      await options.replaceConditions({
        id: modal.activeId,
        conditions: nextConditions,
      })
    } finally {
      conditionActionBusy.value = false
    }
  }

  return {
    activeStartTurnModal,
    startTurnModalBusy,
    closeStartTurnModal,
    resolveStartTurnModalCondition,
  }
}
