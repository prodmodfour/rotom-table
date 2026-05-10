import { ref, type Ref } from 'vue'
import { useWindowKeydown } from '~/composables/useWindowKeydown'
import type { MapEditorMode, MapLeftSidebarSection } from '~/shared/mapEditor'
import type { LayerVisibility } from '~/types/map'
import { isCtrlShiftLetter, isEscapeKey } from '~/utils/keyboardShortcuts'
import {
  createDefaultMapLayerVisibility,
  MAP_LAYER_OPTIONS,
  type MapLayerVisibilityKey,
} from '~/utils/mapLayerVisibility'

interface BooleanRef {
  readonly value: boolean
}

export type RegisterMapEditorKeydown = (handler: (event: KeyboardEvent) => void) => void

export interface UseMapEditorUiStateOptions {
  isGm: BooleanRef
  canEditMap: BooleanRef
  buildMode: Ref<boolean>
  hazardMode: Ref<boolean>
  clearSelection: () => void
  registerKeydown?: RegisterMapEditorKeydown
}

export const createDefaultLeftSidebarSections = (): Record<MapLeftSidebarSection, boolean> => ({
  details: false,
  terrain: false,
  fieldEffects: false,
})

export const useMapEditorUiState = ({
  isGm,
  canEditMap,
  buildMode,
  hazardMode,
  clearSelection,
  registerKeydown = useWindowKeydown,
}: UseMapEditorUiStateOptions) => {
  const sidebarCollapsed = ref(false)
  const initiativeCollapsed = ref(false)
  const adminPanelOpen = ref(false)
  const leftSidebarSectionsCollapsed = ref(createDefaultLeftSidebarSections())
  const layerVisibility = ref<LayerVisibility>(createDefaultMapLayerVisibility())

  const toggleSidebarCollapsed = () => {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  const toggleInitiativeCollapsed = () => {
    initiativeCollapsed.value = !initiativeCollapsed.value
  }

  const toggleLeftSection = (section: MapLeftSidebarSection) => {
    leftSidebarSectionsCollapsed.value[section] = !leftSidebarSectionsCollapsed.value[section]
  }

  const setMode = (mode: MapEditorMode) => {
    if (mode !== 'play' && !canEditMap.value) return

    const nextBuild = mode === 'build'
    const nextHazards = mode === 'hazards'
    if (buildMode.value === nextBuild && hazardMode.value === nextHazards) return

    buildMode.value = nextBuild
    hazardMode.value = nextHazards
    if (nextBuild || nextHazards) clearSelection()
  }

  const setLayerVisibility = (layer: MapLayerVisibilityKey, value: boolean) => {
    layerVisibility.value[layer] = value
  }

  const handleAdminShortcut = (event: KeyboardEvent) => {
    if (!isGm.value) return

    if (isCtrlShiftLetter(event, 'a')) {
      event.preventDefault()
      adminPanelOpen.value = !adminPanelOpen.value
      return
    }

    if (isEscapeKey(event) && adminPanelOpen.value) {
      adminPanelOpen.value = false
    }
  }

  registerKeydown(handleAdminShortcut)

  return {
    sidebarCollapsed,
    initiativeCollapsed,
    adminPanelOpen,
    leftSidebarSectionsCollapsed,
    layerVisibility,
    layerOptions: MAP_LAYER_OPTIONS,
    toggleSidebarCollapsed,
    toggleInitiativeCollapsed,
    toggleLeftSection,
    setMode,
    setLayerVisibility,
    handleAdminShortcut,
  }
}
