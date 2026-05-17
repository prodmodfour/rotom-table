<script setup lang="ts">
import type { MapHazardKind } from '~/types/map'
import type { MapHazardDefinition } from '~/utils/mapHazardDefinitions'

defineProps<{
  activeKind: MapHazardKind
  hazards: readonly MapHazardDefinition[]
}>()

const emit = defineEmits<{
  (event: 'select-hazard-kind', kind: MapHazardKind): void
}>()
</script>

<template>
  <div class="hazards-grid" role="group" aria-label="Hazard type">
    <button
      v-for="hazard in hazards"
      :key="hazard.kind"
      type="button"
      class="hazard-swatch"
      :class="{ 'is-active': activeKind === hazard.kind }"
      :aria-pressed="activeKind === hazard.kind"
      :title="hazard.description"
      @click="emit('select-hazard-kind', hazard.kind)"
    >
      <span
        class="hazard-swatch__icon"
        :style="{ '--hazard-color': hazard.color }"
        aria-hidden="true"
      >{{ hazard.shortLabel }}</span>
      <span class="hazard-swatch__label">{{ hazard.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.hazards-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
}

.hazard-swatch {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.45rem;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.hazard-swatch:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.hazard-swatch.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.hazard-swatch__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.45rem;
  min-height: 1.9rem;
  border: 1px solid color-mix(in srgb, var(--hazard-color) 65%, #050608);
  border-radius: 8px;
  background: color-mix(in srgb, var(--hazard-color) 24%, transparent);
  color: color-mix(in srgb, var(--hazard-color) 78%, #f7f7f2);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.hazard-swatch__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
}

.hazard-swatch.is-active .hazard-swatch__label {
  color: var(--accent);
}
</style>
