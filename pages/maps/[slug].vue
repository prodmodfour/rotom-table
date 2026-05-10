<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MapAdminPanel from '~/components/map/MapAdminPanel.vue'
import MapInitiativeSidebar from '~/components/map/MapInitiativeSidebar.vue'
import MapLeftSidebar from '~/components/map/MapLeftSidebar.vue'
import MapScenePanel from '~/components/map/MapScenePanel.vue'
import { useEditableMap } from '~/composables/useEditableMap'
import { useLiveSheets } from '~/composables/useLiveSheets'
import { useWindowKeydown } from '~/composables/useWindowKeydown'
import { useFieldEffectsEditor } from '~/composables/map-editor/useFieldEffectsEditor'
import { useHazardBuilder } from '~/composables/map-editor/useHazardBuilder'
import { useInitiativeTracker } from '~/composables/map-editor/useInitiativeTracker'
import { useMoveAutomationPanel } from '~/composables/map-editor/useMoveAutomationPanel'
import { useTerrainBuilder } from '~/composables/map-editor/useTerrainBuilder'
import { useTokenSheetMutations } from '~/composables/map-editor/useTokenSheetMutations'
import {
  pokedexPathForSpecies,
  sheetPathForPlacement,
  useTokenControls,
} from '~/composables/map-editor/useTokenControls'
import {
  normalizeDimensions,
  reconcilePokemonPositions,
} from '~/utils/grid'
import { isCtrlShiftLetter, isEscapeKey } from '~/utils/keyboardShortcuts'
import { mapEditorPath, mapLibraryPath } from '~/utils/mapRoutes'
import { filterMapHazardsInBounds } from '~/utils/mapHazards'
import { filterVoxelsInBounds } from '~/utils/voxels'
import type { SaveStatus } from '~/composables/useEditableSheet'
import type { MapEditorMode, MapLeftSidebarSection } from '~/shared/mapEditor'
import type {
  MapHazardV2,
  MapVoxelV2,
} from '~/types/map'

definePageMeta({
  key: (route) => `map-${route.params.slug}`,
})

const route = useRoute()
const router = useRouter()
const { isGm, isPlayer } = useAuth()
const slug = String(route.params.slug ?? '')

const { map, status, error, renamedTo } = useEditableMap(slug)
const { pokemonBySlug, trainerBySlug } = useLiveSheets()

watch(renamedTo, (newSlug) => {
  if (newSlug) router.replace(mapEditorPath(newSlug))
})

useHead(() => ({
  title: map.value ? `${map.value.name} · Maps` : 'Maps · Rotom Table',
}))

interface MapScenePanelHandle {
  focusPokemon: (id: string) => boolean
}

const gridRef = ref<MapScenePanelHandle | null>(null)
const sidebarCollapsed = ref(false)
const initiativeCollapsed = ref(false)
const adminPanelOpen = ref(false)

const leftSidebarSectionsCollapsed = ref<Record<MapLeftSidebarSection, boolean>>({
  details: false,
  terrain: false,
  fieldEffects: false,
})
const toggleLeftSection = (section: MapLeftSidebarSection) => {
  leftSidebarSectionsCollapsed.value[section] = !leftSidebarSectionsCollapsed.value[section]
}

const canEditMap = computed(() => isGm.value)
const canManageInitiative = computed(() => isGm.value)
const canSpawnTokens = computed(() => isGm.value)

const layerVisibility = ref({
  terrain: true,
  shadows: true,
  tokens: true,
  grid: true,
  hazards: true,
  fieldEffects: true,
})
const layerOptions = [
  'terrain',
  'shadows',
  'tokens',
  'grid',
  'hazards',
  'fieldEffects',
] as const

const mapVoxels = computed<MapVoxelV2[]>(() => map.value?.voxels ?? [])
const mapHazards = computed<MapHazardV2[]>(() => map.value?.hazards ?? [])
const canViewMap = computed(() => !map.value || !isPlayer.value || map.value.playerVisible === true)

const clampGroundLevelY = (value: unknown, height: number): number => {
  const h = Number(height)
  const max = Number.isFinite(h) ? Math.max(0, Math.floor(h) - 1) : 0
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(max, Math.max(0, Math.round(n)))
}

const groundLevelYMax = computed(() => Math.max(0, (map.value?.dimensions.y ?? 1) - 1))
const mapGroundLevelY = computed(() =>
  clampGroundLevelY(map.value?.groundLevelY ?? 0, map.value?.dimensions.y ?? 1),
)
const mapSpecificYMin = computed(() => -mapGroundLevelY.value)
const mapSpecificYMax = computed(() =>
  map.value ? map.value.dimensions.y - 1 - mapGroundLevelY.value : 0,
)

type MapDimensionAxis = 'x' | 'y' | 'z'

const setMapPlayerVisible = (value: boolean) => {
  if (!map.value || !isGm.value) return
  map.value.playerVisible = value
}

const setMapDimension = (axis: MapDimensionAxis, value: number | string) => {
  if (!map.value || !canEditMap.value) return
  map.value.dimensions[axis] = value as number
}

const {
  selectedId,
  previewState,
  sheetLookup,
  spawnedPokemon,
  controllablePlacementIds,
  canControlPlacement,
  placementById,
  clearSelection,
  updatePreview,
  spawnSheet,
  selectPlacement,
  deletePlacement,
  turnPlacement,
  movePlacement,
} = useTokenControls({
  map,
  pokemonBySlug,
  trainerBySlug,
  mapVoxels,
  mapGroundLevelY,
  canSpawnTokens,
  canControlAllTokens: isGm,
  canDeleteTokens: isGm,
})

const selectPokemon = (id: string | null) => {
  if (buildMode.value) return
  selectPlacement(id)
}
const deletePokemon = deletePlacement
const turnPokemon = turnPlacement
const movePokemon = movePlacement

const voxelCount = computed(() => mapVoxels.value.length)
const hazardCount = computed(() => mapHazards.value.length)
const {
  hazardMode,
  hazardTool,
  hazardKind,
  activeHazardDef,
  hazardPalette,
  placeHazard,
  removeHazard,
  clearAllHazards,
  setHazardTool,
  selectHazardKind,
} = useHazardBuilder({ map, mapHazards, canEditMap })

const {
  weatherCoexistNext,
  mapFieldEffects,
  activeWeatherEffects,
  activeTerrainEffects,
  activeRoomEffects,
  fieldEffectCount,
  weatherPalette,
  terrainPalette,
  roomPalette,
  weatherDefinition,
  terrainDefinition,
  roomDefinition,
  weatherIsActive,
  terrainIsActive,
  roomIsActive,
  setWeather,
  removeWeather,
  clearWeather,
  toggleTerrain,
  removeTerrain,
  toggleRoom,
  removeRoom,
  setWeatherRounds,
  setTerrainRounds,
  setRoomRounds,
  durationLabel,
  tickFieldEffectDurations,
  clearAllFieldEffects,
  applyMoveFieldEffect,
} = useFieldEffectsEditor({ map, canEditMap })

const setWeatherCoexistNext = (value: boolean) => {
  weatherCoexistNext.value = value
}

const {
  buildMode,
  buildTool,
  buildMaterial,
  buildColor,
  visibleVoxelMaterials,
  colorPickerValue,
  placeVoxel,
  removeVoxel,
  selectMaterial,
  setTool,
  handleColorInput,
  clearCustomColor,
  fillGround,
  clearAllVoxels,
} = useTerrainBuilder({ map, mapVoxels, mapGroundLevelY, spawnedPokemon, canEditMap })

const setGroundLevelY = (value: string) => {
  if (!map.value || !canEditMap.value) return
  map.value.groundLevelY = clampGroundLevelY(value, map.value.dimensions.y)
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

useWindowKeydown(handleAdminShortcut)

watch(
  [() => map.value?.slug, isPlayer],
  () => {
    if (map.value && isPlayer.value && map.value.playerVisible !== true) {
      void router.replace(mapLibraryPath())
    }
  },
  { immediate: true },
)

watch(isGm, (gm) => {
  if (gm) return
  buildMode.value = false
  hazardMode.value = false
  adminPanelOpen.value = false
  if (selectedId.value && !canControlPlacement(selectedId.value)) selectPokemon(null)
  if (moveAutomationId.value && !canControlPlacement(moveAutomationId.value)) closeMoveAutomation()
})

const {
  initiativeRows,
  sortedInitiativeRows,
  activeInitiativeId,
  initiativeRound,
  hasInitiativeValues,
  focusInitiativeEntry,
  setActiveInitiativeAndFocus,
  setInitiativeInput,
  setInitiativeFromSpeed,
  setInitiativeRound,
  fillInitiativeFromSpeed,
  clearInitiativeValues,
  clearActiveInitiative,
  nextInitiative,
  previousInitiative,
} = useInitiativeTracker({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canManageInitiative,
  focusEntry: (id) => {
    gridRef.value?.focusPokemon(id)
  },
})

const saveIndicatorStatus = computed<SaveStatus | null>(() => {
  if (status.value === 'saving') return 'saving'
  if (status.value === 'saved') return 'saved'
  if (status.value === 'error') return 'error'
  return null
})

const {
  modifyHp,
  modifyCombatStages,
  modifyConditions,
} = useTokenSheetMutations({
  map,
  sheetLookup,
  canControlPlacement,
})

const {
  moveAutomationId,
  moveAutomationUser,
  moveAutomationMoves,
  openMoveAutomation,
  closeMoveAutomation,
  applyMoveAutomation,
} = useMoveAutomationPanel({
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
})

const viewSheet = (id: string) => {
  if (!map.value || !canControlPlacement(id)) return
  const placement = placementById(id)
  if (!placement) return
  const target = router.resolve(sheetPathForPlacement(placement)).href
  window.open(target, '_blank', 'noopener')
}

const viewPokedex = (id: string) => {
  if (!map.value || !canControlPlacement(id)) return
  const placement = placementById(id)
  if (!placement || placement.sheetKind !== 'pokemon') return
  const targetPath = pokedexPathForSpecies(pokemonBySlug.value?.get(placement.sheetSlug)?.species)
  if (!targetPath) return
  const target = router.resolve(targetPath).href
  window.open(target, '_blank', 'noopener')
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

const setLayerVisibility = (layer: keyof typeof layerVisibility.value, value: boolean) => {
  layerVisibility.value[layer] = value
}

watch(
  () => map.value?.dimensions,
  (dims) => {
    if (!dims || !map.value) return
    const normalized = normalizeDimensions(dims)
    if (normalized.x !== dims.x) map.value.dimensions.x = normalized.x
    if (normalized.y !== dims.y) map.value.dimensions.y = normalized.y
    if (normalized.z !== dims.z) map.value.dimensions.z = normalized.z

    if (map.value.groundLevelY !== undefined) {
      const normalizedGroundLevelY = clampGroundLevelY(map.value.groundLevelY, normalized.y)
      if (normalizedGroundLevelY !== map.value.groundLevelY) {
        map.value.groundLevelY = normalizedGroundLevelY
      }
    }

    const trimmedVoxels = filterVoxelsInBounds(map.value.voxels, normalized)
    if (trimmedVoxels.length !== map.value.voxels.length) {
      map.value.voxels = trimmedVoxels
    }

    const trimmedHazards = filterMapHazardsInBounds(mapHazards.value, normalized)
    if (trimmedHazards.length !== mapHazards.value.length) {
      map.value.hazards = trimmedHazards
    }

    const reconciliation = reconcilePokemonPositions(
      spawnedPokemon.value,
      normalized,
      trimmedVoxels,
      // Manual token placement is allowed to overlap terrain. Dimension
      // reconciliation should only fix out-of-bounds/token-overlap issues,
      // not eject characters a GM intentionally tucked into terrain blocks.
      new Set<string>(),
    )
    const byId = new Map(reconciliation.pokemons.map((p) => [p.id, p.position]))
    map.value.placements = map.value.placements.flatMap((placement) => {
      const next = byId.get(placement.id)
      if (!next) return []
      return [{ ...placement, position: next }]
    })
    if (selectedId.value && !map.value.placements.some((p) => p.id === selectedId.value)) {
      clearSelection()
    }
  },
  { deep: true },
)
</script>

<template>
  <div
    class="layout-shell"
    :class="{
      'layout-shell--sidebar-collapsed': sidebarCollapsed,
      'layout-shell--initiative-collapsed': initiativeCollapsed,
    }"
  >
    <MapLeftSidebar
      :collapsed="sidebarCollapsed"
      :map="map"
      :can-view-map="canViewMap"
      :save-indicator-status="saveIndicatorStatus"
      :error="error"
      :section-collapsed="leftSidebarSectionsCollapsed"
      :is-gm="isGm"
      :can-edit-map="canEditMap"
      :can-spawn-tokens="canSpawnTokens"
      :build-mode="buildMode"
      :hazard-mode="hazardMode"
      :build-tool="buildTool"
      :build-material="buildMaterial"
      :build-color="buildColor"
      :visible-voxel-materials="visibleVoxelMaterials"
      :color-picker-value="colorPickerValue"
      :voxel-count="voxelCount"
      :hazard-count="hazardCount"
      :hazard-tool="hazardTool"
      :hazard-kind="hazardKind"
      :active-hazard-def="activeHazardDef"
      :hazard-palette="hazardPalette"
      :layer-visibility="layerVisibility"
      :layer-options="layerOptions"
      :field-effect-count="fieldEffectCount"
      :weather-coexist-next="weatherCoexistNext"
      :active-weather-effects="activeWeatherEffects"
      :active-terrain-effects="activeTerrainEffects"
      :active-room-effects="activeRoomEffects"
      :weather-palette="weatherPalette"
      :terrain-palette="terrainPalette"
      :room-palette="roomPalette"
      :weather-definition="weatherDefinition"
      :terrain-definition="terrainDefinition"
      :room-definition="roomDefinition"
      :weather-is-active="weatherIsActive"
      :terrain-is-active="terrainIsActive"
      :room-is-active="roomIsActive"
      :duration-label="durationLabel"
      @toggle-collapsed="sidebarCollapsed = !sidebarCollapsed"
      @toggle-section="toggleLeftSection"
      @update-player-visible="setMapPlayerVisible"
      @update-dimension="setMapDimension"
      @set-mode="setMode"
      @set-build-tool="setTool"
      @select-material="selectMaterial"
      @color-input="handleColorInput"
      @clear-custom-color="clearCustomColor"
      @fill-ground="fillGround"
      @clear-all-voxels="clearAllVoxels"
      @set-layer-visibility="setLayerVisibility"
      @set-hazard-tool="setHazardTool"
      @select-hazard-kind="selectHazardKind"
      @clear-all-hazards="clearAllHazards"
      @set-weather="setWeather"
      @remove-weather="removeWeather"
      @clear-weather="clearWeather"
      @update-weather-coexist-next="setWeatherCoexistNext"
      @toggle-terrain="toggleTerrain"
      @remove-terrain="removeTerrain"
      @toggle-room="toggleRoom"
      @remove-room="removeRoom"
      @set-weather-rounds="setWeatherRounds"
      @set-terrain-rounds="setTerrainRounds"
      @set-room-rounds="setRoomRounds"
      @tick-durations="tickFieldEffectDurations"
      @clear-all-field-effects="clearAllFieldEffects"
      @spawn-sheet="spawnSheet"
    />

    <MapScenePanel
      ref="gridRef"
      :map="map"
      :can-view-map="canViewMap"
      :status="status"
      :error="error"
      :slug="slug"
      :spawned-pokemon="spawnedPokemon"
      :selected-id="selectedId"
      :controllable-placement-ids="controllablePlacementIds"
      :active-initiative-id="activeInitiativeId"
      :map-voxels="mapVoxels"
      :map-hazards="mapHazards"
      :map-field-effects="mapFieldEffects"
      :map-ground-level-y="mapGroundLevelY"
      :layer-visibility="layerVisibility"
      :build-mode="buildMode && canEditMap"
      :build-tool="buildTool"
      :build-material="buildMaterial"
      :build-color="buildColor"
      :hazard-mode="hazardMode && canEditMap"
      :hazard-tool="hazardTool"
      :hazard-kind="hazardKind"
      :can-delete-tokens="isGm"
      :move-automation-user="moveAutomationUser"
      :move-automation-moves="moveAutomationMoves"
      :can-apply-map-effects="canEditMap"
      @select-pokemon="selectPokemon"
      @move-pokemon="movePokemon"
      @turn-pokemon="turnPokemon"
      @delete-pokemon="deletePokemon"
      @modify-hp="modifyHp"
      @modify-combat-stages="modifyCombatStages"
      @modify-conditions="modifyConditions"
      @use-move="openMoveAutomation"
      @view-sheet="viewSheet"
      @view-pokedex="viewPokedex"
      @preview-change="updatePreview"
      @place-voxel="placeVoxel"
      @remove-voxel="removeVoxel"
      @place-hazard="placeHazard"
      @remove-hazard="removeHazard"
      @close-move-automation="closeMoveAutomation"
      @apply-move-automation="applyMoveAutomation"
    />

    <MapInitiativeSidebar
      :collapsed="initiativeCollapsed"
      :show-tracker="Boolean(map && canViewMap)"
      :rows="initiativeRows"
      :sorted-rows="sortedInitiativeRows"
      :active-id="activeInitiativeId"
      :round="initiativeRound"
      :selected-id="selectedId"
      :can-manage="canManageInitiative"
      :has-initiative-values="hasInitiativeValues"
      @toggle-collapsed="initiativeCollapsed = !initiativeCollapsed"
      @set-round="setInitiativeRound"
      @previous="previousInitiative"
      @next="nextInitiative"
      @fill-from-speed="fillInitiativeFromSpeed"
      @clear-active="clearActiveInitiative"
      @clear-values="clearInitiativeValues"
      @set-active-and-focus="setActiveInitiativeAndFocus"
      @focus="focusInitiativeEntry"
      @set-initiative-input="setInitiativeInput"
      @set-initiative-from-speed="setInitiativeFromSpeed"
    />

    <MapAdminPanel
      v-if="map && isGm && adminPanelOpen"
      :ground-level-y-max="groundLevelYMax"
      :map-ground-level-y="mapGroundLevelY"
      :map-specific-y-min="mapSpecificYMin"
      :map-specific-y-max="mapSpecificYMax"
      @close="adminPanelOpen = false"
      @set-ground-level-y="setGroundLevelY"
    />
  </div>
</template>

<style scoped>
.layout-shell {
  --map-sidebar-width: minmax(310px, 380px);
  --initiative-sidebar-width: minmax(300px, 360px);

  display: grid;
  grid-template-columns: var(--map-sidebar-width) minmax(0, 1fr) var(--initiative-sidebar-width);
  min-height: 100vh;
  gap: 0;
  background: var(--paper);
  transition: grid-template-columns 0.2s ease;
}

.layout-shell--sidebar-collapsed {
  --map-sidebar-width: 56px;
}

.layout-shell--initiative-collapsed {
  --initiative-sidebar-width: 56px;
}

@media (max-width: 1100px) {
  .layout-shell,
  .layout-shell--sidebar-collapsed,
  .layout-shell--initiative-collapsed {
    grid-template-columns: 1fr;
  }

}

</style>
