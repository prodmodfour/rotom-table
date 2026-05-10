<script setup lang="ts">
import BuildToolToggle from '~/components/map/BuildToolToggle.vue'
import { hexColorString, type VoxelMaterialDef } from '~/utils/voxels'
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

  <div class="materials-grid" role="group" aria-label="Terrain material">
    <button
      v-for="material in visibleVoxelMaterials"
      :key="material.material"
      type="button"
      class="material-swatch"
      :class="{
        'is-active': buildMaterial === material.material && !buildColor,
      }"
      :aria-pressed="buildMaterial === material.material && !buildColor"
      @click="emit('select-material', material.material)"
    >
      <span
        class="swatch-color"
        :style="{ background: hexColorString(material.baseColor) }"
        aria-hidden="true"
      />
      <span class="swatch-label">{{ material.label }}</span>
    </button>
  </div>

  <div class="color-row">
    <label class="color-picker">
      <span>Custom color</span>
      <input
        type="color"
        :value="colorPickerValue"
        @input="emit('color-input', $event)"
      />
    </label>
    <button
      v-if="buildColor"
      type="button"
      class="ghost-button"
      @click="emit('clear-custom-color')"
    >
      Reset
    </button>
  </div>

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
.materials-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
}

.material-swatch {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.3rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  padding: 0.4rem;
  cursor: pointer;
  font: inherit;
  text-align: center;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.material-swatch:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.material-swatch.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.swatch-color {
  display: block;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.25);
}

.swatch-label {
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  color: var(--ink);
}

.material-swatch.is-active .swatch-label {
  color: var(--accent);
}

.color-row {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
}

.color-picker {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.color-picker span {
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.color-picker input[type='color'] {
  width: 100%;
  height: 38px;
  padding: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  cursor: pointer;
}

.ghost-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink-soft);
  padding: 0.5rem 0.7rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.ghost-button:hover {
  border-color: var(--rule-strong);
  color: var(--ink-bright);
}

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
