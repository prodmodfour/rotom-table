<script setup lang="ts">
import HazardBuilderControls from '~/components/map/HazardBuilderControls.vue'
import LayerVisibilityControls from '~/components/map/LayerVisibilityControls.vue'
import MapEditorModeToggle from '~/components/map/MapEditorModeToggle.vue'
import TerrainBuilderControls from '~/components/map/TerrainBuilderControls.vue'
import type { VoxelMaterialDef } from '~/utils/voxels'
import type { BuildTool } from '~/shared/mapEditor'
import type { LayerVisibility, MapHazardKind, VoxelMaterial } from '~/types/map'
import type { MapHazardDefinition } from '~/utils/mapHazards'

type LayerVisibilityKey = keyof LayerVisibility

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
  layerOptions: readonly LayerVisibilityKey[]
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
  (event: 'set-layer-visibility', layer: LayerVisibilityKey, value: boolean): void
  (event: 'set-hazard-tool', tool: BuildTool): void
  (event: 'select-hazard-kind', kind: MapHazardKind): void
  (event: 'clear-all-hazards'): void
}>()

</script>

<template>
  <section class="panel-card terrain-panel">
    <div class="panel-heading panel-heading--collapsible">
      <button
        type="button"
        class="section-toggle-button"
        :aria-expanded="!collapsed"
        aria-controls="map-terrain-section"
        @click="emit('toggle-collapsed')"
      >
        <span class="section-toggle-button__chevron" aria-hidden="true">
          {{ collapsed ? '›' : '⌄' }}
        </span>
        <span class="section-toggle-button__title">Terrain</span>
      </button>
      <span class="badge">
        {{ voxelCount }} block{{ voxelCount === 1 ? '' : 's' }} · {{ hazardCount }} hazard{{ hazardCount === 1 ? '' : 's' }}
      </span>
    </div>

    <div id="map-terrain-section" v-show="!collapsed" class="collapsible-section-body">
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
    </div>
  </section>
</template>

<style scoped>
.panel-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.panel-heading h2 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-heading--collapsible {
  margin-bottom: 0;
}

.section-toggle-button {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  background: transparent;
  color: var(--ink-bright);
  padding: 0;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.section-toggle-button:hover,
.section-toggle-button:focus-visible {
  color: var(--accent);
}

.section-toggle-button:focus-visible {
  outline: 2px solid rgba(250, 189, 47, 0.35);
  outline-offset: 3px;
  border-radius: 8px;
}

.section-toggle-button__chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15rem;
  height: 1.15rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  color: var(--accent);
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1;
}

.section-toggle-button__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.collapsible-section-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.permission-note {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.86rem;
  line-height: 1.45;
}

.terrain-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

</style>
