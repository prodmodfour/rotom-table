<script setup lang="ts">
import BuildToolToggle from '~/components/map/BuildToolToggle.vue'
import type { BuildTool } from '~/shared/mapEditor'
import type { MapHazardKind } from '~/types/map'
import type { MapHazardDefinition } from '~/utils/mapHazards'

defineProps<{
  hazardTool: BuildTool
  hazardKind: MapHazardKind
  activeHazardDef: MapHazardDefinition
  hazardPalette: MapHazardDefinition[]
  hazardCount: number
}>()

const emit = defineEmits<{
  (event: 'set-hazard-tool', tool: BuildTool): void
  (event: 'select-hazard-kind', kind: MapHazardKind): void
  (event: 'clear-all-hazards'): void
}>()
</script>

<template>
  <BuildToolToggle
    aria-label="Hazard tool"
    :active-tool="hazardTool"
    pencil-label="Place"
    eraser-label="Erase"
    @set-tool="emit('set-hazard-tool', $event)"
  />

  <div class="hazards-grid" role="group" aria-label="Hazard type">
    <button
      v-for="hazard in hazardPalette"
      :key="hazard.kind"
      type="button"
      class="hazard-swatch"
      :class="{ 'is-active': hazardKind === hazard.kind }"
      :aria-pressed="hazardKind === hazard.kind"
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

  <p class="hint">
    Left click to {{ hazardTool === 'pencil' ? `place ${activeHazardDef.label}` : 'erase hazards' }}.
    Right click erases all hazards on a square. Toxic Spikes stacks to 2 layers.
  </p>

  <div class="bulk-row">
    <button
      type="button"
      class="bulk-button bulk-button--danger"
      :disabled="!hazardCount"
      @click="emit('clear-all-hazards')"
    >
      Clear hazards
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
  border: 1px solid color-mix(in srgb, var(--hazard-color) 65%, #1d2021);
  border-radius: 8px;
  background: color-mix(in srgb, var(--hazard-color) 24%, transparent);
  color: color-mix(in srgb, var(--hazard-color) 78%, #fbf1c7);
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
