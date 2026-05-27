import { ref, type ComputedRef, type Ref } from 'vue'
import { useApiClient } from '~/composables/useApiClient'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { getClientId as defaultGetClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  applyAbilityActivationToSheet,
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
import type { PlayerProfileId } from '#shared/playerProfiles'
import type { SheetKind, TabletopMap } from '~/types/map'
import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
  MoveAutomationHpUpdate,
} from '~/types/moveAutomation'
import type { AbilitySheetActivationUpdate } from '~/types/abilityAutomation'

export interface SheetUpdateOptions {
  allowAnyTarget?: boolean
}

export interface SavePlacedSheetRequest {
  kind: SheetKind
  slug: string
  sheet: Record<string, unknown>
  clientId: string
  profileId?: PlayerProfileId
}

export type SavePlacedSheet = (request: SavePlacedSheetRequest) => Promise<void>

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

export interface UseTokenSheetMutationsOptions {
  map: Ref<TabletopMap | null>
  sheetLookup: ComputedRef<SheetLookupMaps>
  canControlPlacement: (id: string) => boolean
  playerProfileId?: ReadonlyValueRef<PlayerProfileId | null | undefined>
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
  playerProfileId,
  getClientId = defaultGetClientId,
  saveSheet = savePlacedSheetWithFetch,
  logError = (label, error) => console.error(`[${label}] save failed`, error),
}: UseTokenSheetMutationsOptions) => {
  const lastError = ref<string | null>(null)

  const clearError = () => {
    lastError.value = null
  }

  const profileRequestFields = (): { profileId?: PlayerProfileId } => {
    const profileId = playerProfileId?.value ?? null
    return profileId ? { profileId } : {}
  }

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
    lastError.value = null
    try {
      await saveSheet({
        kind: context.kind,
        slug: context.slug,
        sheet: toPersistableSheetPayload(context.updated),
        clientId: getClientId(),
        ...profileRequestFields(),
      })
      return true
    } catch (error) {
      rollbackSheetUpdate(context)
      lastError.value = getErrorMessage(error, { fallback: 'Token sheet action failed' })
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
      (kind, sheet) => applyHpToSheet(kind, sheet, payload.currentHp, payload.injuries),
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

  const modifyAbilityActivation = async (
    payload: AbilitySheetActivationUpdate,
    options: SheetUpdateOptions = {},
  ): Promise<void> => {
    if (!payload.activated) return
    await updatePlacedSheet(
      payload.id,
      (kind, sheet) => applyAbilityActivationToSheet(kind, sheet, payload.abilityName),
      'modifyAbilityActivation',
      options,
    )
  }

  return {
    lastError,
    clearError,
    updatePlacedSheet,
    modifyHp,
    modifyCombatStages,
    modifyConditions,
    modifyAbilityActivation,
  }
}
