<script setup lang="ts">
import CollapsiblePanelCard from '~/components/map/CollapsiblePanelCard.vue'
import HazardBuilderControls from '~/components/map/HazardBuilderControls.vue'
import LayerVisibilityControls from '~/components/map/LayerVisibilityControls.vue'
import MapEditorModeToggle from '~/components/map/MapEditorModeToggle.vue'
import TerrainBuilderControls from '~/components/map/TerrainBuilderControls.vue'
import { formatTerrainHazardBadge } from '~/utils/mapPanelBadges'
import type { MapLayerVisibilityKey } from '~/utils/mapLayerVisibility'
import type { VoxelMaterialDef } from '~/utils/voxelMaterials'
import type { BuildTool } from '#shared/mapEditor'
import type { LayerVisibility, MapHazardKind, VoxelMaterial } from '~/types/map'
import type { MapHazardDefinition } from '~/utils/mapHazardDefinitions'

defineProps<{
  collapsed: boolean
  canEditMap: boolean
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
  layerOptions: readonly MapLayerVisibilityKey[]
}>()

const emit = defineEmits<{
  (event: 'toggle-collapsed'): void
  (event: 'set-mode', mode: 'play' | 'build' | 'hazards'): void
  (event: 'set-build-tool', tool: BuildTool): void
  (event: 'select-material', material: VoxelMaterial): void
  (event: 'color-input', value: Event): void
  (event: 'clear-custom-color'): void
  (event: 'fill-ground'): void
  (event: 'clear-all-voxels'): void
  (event: 'set-layer-visibility', layer: MapLayerVisibilityKey, value: boolean): void
  (event: 'set-hazard-tool', tool: BuildTool): void
  (event: 'select-hazard-kind', kind: MapHazardKind): void
  (event: 'clear-all-hazards'): void
}>()

</script>

<template>
  <CollapsiblePanelCard
    class="terrain-panel"
    title="Terrain"
    :badge="formatTerrainHazardBadge(voxelCount, hazardCount)"
    :collapsed="collapsed"
    controls-id="map-terrain-section"
    @toggle-collapsed="emit('toggle-collapsed')"
  >
    <MapEditorModeToggle
      v-if="canEditMap"
      :build-mode="buildMode"
      :hazard-mode="hazardMode"
      @set-mode="emit('set-mode', $event)"
    />
    <p v-else class="permission-note">
      Terrain editing is GM-only.
    </p>

    <template v-if="buildMode && canEditMap">
      <TerrainBuilderControls
        :build-tool="buildTool"
        :build-material="buildMaterial"
        :build-color="buildColor"
        :visible-voxel-materials="visibleVoxelMaterials"
        :color-picker-value="colorPickerValue"
        :voxel-count="voxelCount"
        @set-build-tool="emit('set-build-tool', $event)"
        @select-material="emit('select-material', $event)"
        @color-input="emit('color-input', $event)"
        @clear-custom-color="emit('clear-custom-color')"
        @fill-ground="emit('fill-ground')"
        @clear-all-voxels="emit('clear-all-voxels')"
      />

      <LayerVisibilityControls
        :layer-visibility="layerVisibility"
        :layer-options="layerOptions"
        @set-layer-visibility="(layer, value) => emit('set-layer-visibility', layer, value)"
      />
    </template>

    <template v-if="hazardMode && canEditMap">
      <HazardBuilderControls
        :hazard-tool="hazardTool"
        :hazard-kind="hazardKind"
        :active-hazard-def="activeHazardDef"
        :hazard-palette="hazardPalette"
        :hazard-count="hazardCount"
        @set-hazard-tool="emit('set-hazard-tool', $event)"
        @select-hazard-kind="emit('select-hazard-kind', $event)"
        @clear-all-hazards="emit('clear-all-hazards')"
      />
    </template>
  </CollapsiblePanelCard>
</template>

<style scoped>
.permission-note {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.86rem;
  line-height: 1.45;
}
</style>
