import { computed, watch, type ComputedRef, type Ref } from 'vue'
import type { TabletopMap } from '~/types/map'

interface BooleanRef {
  readonly value: boolean
}

export interface UseMapAccessOptions {
  map: Ref<TabletopMap | null>
  isGm: BooleanRef
  isPlayer: BooleanRef
  redirectHiddenPlayerMap?: () => unknown
}

export interface UseMapAccessResult {
  canEditMap: ComputedRef<boolean>
  canManageInitiative: ComputedRef<boolean>
  canSpawnTokens: ComputedRef<boolean>
  canViewMap: ComputedRef<boolean>
}

export interface UseMapGmModeGuardOptions {
  isGm: BooleanRef
  buildMode: Ref<boolean>
  hazardMode: Ref<boolean>
  adminPanelOpen: Ref<boolean>
  selectedId: Ref<string | null>
  moveAutomationId: Ref<string | null>
  canControlPlacement: (id: string) => boolean
  clearSelection: () => void
  closeMoveAutomation: () => void
}

export const canPlayerViewMap = (
  map: Pick<TabletopMap, 'playerVisible'> | null | undefined,
  isPlayer: boolean,
): boolean => !map || !isPlayer || map.playerVisible === true

export const useMapAccess = ({
  map,
  isGm,
  isPlayer,
  redirectHiddenPlayerMap,
}: UseMapAccessOptions): UseMapAccessResult => {
  const canEditMap = computed(() => isGm.value)
  const canManageInitiative = computed(() => isGm.value)
  const canSpawnTokens = computed(() => isGm.value)
  const canViewMap = computed(() => canPlayerViewMap(map.value, isPlayer.value))

  watch(
    [() => map.value?.slug, () => isPlayer.value],
    () => {
      if (map.value && isPlayer.value && map.value.playerVisible !== true) {
        void redirectHiddenPlayerMap?.()
      }
    },
    { immediate: true },
  )

  return {
    canEditMap,
    canManageInitiative,
    canSpawnTokens,
    canViewMap,
  }
}

export const useMapGmModeGuard = ({
  isGm,
  buildMode,
  hazardMode,
  adminPanelOpen,
  selectedId,
  moveAutomationId,
  canControlPlacement,
  clearSelection,
  closeMoveAutomation,
}: UseMapGmModeGuardOptions): void => {
  watch(
    () => isGm.value,
    (gm) => {
      if (gm) return
      buildMode.value = false
      hazardMode.value = false
      adminPanelOpen.value = false
      if (selectedId.value && !canControlPlacement(selectedId.value)) clearSelection()
      if (moveAutomationId.value && !canControlPlacement(moveAutomationId.value)) closeMoveAutomation()
    },
  )
}
