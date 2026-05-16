<script setup lang="ts">
import { computed, ref } from 'vue'
import MapAdminPanel from '~/components/map/MapAdminPanel.vue'
import MapEditorLayout from '~/components/map/MapEditorLayout.vue'
import MapInitiativeSidebar from '~/components/map/MapInitiativeSidebar.vue'
import MapLeftSidebar from '~/components/map/MapLeftSidebar.vue'
import MapScenePanel from '~/components/map/MapScenePanel.vue'
import { useEditableMap } from '~/composables/useEditableMap'
import { useLiveSheets } from '~/composables/useLiveSheets'
import { useFieldEffectsEditor } from '~/composables/map-editor/useFieldEffectsEditor'
import { useHazardBuilder } from '~/composables/map-editor/useHazardBuilder'
import { useInitiativeTracker } from '~/composables/map-editor/useInitiativeTracker'
import { useMapAccess, useMapGmModeGuard } from '~/composables/map-editor/useMapAccess'
import {
  useMapDimensionControls,
  useMapDimensionReconciliation,
} from '~/composables/map-editor/useMapDimensions'
import { useMapEditorUiState } from '~/composables/map-editor/useMapEditorUiState'
import { useMapTokenNavigation } from '~/composables/map-editor/useMapTokenNavigation'
import { useAbilityAutomationPanel } from '~/composables/map-editor/useAbilityAutomationPanel'
import { useMoveAutomationPanel } from '~/composables/map-editor/useMoveAutomationPanel'
import { useTerrainBuilder } from '~/composables/map-editor/useTerrainBuilder'
import { useTokenSheetMutations } from '~/composables/map-editor/useTokenSheetMutations'
import { useTokenControls } from '~/composables/map-editor/useTokenControls'
import { mapEditorPath, mapLibraryPath } from '~/utils/mapRoutes'
import { routeSlugParam } from '~/utils/routeParams'
import type { SaveStatus } from '~/composables/useEditableSheet'

definePageMeta({
  key: (route) => `map-${routeSlugParam(route.params)}`,
})

const route = useRoute()
const router = useRouter()
const { isGm, isPlayer } = useAuth()
const slug = routeSlugParam(route.params)

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

const {
  canEditMap,
  canManageInitiative,
  canSpawnTokens,
  canViewMap,
} = useMapAccess({
  map,
  isGm,
  isPlayer,
  redirectHiddenPlayerMap: () => router.replace(mapLibraryPath()),
})

const {
  mapVoxels,
  mapHazards,
  groundLevelYMax,
  mapGroundLevelY,
  mapSpecificYMin,
  mapSpecificYMax,
  setMapPlayerVisible,
  setMapDimension,
  setGroundLevelY,
} = useMapDimensionControls({ map, canEditMap, isGm })

const {
  selectedId,
  previewState,
  sheetLookup,
  spawnedPokemon,
  controllablePlacementIds,
  tokenSendOutOptionsById,
  canControlPlacement,
  placementById,
  clearSelection,
  updatePreview,
  spawnSheet,
  sendOutPokemon,
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
  buildGhostVoxel,
  ghostVoxelsFaded,
  visibleVoxelMaterials,
  colorPickerValue,
  placeVoxel,
  removeVoxel,
  selectMaterial,
  setTool,
  handleColorInput,
  clearCustomColor,
  setBuildGhostVoxel,
  setGhostVoxelsFaded,
  fillGround,
  clearAllVoxels,
} = useTerrainBuilder({ map, mapVoxels, mapGroundLevelY, spawnedPokemon, canEditMap })

const {
  sidebarCollapsed,
  initiativeCollapsed,
  adminPanelOpen,
  leftSidebarSectionsCollapsed,
  layerVisibility,
  layerOptions,
  toggleSidebarCollapsed,
  toggleInitiativeCollapsed,
  toggleLeftSection,
  setMode,
  setLayerVisibility,
} = useMapEditorUiState({
  isGm,
  canEditMap,
  buildMode,
  hazardMode,
  clearSelection,
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
  modifyAbilityActivation,
} = useTokenSheetMutations({
  map,
  sheetLookup,
  canControlPlacement,
})

const {
  moveAutomationId,
  moveAutomationUser,
  moveAutomationMoves,
  moveAutomationInitialMoveName,
  moveAutomationTargeting,
  moveAutomationFeedback,
  spiteReactionPrompts,
  cuteCharmReactionPrompts,
  moxieTriggerPrompts,
  tokenMoveOptionsById,
  openMoveAutomation,
  closeMoveAutomation,
  cancelMoveAutomationTargeting,
  selectMoveAutomationTarget,
  selectMoveAutomationAreaDirection,
  dismissSpiteReactionPrompt,
  applySpiteReactionPrompt,
  dismissCuteCharmReactionPrompt,
  applyCuteCharmReactionPrompt,
  dismissMoxieTriggerPrompt,
  applyMoxieTriggerPrompt,
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

const {
  abilityAutomationTargeting,
  tokenAbilityOptionsById,
  openAbilityAutomation,
  cancelAbilityAutomationTargeting,
  selectAbilityAutomationTarget,
} = useAbilityAutomationPanel({
  map,
  spawnedPokemon,
  pokemonBySlug,
  trainerBySlug,
  canControlPlacement,
  modifyCombatStages,
  modifyAbilityActivation,
})

const actionAutomationTargeting = computed(() =>
  moveAutomationTargeting.value ?? abilityAutomationTargeting.value,
)

const openMoveAutomationFromContext = (payload: { id: string; moveName?: string | null }) => {
  cancelAbilityAutomationTargeting()
  openMoveAutomation(payload)
}

const openAbilityAutomationFromContext = (payload: { id: string; abilityName?: string | null }) => {
  closeMoveAutomation()
  cancelMoveAutomationTargeting()
  void openAbilityAutomation(payload)
}

const selectActionAutomationTarget = (targetId: string) => {
  if (moveAutomationTargeting.value) {
    selectMoveAutomationTarget(targetId)
    return
  }
  if (abilityAutomationTargeting.value) void selectAbilityAutomationTarget(targetId)
}

const cancelActionAutomationTargeting = () => {
  if (moveAutomationTargeting.value) {
    cancelMoveAutomationTargeting()
    return
  }
  cancelAbilityAutomationTargeting()
}

useMapGmModeGuard({
  isGm,
  buildMode,
  hazardMode,
  adminPanelOpen,
  selectedId,
  moveAutomationId,
  canControlPlacement,
  clearSelection,
  closeMoveAutomation,
})

const { viewSheet, viewPokedex } = useMapTokenNavigation({
  map,
  pokemonBySlug,
  canControlPlacement,
  placementById,
  resolvePath: (path) => router.resolve(path).href,
})

useMapDimensionReconciliation({
  map,
  spawnedPokemon,
  selectedId,
  clearSelection,
})
</script>

<template>
  <MapEditorLayout
    :sidebar-collapsed="sidebarCollapsed"
    :initiative-collapsed="initiativeCollapsed"
  >
    <template #left>
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
        :build-ghost-voxel="buildGhostVoxel"
        :ghost-voxels-faded="ghostVoxelsFaded"
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
        @toggle-collapsed="toggleSidebarCollapsed"
        @toggle-section="toggleLeftSection"
        @update-player-visible="setMapPlayerVisible"
        @update-dimension="setMapDimension"
        @set-mode="setMode"
        @set-build-tool="setTool"
        @select-material="selectMaterial"
        @color-input="handleColorInput"
        @clear-custom-color="clearCustomColor"
        @set-build-ghost-voxel="setBuildGhostVoxel"
        @set-ghost-voxels-faded="setGhostVoxelsFaded"
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
    </template>

    <template #scene>
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
        :build-ghost-voxel="buildGhostVoxel"
        :ghost-voxels-faded="ghostVoxelsFaded"
        :hazard-mode="hazardMode && canEditMap"
        :hazard-tool="hazardTool"
        :hazard-kind="hazardKind"
        :can-delete-tokens="isGm"
        :move-automation-user="moveAutomationUser"
        :move-automation-moves="moveAutomationMoves"
        :move-automation-initial-move-name="moveAutomationInitialMoveName"
        :move-automation-targeting="actionAutomationTargeting"
        :move-automation-feedback="moveAutomationFeedback"
        :spite-reaction-prompts="spiteReactionPrompts"
        :cute-charm-reaction-prompts="cuteCharmReactionPrompts"
        :moxie-trigger-prompts="moxieTriggerPrompts"
        :token-move-options-by-id="tokenMoveOptionsById"
        :token-ability-options-by-id="tokenAbilityOptionsById"
        :token-send-out-options-by-id="tokenSendOutOptionsById"
        :can-apply-map-effects="canEditMap"
        @select-pokemon="selectPokemon"
        @move-pokemon="movePokemon"
        @turn-pokemon="turnPokemon"
        @delete-pokemon="deletePokemon"
        @modify-hp="modifyHp"
        @modify-combat-stages="modifyCombatStages"
        @modify-conditions="modifyConditions"
        @use-move="openMoveAutomationFromContext"
        @use-ability="openAbilityAutomationFromContext"
        @send-out-pokemon="sendOutPokemon"
        @view-sheet="viewSheet"
        @view-pokedex="viewPokedex"
        @preview-change="updatePreview"
        @place-voxel="placeVoxel"
        @remove-voxel="removeVoxel"
        @place-hazard="placeHazard"
        @remove-hazard="removeHazard"
        @close-move-automation="closeMoveAutomation"
        @apply-move-automation="applyMoveAutomation"
        @select-move-target="selectActionAutomationTarget"
        @select-move-area-direction="selectMoveAutomationAreaDirection"
        @cancel-move-targeting="cancelActionAutomationTargeting"
        @dismiss-spite-reaction="dismissSpiteReactionPrompt"
        @apply-spite-reaction="applySpiteReactionPrompt"
        @dismiss-cute-charm-reaction="dismissCuteCharmReactionPrompt"
        @apply-cute-charm-reaction="applyCuteCharmReactionPrompt"
        @dismiss-moxie-trigger="dismissMoxieTriggerPrompt"
        @apply-moxie-trigger="applyMoxieTriggerPrompt"
      />
    </template>

    <template #right>
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
        @toggle-collapsed="toggleInitiativeCollapsed"
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
    </template>

    <template #admin>
      <MapAdminPanel
        v-if="map && isGm && adminPanelOpen"
        :ground-level-y-max="groundLevelYMax"
        :map-ground-level-y="mapGroundLevelY"
        :map-specific-y-min="mapSpecificYMin"
        :map-specific-y-max="mapSpecificYMax"
        @close="adminPanelOpen = false"
        @set-ground-level-y="setGroundLevelY"
      />
    </template>
  </MapEditorLayout>
</template>
