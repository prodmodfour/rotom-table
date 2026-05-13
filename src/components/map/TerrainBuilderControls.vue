<script setup lang="ts">
import BuilderBulkActionRow from '~/components/map/BuilderBulkActionRow.vue'
import BuilderBulkButton from '~/components/map/BuilderBulkButton.vue'
import BuilderHintText from '~/components/map/BuilderHintText.vue'
import BuildToolToggle from '~/components/map/BuildToolToggle.vue'
import TerrainColorPicker from '~/components/map/TerrainColorPicker.vue'
import { checkedValueFromEvent } from '~/utils/domEvents'
import TerrainMaterialGrid from '~/components/map/TerrainMaterialGrid.vue'
import type { VoxelMaterialDef } from '~/utils/voxelMaterials'
import type { BuildTool } from '#shared/mapEditor'
import type { VoxelMaterial } from '~/types/map'

defineProps<{
  buildTool: BuildTool
  buildMaterial: VoxelMaterial
  buildColor: string | null
  buildGhostVoxel: boolean
  ghostVoxelsFaded: boolean
  visibleVoxelMaterials: readonly VoxelMaterialDef[]
  colorPickerValue: string
  voxelCount: number
}>()

const emit = defineEmits<{
  (event: 'set-build-tool', tool: BuildTool): void
  (event: 'select-material', material: VoxelMaterial): void
  (event: 'color-input', value: Event): void
  (event: 'clear-custom-color'): void
  (event: 'set-build-ghost-voxel', value: boolean): void
  (event: 'set-ghost-voxels-faded', value: boolean): void
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

  <div class="ghost-controls" role="group" aria-label="Ghost voxel options">
    <label class="ghost-toggle" :class="{ active: buildGhostVoxel }">
      <input
        :checked="buildGhostVoxel"
        type="checkbox"
        @change="emit('set-build-ghost-voxel', checkedValueFromEvent($event))"
      />
      <span>Place as ghost</span>
    </label>
    <label class="ghost-toggle" :class="{ active: ghostVoxelsFaded }">
      <input
        :checked="ghostVoxelsFaded"
        type="checkbox"
        @change="emit('set-ghost-voxels-faded', checkedValueFromEvent($event))"
      />
      <span>Fade ghost voxels</span>
    </label>
    <p class="ghost-note">
      Ghost voxels save a ghost flag. Fade renders marked voxels at 10% opacity.
    </p>
  </div>

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

<style scoped>
.ghost-controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
}

.ghost-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 9px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.45rem 0.55rem;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.ghost-toggle.active {
  border-color: rgba(131, 165, 152, 0.65);
  background: rgba(131, 165, 152, 0.12);
  color: var(--accent);
}

.ghost-toggle input {
  width: auto;
  accent-color: var(--accent);
}

.ghost-note {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.76rem;
  line-height: 1.35;
}
</style>

