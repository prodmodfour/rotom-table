<script setup lang="ts">
import { hexColorString, type VoxelMaterialDef } from '~/utils/voxels'
import type { VoxelMaterial } from '~/types/map'

defineProps<{
  activeMaterial: VoxelMaterial
  hasCustomColor: boolean
  materials: readonly VoxelMaterialDef[]
}>()

const emit = defineEmits<{
  (event: 'select-material', material: VoxelMaterial): void
}>()
</script>

<template>
  <div class="materials-grid" role="group" aria-label="Terrain material">
    <button
      v-for="material in materials"
      :key="material.material"
      type="button"
      class="material-swatch"
      :class="{
        'is-active': activeMaterial === material.material && !hasCustomColor,
      }"
      :aria-pressed="activeMaterial === material.material && !hasCustomColor"
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
</style>
