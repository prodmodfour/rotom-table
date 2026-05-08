<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import IsometricGrid from '~/components/IsometricGrid.client.vue'
import MapAdminPanel from '~/components/map/MapAdminPanel.vue'
import MapDetailsPanel from '~/components/map/MapDetailsPanel.vue'
import MapFieldEffectsPanel from '~/components/map/FieldEffectsPanel.vue'
import MapInitiativeTracker from '~/components/map/InitiativeTracker.vue'
import MapTerrainHazardsPanel from '~/components/map/TerrainHazardsPanel.vue'
import SheetBrowser from '~/components/SheetBrowser.vue'
import SaveIndicator from '~/components/SaveIndicator.vue'
import { useEditableMap } from '~/composables/useEditableMap'
import { useLiveSheets } from '~/composables/useLiveSheets'
import { useFieldEffectsEditor } from '~/composables/map-editor/useFieldEffectsEditor'
import { useHazardBuilder } from '~/composables/map-editor/useHazardBuilder'
import { useInitiativeTracker } from '~/composables/map-editor/useInitiativeTracker'
import { useMoveAutomationPanel } from '~/composables/map-editor/useMoveAutomationPanel'
import { useTerrainBuilder } from '~/composables/map-editor/useTerrainBuilder'
import {
  pokedexPathForSpecies,
  sheetPathForPlacement,
  useTokenControls,
} from '~/composables/map-editor/useTokenControls'
import {
  normalizeDimensions,
  reconcilePokemonPositions,
} from '~/utils/grid'
import { filterMapHazardsInBounds } from '~/utils/mapHazards'
import { filterVoxelsInBounds } from '~/utils/voxels'
import { getClientId } from '~/utils/clientId'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  applyHpToSheet,
  commitSheetUpdate,
  createSheetUpdateForPlacement,
  rollbackSheetUpdate,
  toPersistableSheetPayload,
  type PlacementSheetUpdater,
} from '~/utils/sheetMutations'
import type { CombatStageMap } from '~/types/combatStages'
import type {
  MapHazardV2,
  MapVoxelV2,
} from '~/types/map'
import type { SaveStatus } from '~/composables/useEditableSheet'

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
  if (newSlug) router.replace(`/maps/${newSlug}`)
})

useHead(() => ({
  title: map.value ? `${map.value.name} · Maps` : 'Maps · Rotom Table',
}))

interface IsometricGridHandle {
  focusPokemon: (id: string) => boolean
}

const gridRef = ref<IsometricGridHandle | null>(null)
const sidebarCollapsed = ref(false)
const initiativeCollapsed = ref(false)
const adminPanelOpen = ref(false)

type LeftSidebarSectionKey = 'details' | 'terrain' | 'fieldEffects'
const leftSidebarSectionsCollapsed = ref<Record<LeftSidebarSectionKey, boolean>>({
  details: false,
  terrain: false,
  fieldEffects: false,
})
const leftSectionCollapsed = (section: LeftSidebarSectionKey): boolean =>
  leftSidebarSectionsCollapsed.value[section]
const toggleLeftSection = (section: LeftSidebarSectionKey) => {
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
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    adminPanelOpen.value = !adminPanelOpen.value
    return
  }

  if (event.key === 'Escape' && adminPanelOpen.value) {
    adminPanelOpen.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleAdminShortcut)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleAdminShortcut)
})

watch(
  [() => map.value?.slug, isPlayer],
  () => {
    if (map.value && isPlayer.value && map.value.playerVisible !== true) {
      void router.replace('/maps')
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

const updatePlacedSheet = async (
  id: string,
  update: PlacementSheetUpdater,
  logLabel: string,
  options: { allowAnyTarget?: boolean } = {},
) => {
  if (!map.value || (!options.allowAnyTarget && !canControlPlacement(id))) return
  const placement = map.value.placements.find((p) => p.id === id)
  if (!placement) return

  const context = createSheetUpdateForPlacement(
    placement,
    sheetLookup.value,
    update,
  )
  if (!context) return

  commitSheetUpdate(context)
  try {
    await $fetch('/api/sheets/save', {
      method: 'POST',
      body: {
        kind: context.kind,
        slug: context.slug,
        sheet: toPersistableSheetPayload(context.updated),
        clientId: getClientId(),
      },
    })
  } catch (err) {
    rollbackSheetUpdate(context)
    console.error(`[${logLabel}] save failed`, err)
  }
}

const modifyHp = async (
  payload: { id: string; currentHp: number },
  options: { allowAnyTarget?: boolean } = {},
) => updatePlacedSheet(
  payload.id,
  (kind, sheet) => applyHpToSheet(kind, sheet, payload.currentHp),
  'modifyHp',
  options,
)

const modifyCombatStages = async (
  payload: { id: string; stages: CombatStageMap },
  options: { allowAnyTarget?: boolean } = {},
) => updatePlacedSheet(
  payload.id,
  (kind, sheet) => applyCombatStagesToSheet(kind, sheet, payload.stages),
  'modifyCombatStages',
  options,
)

const modifyConditions = async (
  payload: { id: string; conditions: string[] },
  options: { allowAnyTarget?: boolean } = {},
) => updatePlacedSheet(
  payload.id,
  (kind, sheet) => applyConditionsToSheet(kind, sheet, payload.conditions),
  'modifyConditions',
  options,
)

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

const setMode = (mode: 'play' | 'build' | 'hazards') => {
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
    <aside
      class="sidebar"
      :class="{ 'sidebar--collapsed': sidebarCollapsed }"
      :aria-label="sidebarCollapsed ? 'Collapsed map sidebar' : 'Map sidebar'"
    >
      <div class="sidebar-toggle-row">
        <button
          type="button"
          class="sidebar-toggle"
          :aria-expanded="!sidebarCollapsed"
          aria-controls="map-sidebar-content"
          :aria-label="sidebarCollapsed ? 'Expand map sidebar' : 'Collapse map sidebar'"
          :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <span aria-hidden="true">{{ sidebarCollapsed ? '›' : '‹' }}</span>
          <span class="sidebar-toggle__label">{{ sidebarCollapsed ? 'Expand' : 'Collapse' }}</span>
        </button>
      </div>

      <div id="map-sidebar-content" v-show="!sidebarCollapsed" class="sidebar-content">
        <AppNavigation />

        <div class="header-row">
          <NuxtLink to="/maps" class="back-link">← All maps</NuxtLink>
          <SaveIndicator
            v-if="saveIndicatorStatus"
            :status="saveIndicatorStatus"
            :error="error"
          />
        </div>

        <MapDetailsPanel
          v-if="map && canViewMap"
          :collapsed="leftSectionCollapsed('details')"
          :name="map.name"
          :dimensions="map.dimensions"
          :player-visible="map.playerVisible"
          :is-gm="isGm"
          :can-edit-map="canEditMap"
          @toggle-collapsed="toggleLeftSection('details')"
          @update-player-visible="setMapPlayerVisible"
          @update-dimension="setMapDimension"
        />

        <MapTerrainHazardsPanel
          v-if="map && canViewMap"
          :collapsed="leftSectionCollapsed('terrain')"
          :can-edit-map="canEditMap"
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
          @toggle-collapsed="toggleLeftSection('terrain')"
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
        />

        <MapFieldEffectsPanel
          v-if="map && canViewMap"
          :collapsed="leftSectionCollapsed('fieldEffects')"
          :can-edit-map="canEditMap"
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
          @toggle-collapsed="toggleLeftSection('fieldEffects')"
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
          @clear-all="clearAllFieldEffects"
        />

        <SheetBrowser v-if="map && canSpawnTokens" @select="spawnSheet" />
      </div>
    </aside>

    <main class="scene-column">
      <ClientOnly>
        <IsometricGrid
          v-if="map && canViewMap"
          ref="gridRef"
          :dimensions="map.dimensions"
          :pokemons="spawnedPokemon"
          :selected-id="selectedId"
          :controllable-ids="controllablePlacementIds"
          :active-turn-id="activeInitiativeId"
          :voxels="mapVoxels"
          :hazards="mapHazards"
          :field-effects="mapFieldEffects"
          :ground-level-y="mapGroundLevelY"
          :layer-visibility="layerVisibility"
          :build-mode="buildMode && canEditMap"
          :build-tool="buildTool"
          :build-material="buildMaterial"
          :build-color="buildColor"
          :hazard-mode="hazardMode && canEditMap"
          :hazard-tool="hazardTool"
          :hazard-kind="hazardKind"
          :can-delete-tokens="isGm"
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
        />
        <div v-else-if="status === 'loading'" class="scene-loading">Loading map…</div>
        <div v-else-if="status === 'not-found'" class="scene-loading">
          <p>Map <code>{{ slug }}</code> not found.</p>
          <NuxtLink to="/maps" class="back-link">← Back to maps</NuxtLink>
        </div>
        <div v-else class="scene-loading">
          <p>{{ error ?? 'Could not load map.' }}</p>
        </div>

        <MoveAutomationDialog
          v-if="moveAutomationUser"
          :user="moveAutomationUser"
          :moves="moveAutomationMoves"
          :all-tokens="spawnedPokemon"
          :field-effects="mapFieldEffects"
          :can-apply-map-effects="canEditMap"
          @close="closeMoveAutomation"
          @apply="applyMoveAutomation"
        />

        <template #fallback>
          <div class="scene-loading">Loading the three.js tabletop…</div>
        </template>
      </ClientOnly>
    </main>

    <aside
      class="initiative-sidebar"
      :class="{ 'initiative-sidebar--collapsed': initiativeCollapsed }"
      :aria-label="initiativeCollapsed ? 'Collapsed initiative tracker' : 'Initiative tracker'"
    >
      <div class="initiative-toggle-row">
        <button
          type="button"
          class="initiative-toggle"
          :aria-expanded="!initiativeCollapsed"
          aria-controls="initiative-tracker-content"
          :aria-label="initiativeCollapsed ? 'Expand initiative tracker' : 'Collapse initiative tracker'"
          :title="initiativeCollapsed ? 'Expand initiative' : 'Collapse initiative'"
          @click="initiativeCollapsed = !initiativeCollapsed"
        >
          <span aria-hidden="true">{{ initiativeCollapsed ? '‹' : '›' }}</span>
          <span class="initiative-toggle__label">{{ initiativeCollapsed ? 'Expand' : 'Collapse' }}</span>
        </button>
      </div>

      <div
        id="initiative-tracker-content"
        v-show="!initiativeCollapsed"
        class="initiative-content"
      >
        <MapInitiativeTracker
          v-if="map && canViewMap"
          :rows="initiativeRows"
          :sorted-rows="sortedInitiativeRows"
          :active-id="activeInitiativeId"
          :round="initiativeRound"
          :selected-id="selectedId"
          :can-manage="canManageInitiative"
          :has-initiative-values="hasInitiativeValues"
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
      </div>
    </aside>

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

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
  padding: 0.85rem;
  border-right: 1px solid var(--rule);
  background: var(--paper);
  max-height: 100vh;
  overflow: auto;
  transition: padding 0.2s ease;
}

.sidebar--collapsed {
  align-items: center;
  padding: 0.65rem 0.45rem;
  overflow: hidden;
}

.sidebar-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
  min-height: 0;
}

.sidebar-toggle-row {
  display: flex;
  justify-content: flex-end;
  padding: 0 0.25rem;
}

.sidebar--collapsed .sidebar-toggle-row {
  justify-content: center;
  padding: 0;
}

.sidebar-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink-soft);
  padding: 0.4rem 0.7rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  line-height: 1;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.sidebar-toggle:hover,
.sidebar-toggle:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  outline: none;
}

.sidebar-toggle span[aria-hidden='true'] {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 0.8;
}

.sidebar--collapsed .sidebar-toggle {
  width: 38px;
  height: 38px;
  padding: 0;
}

.sidebar--collapsed .sidebar-toggle__label {
  display: none;
}

.scene-column {
  min-width: 0;
  min-height: 100vh;
  background: var(--paper);
}

.initiative-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
  padding: 0.85rem;
  border-left: 1px solid var(--rule);
  background: var(--paper);
  max-height: 100vh;
  overflow: auto;
  transition: padding 0.2s ease;
}

.initiative-sidebar--collapsed {
  align-items: center;
  padding: 0.65rem 0.45rem;
  overflow: hidden;
}

.initiative-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
  min-height: 0;
}

.initiative-toggle-row {
  display: flex;
  justify-content: flex-start;
  padding: 0 0.25rem;
}

.initiative-sidebar--collapsed .initiative-toggle-row {
  justify-content: center;
  padding: 0;
}

.initiative-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink-soft);
  padding: 0.4rem 0.7rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  line-height: 1;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.initiative-toggle:hover,
.initiative-toggle:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  outline: none;
}

.initiative-toggle span[aria-hidden='true'] {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 0.8;
}

.initiative-sidebar--collapsed .initiative-toggle {
  width: 38px;
  height: 38px;
  padding: 0;
}

.initiative-sidebar--collapsed .initiative-toggle__label {
  display: none;
}

.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0 0.25rem;
}

.back-link {
  color: var(--ink-soft);
  text-decoration: none;
  font-size: 0.9rem;
  letter-spacing: 0.02em;
}

.back-link:hover {
  color: var(--ink-bright);
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
}

.scene-loading {
  display: grid;
  place-items: center;
  min-height: 100vh;
  color: var(--ink-muted);
  background: var(--paper);
  font-style: italic;
  gap: 0.6rem;
  text-align: center;
}

@media (max-width: 1100px) {
  .layout-shell,
  .layout-shell--sidebar-collapsed,
  .layout-shell--initiative-collapsed {
    grid-template-columns: 1fr;
  }

  .sidebar {
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }

  .initiative-sidebar {
    max-height: none;
    border-left: 0;
    border-top: 1px solid var(--rule);
  }
}

</style>
