import { computed, type ComputedRef, type Ref } from 'vue'
import { startTurnModalIsDismissed, type StartTurnModalStateUpdatePayload } from '#shared/startTurnModalState'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { InitiativeRow } from './useInitiativeTracker'

export interface StartTurnModalViewModel {
  readonly activeId: string
  readonly round: number
  readonly characterName: string
  readonly characterMeta: string | null
  readonly profileUrl: string | null
  readonly accentColor: string | null
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
  readonly dismissTurn: (payload: StartTurnModalStateUpdatePayload) => void
}

export const useStartTurnModal = (options: UseStartTurnModalOptions) => {
  const activeStartTurnModal = computed<StartTurnModalViewModel | null>(() => {
    if (!options.map.value || !options.canViewMap.value || options.mapInPrepareMode.value) return null
    const activeId = options.activeInitiativeId.value
    if (!activeId) return null
    const round = options.initiativeRound.value
    if (startTurnModalIsDismissed(options.map.value.metadata, { activeId, round })) return null

    const row = options.sortedInitiativeRows.value.find((entry) => entry.id === activeId)
    const placement = options.placementById(activeId)
    return {
      activeId,
      round,
      characterName: row?.name ?? placement?.sheetSlug ?? 'Active character',
      characterMeta: row?.meta ?? (placement ? `${placement.sheetKind === 'pokemon' ? 'Pokémon' : 'Trainer'} token` : null),
      profileUrl: row?.profileUrl ?? null,
      accentColor: row?.accentColor ?? null,
    }
  })

  const startTurnModalBusy = computed(() => (
    !options.livePlayReady.value
    || options.commandSaving.value
  ))

  const closeStartTurnModal = () => {
    const modal = activeStartTurnModal.value
    if (!modal || !options.isGm.value || startTurnModalBusy.value) return
    options.dismissTurn({
      action: 'dismiss',
      activeId: modal.activeId,
      round: modal.round,
    })
  }

  return {
    activeStartTurnModal,
    startTurnModalBusy,
    closeStartTurnModal,
  }
}
