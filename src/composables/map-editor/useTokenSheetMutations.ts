import type { ComputedRef, Ref } from 'vue'
import { useApiClient } from '~/composables/useApiClient'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { getClientId as defaultGetClientId } from '~/utils/clientId'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  applyHpToSheet,
  commitSheetUpdate,
  createSheetUpdateForPlacement,
  rollbackSheetUpdate,
  toPersistableSheetPayload,
  type PlacementSheetUpdater,
  type SheetLookupMaps,
} from '~/utils/sheetMutations'
import type { SheetKind, TabletopMap } from '~/types/map'
import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
  MoveAutomationHpUpdate,
} from '~/types/moveAutomation'

export interface SheetUpdateOptions {
  allowAnyTarget?: boolean
}

export interface SavePlacedSheetRequest {
  kind: SheetKind
  slug: string
  sheet: Record<string, unknown>
  clientId: string
}

export type SavePlacedSheet = (request: SavePlacedSheetRequest) => Promise<void>

export interface UseTokenSheetMutationsOptions {
  map: Ref<TabletopMap | null>
  sheetLookup: ComputedRef<SheetLookupMaps>
  canControlPlacement: (id: string) => boolean
  getClientId?: () => string
  saveSheet?: SavePlacedSheet
  logError?: (label: string, error: unknown) => void
}

export const savePlacedSheetWithFetch: SavePlacedSheet = async (request) => {
  await useApiClient().postJson(SHEET_API_PATHS.save, request)
}

export const useTokenSheetMutations = ({
  map,
  sheetLookup,
  canControlPlacement,
  getClientId = defaultGetClientId,
  saveSheet = savePlacedSheetWithFetch,
  logError = (label, error) => console.error(`[${label}] save failed`, error),
}: UseTokenSheetMutationsOptions) => {
  const updatePlacedSheet = async (
    id: string,
    update: PlacementSheetUpdater,
    logLabel: string,
    options: SheetUpdateOptions = {},
  ): Promise<boolean> => {
    if (!map.value || (!options.allowAnyTarget && !canControlPlacement(id))) return false
    const placement = map.value.placements.find((item) => item.id === id)
    if (!placement) return false

    const context = createSheetUpdateForPlacement(
      placement,
      sheetLookup.value,
      update,
    )
    if (!context) return false

    commitSheetUpdate(context)
    try {
      await saveSheet({
        kind: context.kind,
        slug: context.slug,
        sheet: toPersistableSheetPayload(context.updated),
        clientId: getClientId(),
      })
      return true
    } catch (error) {
      rollbackSheetUpdate(context)
      logError(logLabel, error)
      return false
    }
  }

  const modifyHp = async (
    payload: MoveAutomationHpUpdate,
    options: SheetUpdateOptions = {},
  ): Promise<void> => {
    await updatePlacedSheet(
      payload.id,
      (kind, sheet) => applyHpToSheet(kind, sheet, payload.currentHp),
      'modifyHp',
      options,
    )
  }

  const modifyCombatStages = async (
    payload: MoveAutomationCombatStageUpdate,
    options: SheetUpdateOptions = {},
  ): Promise<void> => {
    await updatePlacedSheet(
      payload.id,
      (kind, sheet) => applyCombatStagesToSheet(kind, sheet, payload.stages),
      'modifyCombatStages',
      options,
    )
  }

  const modifyConditions = async (
    payload: MoveAutomationConditionUpdate,
    options: SheetUpdateOptions = {},
  ): Promise<void> => {
    await updatePlacedSheet(
      payload.id,
      (kind, sheet) => applyConditionsToSheet(kind, sheet, payload.conditions),
      'modifyConditions',
      options,
    )
  }

  return {
    updatePlacedSheet,
    modifyHp,
    modifyCombatStages,
    modifyConditions,
  }
}
