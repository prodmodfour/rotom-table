<script setup lang="ts">
import BuildToolToggle from '~/components/map/BuildToolToggle.vue'
import HazardPaletteGrid from '~/components/map/HazardPaletteGrid.vue'
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

  <HazardPaletteGrid
    :active-kind="hazardKind"
    :hazards="hazardPalette"
    @select-hazard-kind="emit('select-hazard-kind', $event)"
  />

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
