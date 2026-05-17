import { computed, ref, type Ref } from 'vue'
import { useWindowKeydown } from '~/composables/useWindowKeydown'
import type { MapEditorMode } from '#shared/mapEditor'
import type { LayerVisibility } from '~/types/map'
import { isCtrlLetter, isCtrlShiftLetter, isEscapeKey } from '~/utils/keyboardShortcuts'
import {
  createDefaultMapLayerVisibility,
  MAP_LAYER_OPTIONS,
  type MapLayerVisibilityKey,
} from '~/utils/mapLayerVisibility'

interface BooleanRef {
  readonly value: boolean
}

export type MapEditorMenu = 'fieldEffects' | 'sheets' | 'initiative'
export type RegisterMapEditorKeydown = (handler: (event: KeyboardEvent) => void) => void

export interface UseMapEditorUiStateOptions {
  isGm: BooleanRef
  canEditMap: BooleanRef
  buildMode: Ref<boolean>
  hazardMode: Ref<boolean>
  clearSelection: () => void
  registerKeydown?: RegisterMapEditorKeydown
}

export const useMapEditorUiState = ({
  isGm,
  canEditMap,
  buildMode,
  hazardMode,
  clearSelection,
  registerKeydown = useWindowKeydown,
}: UseMapEditorUiStateOptions) => {
  const adminPanelOpen = ref(false)
  const activeMapMenu = ref<MapEditorMenu | null>(null)
  const layerVisibility = ref<LayerVisibility>(createDefaultMapLayerVisibility())

  const fieldEffectsMenuOpen = computed(() => activeMapMenu.value === 'fieldEffects')
  const sheetsMenuOpen = computed(() => activeMapMenu.value === 'sheets')
  const initiativeMenuOpen = computed(() => activeMapMenu.value === 'initiative')

  const openMapMenu = (menu: MapEditorMenu) => {
    activeMapMenu.value = menu
  }

  const closeMapMenu = () => {
    activeMapMenu.value = null
  }

  const closeMapMenuIfOpen = (menu: MapEditorMenu) => {
    if (activeMapMenu.value === menu) closeMapMenu()
  }

  const toggleMapMenu = (menu: MapEditorMenu) => {
    activeMapMenu.value = activeMapMenu.value === menu ? null : menu
  }

  const openFieldEffectsMenu = () => openMapMenu('fieldEffects')
  const closeFieldEffectsMenu = () => closeMapMenuIfOpen('fieldEffects')
  const toggleFieldEffectsMenu = () => toggleMapMenu('fieldEffects')

  const openSheetsMenu = () => openMapMenu('sheets')
  const closeSheetsMenu = () => closeMapMenuIfOpen('sheets')
  const toggleSheetsMenu = () => toggleMapMenu('sheets')

  const openInitiativeMenu = () => openMapMenu('initiative')
  const closeInitiativeMenu = () => closeMapMenuIfOpen('initiative')
  const toggleInitiativeMenu = () => toggleMapMenu('initiative')

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

  const handleBuildShortcut = (event: KeyboardEvent) => {
    if (!canEditMap.value || !isCtrlLetter(event, 'b')) return

    event.preventDefault()
    setMode(buildMode.value ? 'play' : 'build')
  }

  const handleMapMenuShortcut = (
    event: KeyboardEvent,
    letter: string,
    menu: MapEditorMenu,
  ): boolean => {
    if (!isCtrlLetter(event, letter)) return false

    event.preventDefault()
    toggleMapMenu(menu)
    return true
  }

  const handleFieldEffectsShortcut = (event: KeyboardEvent) => {
    handleMapMenuShortcut(event, 'f', 'fieldEffects')
  }

  const handleSheetsShortcut = (event: KeyboardEvent) => {
    handleMapMenuShortcut(event, 's', 'sheets')
  }

  const handleInitiativeShortcut = (event: KeyboardEvent) => {
    handleMapMenuShortcut(event, 'i', 'initiative')
  }

  const handleMapMenuEscape = (event: KeyboardEvent): boolean => {
    if (!isEscapeKey(event) || !activeMapMenu.value) return false

    closeMapMenu()
    return true
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

  const handleKeydown = (event: KeyboardEvent) => {
    handleBuildShortcut(event)
    handleFieldEffectsShortcut(event)
    handleSheetsShortcut(event)
    handleInitiativeShortcut(event)
    if (handleMapMenuEscape(event)) return
    handleAdminShortcut(event)
  }

  registerKeydown(handleKeydown)

  return {
    adminPanelOpen,
    activeMapMenu,
    fieldEffectsMenuOpen,
    sheetsMenuOpen,
    initiativeMenuOpen,
    layerVisibility,
    layerOptions: MAP_LAYER_OPTIONS,
    openMapMenu,
    closeMapMenu,
    toggleMapMenu,
    openFieldEffectsMenu,
    closeFieldEffectsMenu,
    toggleFieldEffectsMenu,
    openSheetsMenu,
    closeSheetsMenu,
    toggleSheetsMenu,
    openInitiativeMenu,
    closeInitiativeMenu,
    toggleInitiativeMenu,
    setMode,
    setLayerVisibility,
    handleBuildShortcut,
    handleFieldEffectsShortcut,
    handleSheetsShortcut,
    handleInitiativeShortcut,
    handleMapMenuEscape,
    handleAdminShortcut,
    handleKeydown,
  }
}
