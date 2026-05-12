<script setup lang="ts">
import BuilderBulkActionRow from '~/components/map/BuilderBulkActionRow.vue'
import BuilderBulkButton from '~/components/map/BuilderBulkButton.vue'
import BuilderHintText from '~/components/map/BuilderHintText.vue'
import BuildToolToggle from '~/components/map/BuildToolToggle.vue'
import TerrainColorPicker from '~/components/map/TerrainColorPicker.vue'
import TerrainMaterialGrid from '~/components/map/TerrainMaterialGrid.vue'
import type { VoxelMaterialDef } from '~/utils/voxelMaterials'
import type { BuildTool } from '#shared/mapEditor'
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
    ariaLabel="Build tool"
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

  <BuilderHintText>
    Left click to {{ buildTool === 'pencil' ? 'place' : 'erase' }}, right click to
    erase. Click a voxel face to stack on top.
  </BuilderHintText>

  <BuilderBulkActionRow>
    <BuilderBulkButton :disabled="buildTool === 'eraser'" @click="emit('fill-ground')">
      Fill ground
    </BuilderBulkButton>
    <BuilderBulkButton variant="danger" :disabled="!voxelCount" @click="emit('clear-all-voxels')">
      Clear all
    </BuilderBulkButton>
  </BuilderBulkActionRow>
</template>

