<script setup lang="ts">
import AppNavigation from '~/components/AppNavigation.vue'
import SaveIndicator from '~/components/SaveIndicator.vue'
import SheetBrowser from '~/components/SheetBrowser.vue'
import MapDetailsPanel from '~/components/map/MapDetailsPanel.vue'
import MapFieldEffectsPanel from '~/components/map/FieldEffectsPanel.vue'
import MapTerrainHazardsPanel from '~/components/map/TerrainHazardsPanel.vue'
import { mapLibraryPath } from '~/utils/mapRoutes'
import type { SaveStatus } from '~/composables/useEditableSheet'
import type { MapTokenSheetSelection } from '~/composables/map-editor/useTokenControls'
import type { BuildTool, MapEditorMode, MapLeftSidebarSection } from '~/shared/mapEditor'
import type {
  LayerVisibility,
  MapRoomEffect,
  MapRoomKind,
  MapTerrainEffect,
  MapTerrainKind,
  MapWeatherEffect,
  MapWeatherKind,
  TabletopMap,
  VoxelMaterial,
  MapHazardKind,
} from '~/types/map'
import type { MapEffectDefinition } from '~/utils/mapFieldEffects'
import type { MapHazardDefinition } from '~/utils/mapHazards'
import type { VoxelMaterialDef } from '~/utils/voxels'

type LayerVisibilityKey = keyof LayerVisibility
type DimensionAxis = 'x' | 'y' | 'z'

defineProps<{
  collapsed: boolean
  map: TabletopMap | null
  canViewMap: boolean
  saveIndicatorStatus: SaveStatus | null
  error: string | null
  sectionCollapsed: Record<MapLeftSidebarSection, boolean>
  isGm: boolean
  canEditMap: boolean
  canSpawnTokens: boolean
  buildMode: boolean
  hazardMode: boolean
  buildTool: BuildTool
  buildMaterial: VoxelMaterial
  buildColor: string | null
  visibleVoxelMaterials: readonly VoxelMaterialDef[]
  colorPickerValue: string
  voxelCount: number
  hazardCount: number
  hazardTool: BuildTool
  hazardKind: MapHazardKind
  activeHazardDef: MapHazardDefinition
  hazardPalette: MapHazardDefinition[]
  layerVisibility: LayerVisibility
  layerOptions: readonly LayerVisibilityKey[]
  fieldEffectCount: number
  weatherCoexistNext: boolean
  activeWeatherEffects: MapWeatherEffect[]
  activeTerrainEffects: MapTerrainEffect[]
  activeRoomEffects: MapRoomEffect[]
  weatherPalette: MapEffectDefinition<MapWeatherKind>[]
  terrainPalette: MapEffectDefinition<MapTerrainKind>[]
  roomPalette: MapEffectDefinition<MapRoomKind>[]
  weatherDefinition: (kind: MapWeatherKind) => MapEffectDefinition<MapWeatherKind>
  terrainDefinition: (kind: MapTerrainKind) => MapEffectDefinition<MapTerrainKind>
  roomDefinition: (kind: MapRoomKind) => MapEffectDefinition<MapRoomKind>
  weatherIsActive: (kind: MapWeatherKind) => boolean
  terrainIsActive: (kind: MapTerrainKind) => boolean
  roomIsActive: (kind: MapRoomKind) => boolean
  durationLabel: (rounds: number | null | undefined) => string
}>()

const emit = defineEmits<{
  (event: 'toggle-collapsed'): void
  (event: 'toggle-section', section: MapLeftSidebarSection): void
  (event: 'update-player-visible', value: boolean): void
  (event: 'update-dimension', axis: DimensionAxis, value: number | string): void
  (event: 'set-mode', mode: MapEditorMode): void
  (event: 'set-build-tool', tool: BuildTool): void
  (event: 'select-material', material: VoxelMaterial): void
  (event: 'color-input', value: Event): void
  (event: 'clear-custom-color'): void
  (event: 'fill-ground'): void
  (event: 'clear-all-voxels'): void
  (event: 'set-layer-visibility', layer: LayerVisibilityKey, value: boolean): void
  (event: 'set-hazard-tool', tool: BuildTool): void
  (event: 'select-hazard-kind', kind: MapHazardKind): void
  (event: 'clear-all-hazards'): void
  (event: 'set-weather', kind: MapWeatherKind): void
  (event: 'remove-weather', kind: MapWeatherKind): void
  (event: 'clear-weather'): void
  (event: 'update-weather-coexist-next', value: boolean): void
  (event: 'toggle-terrain', kind: MapTerrainKind): void
  (event: 'remove-terrain', kind: MapTerrainKind): void
  (event: 'toggle-room', kind: MapRoomKind): void
  (event: 'remove-room', kind: MapRoomKind): void
  (event: 'set-weather-rounds', kind: MapWeatherKind, value: Event): void
  (event: 'set-terrain-rounds', kind: MapTerrainKind, value: Event): void
  (event: 'set-room-rounds', kind: MapRoomKind, value: Event): void
  (event: 'tick-durations'): void
  (event: 'clear-all-field-effects'): void
  (event: 'spawn-sheet', selection: MapTokenSheetSelection): void
}>()
</script>

<template>
  <aside
    class="sidebar"
    :class="{ 'sidebar--collapsed': collapsed }"
    :aria-label="collapsed ? 'Collapsed map sidebar' : 'Map sidebar'"
  >
    <div class="sidebar-toggle-row">
      <button
        type="button"
        class="sidebar-toggle"
        :aria-expanded="!collapsed"
        aria-controls="map-sidebar-content"
        :aria-label="collapsed ? 'Expand map sidebar' : 'Collapse map sidebar'"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="emit('toggle-collapsed')"
      >
        <span aria-hidden="true">{{ collapsed ? '›' : '‹' }}</span>
        <span class="sidebar-toggle__label">{{ collapsed ? 'Expand' : 'Collapse' }}</span>
      </button>
    </div>

    <div id="map-sidebar-content" v-show="!collapsed" class="sidebar-content">
      <AppNavigation />

      <div class="header-row">
        <NuxtLink :to="mapLibraryPath()" class="back-link">← All maps</NuxtLink>
        <SaveIndicator
          v-if="saveIndicatorStatus"
          :status="saveIndicatorStatus"
          :error="error"
        />
      </div>

      <MapDetailsPanel
        v-if="map && canViewMap"
        :collapsed="sectionCollapsed.details"
        :name="map.name"
        :dimensions="map.dimensions"
        :player-visible="map.playerVisible"
        :is-gm="isGm"
        :can-edit-map="canEditMap"
        @toggle-collapsed="emit('toggle-section', 'details')"
        @update-player-visible="emit('update-player-visible', $event)"
        @update-dimension="(axis, value) => emit('update-dimension', axis, value)"
      />

      <MapTerrainHazardsPanel
        v-if="map && canViewMap"
        :collapsed="sectionCollapsed.terrain"
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
        @toggle-collapsed="emit('toggle-section', 'terrain')"
        @set-mode="emit('set-mode', $event)"
        @set-build-tool="emit('set-build-tool', $event)"
        @select-material="emit('select-material', $event)"
        @color-input="emit('color-input', $event)"
        @clear-custom-color="emit('clear-custom-color')"
        @fill-ground="emit('fill-ground')"
        @clear-all-voxels="emit('clear-all-voxels')"
        @set-layer-visibility="(layer, value) => emit('set-layer-visibility', layer, value)"
        @set-hazard-tool="emit('set-hazard-tool', $event)"
        @select-hazard-kind="emit('select-hazard-kind', $event)"
        @clear-all-hazards="emit('clear-all-hazards')"
      />

      <MapFieldEffectsPanel
        v-if="map && canViewMap"
        :collapsed="sectionCollapsed.fieldEffects"
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
        @toggle-collapsed="emit('toggle-section', 'fieldEffects')"
        @set-weather="emit('set-weather', $event)"
        @remove-weather="emit('remove-weather', $event)"
        @clear-weather="emit('clear-weather')"
        @update-weather-coexist-next="emit('update-weather-coexist-next', $event)"
        @toggle-terrain="emit('toggle-terrain', $event)"
        @remove-terrain="emit('remove-terrain', $event)"
        @toggle-room="emit('toggle-room', $event)"
        @remove-room="emit('remove-room', $event)"
        @set-weather-rounds="(kind, value) => emit('set-weather-rounds', kind, value)"
        @set-terrain-rounds="(kind, value) => emit('set-terrain-rounds', kind, value)"
        @set-room-rounds="(kind, value) => emit('set-room-rounds', kind, value)"
        @tick-durations="emit('tick-durations')"
        @clear-all="emit('clear-all-field-effects')"
      />

      <SheetBrowser v-if="map && canSpawnTokens" @select="emit('spawn-sheet', $event)" />
    </div>
  </aside>
</template>

<style scoped>
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

@media (max-width: 1100px) {
  .sidebar {
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }
}
</style>
