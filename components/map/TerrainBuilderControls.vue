<script setup lang="ts">
import BuildToolToggle from '~/components/map/BuildToolToggle.vue'
import TerrainColorPicker from '~/components/map/TerrainColorPicker.vue'
import TerrainMaterialGrid from '~/components/map/TerrainMaterialGrid.vue'
import type { VoxelMaterialDef } from '~/utils/voxels'
import type { BuildTool } from '~/shared/mapEditor'
import type { VoxelMaterial } from '~/types/map'

defineProps<{
  buildTool: BuildTool
  buildMaterial: VoxelMaterial
  buildColor: string | null
  visibleVoxelMaterials: readonly VoxelMaterialDef[]
  colorPickerValue: string
  voxelCount: number
}>()

const emit = defineEmits<{
  (event: 'set-build-tool', tool: BuildTool): void
  (event: 'select-material', material: VoxelMaterial): void
  (event: 'color-input', value: Event): void
  (event: 'clear-custom-color'): void
  (event: 'fill-ground'): void
  (event: 'clear-all-voxels'): void
}>()
</script>

<template>
  <BuildToolToggle
    aria-label="Build tool"
    :active-tool="buildTool"
    @set-tool="emit('set-build-tool', $event)"
  />

  <TerrainMaterialGrid
    :active-material="buildMaterial"
    :has-custom-color="Boolean(buildColor)"
    :materials="visibleVoxelMaterials"
    @select-material="emit('select-material', $event)"
  />

  <TerrainColorPicker
    :color-picker-value="colorPickerValue"
    :has-custom-color="Boolean(buildColor)"
    @color-input="emit('color-input', $event)"
    @clear-custom-color="emit('clear-custom-color')"
  />

  <p class="hint">
    Left click to {{ buildTool === 'pencil' ? 'place' : 'erase' }}, right click to
    erase. Click a voxel face to stack on top.
  </p>

  <div class="bulk-row">
    <button
      type="button"
      class="bulk-button"
      :disabled="buildTool === 'eraser'"
      @click="emit('fill-ground')"
    >
      Fill ground
    </button>
    <button
      type="button"
      class="bulk-button bulk-button--danger"
      :disabled="!voxelCount"
      @click="emit('clear-all-voxels')"
    >
      Clear all
    </button>
  </div>
</template>

<style scoped>
.hint {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  line-height: 1.4;
}

.bulk-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.bulk-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.7rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.bulk-button:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.bulk-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bulk-button--danger {
  color: #fb4934;
}

.bulk-button--danger:hover:not(:disabled) {
  border-color: #fb4934;
  background: rgba(251, 73, 52, 0.08);
}
</style>
