<script setup lang="ts">
import CollapsiblePanelCard from '~/components/map/CollapsiblePanelCard.vue'
import LayerVisibilityControls from '~/components/map/LayerVisibilityControls.vue'
import TerrainBuilderControls from '~/components/map/TerrainBuilderControls.vue'
import { formatTerrainBuildBadge } from '~/utils/mapPanelBadges'
import type { MapLayerVisibilityKey } from '~/utils/mapLayerVisibility'
import type { VoxelMaterialDef } from '~/utils/voxelMaterials'
import type { BuildTool } from '#shared/mapEditor'
import type { LayerVisibility, VoxelMaterial } from '~/types/map'

defineProps<{
  collapsed: boolean
  canEditMap: boolean
  buildTool: BuildTool
  buildMaterial: VoxelMaterial
  buildColor: string | null
  buildGhostVoxel: boolean
  ghostVoxelsFaded: boolean
  visibleVoxelMaterials: readonly VoxelMaterialDef[]
  colorPickerValue: string
  voxelCount: number
  layerVisibility: LayerVisibility
  layerOptions: readonly MapLayerVisibilityKey[]
}>()

const emit = defineEmits<{
  (event: 'toggle-collapsed'): void
  (event: 'set-build-tool', tool: BuildTool): void
  (event: 'select-material', material: VoxelMaterial): void
  (event: 'color-input', value: Event): void
  (event: 'clear-custom-color'): void
  (event: 'set-build-ghost-voxel', value: boolean): void
  (event: 'set-ghost-voxels-faded', value: boolean): void
  (event: 'fill-ground'): void
  (event: 'clear-all-voxels'): void
  (event: 'set-layer-visibility', layer: MapLayerVisibilityKey, value: boolean): void
}>()

</script>

<template>
  <CollapsiblePanelCard
    class="terrain-panel"
    title="Terrain Build"
    :badge="formatTerrainBuildBadge(voxelCount)"
    :collapsed="collapsed"
    controls-id="map-terrain-section"
    @toggle-collapsed="emit('toggle-collapsed')"
  >
    <template v-if="canEditMap">
      <TerrainBuilderControls
        :build-tool="buildTool"
        :build-material="buildMaterial"
        :build-color="buildColor"
        :build-ghost-voxel="buildGhostVoxel"
        :ghost-voxels-faded="ghostVoxelsFaded"
        :visible-voxel-materials="visibleVoxelMaterials"
        :color-picker-value="colorPickerValue"
        :voxel-count="voxelCount"
        @set-build-tool="emit('set-build-tool', $event)"
        @select-material="emit('select-material', $event)"
        @color-input="emit('color-input', $event)"
        @clear-custom-color="emit('clear-custom-color')"
        @set-build-ghost-voxel="emit('set-build-ghost-voxel', $event)"
        @set-ghost-voxels-faded="emit('set-ghost-voxels-faded', $event)"
        @fill-ground="emit('fill-ground')"
        @clear-all-voxels="emit('clear-all-voxels')"
      />

      <LayerVisibilityControls
        :layer-visibility="layerVisibility"
        :layer-options="layerOptions"
        @set-layer-visibility="(layer, value) => emit('set-layer-visibility', layer, value)"
      />
    </template>

    <p v-else class="permission-note">
      Terrain editing is GM-only.
    </p>
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
