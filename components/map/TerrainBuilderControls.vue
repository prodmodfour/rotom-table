<script setup lang="ts">
import BuilderBulkActionRow from '~/components/map/BuilderBulkActionRow.vue'
import BuilderBulkButton from '~/components/map/BuilderBulkButton.vue'
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

  <BuilderBulkActionRow>
    <BuilderBulkButton :disabled="buildTool === 'eraser'" @click="emit('fill-ground')">
      Fill ground
    </BuilderBulkButton>
    <BuilderBulkButton variant="danger" :disabled="!voxelCount" @click="emit('clear-all-voxels')">
      Clear all
    </BuilderBulkButton>
  </BuilderBulkActionRow>
</template>

<style scoped>
.hint {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  line-height: 1.4;
}

</style>
