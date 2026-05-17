<script setup lang="ts">
import { looseNumberFromEvent } from '~/utils/domEvents'
import type { GridDimensions } from '~/types/map'

type DimensionAxis = keyof GridDimensions

defineProps<{
  dimensions: GridDimensions
  canEditMap: boolean
}>()

const emit = defineEmits<{
  (event: 'update-dimension', axis: DimensionAxis, value: number | string): void
}>()
</script>

<template>
  <div class="dimension-grid">
    <label>
      <span>Width (X)</span>
      <input
        :value="dimensions.x"
        type="number"
        min="1"
        max="200"
        :disabled="!canEditMap"
        @input="emit('update-dimension', 'x', looseNumberFromEvent($event))"
      />
    </label>
    <label>
      <span>Height (Y)</span>
      <input
        :value="dimensions.y"
        type="number"
        min="1"
        max="200"
        :disabled="!canEditMap"
        @input="emit('update-dimension', 'y', looseNumberFromEvent($event))"
      />
    </label>
    <label>
      <span>Depth (Z)</span>
      <input
        :value="dimensions.z"
        type="number"
        min="1"
        max="200"
        :disabled="!canEditMap"
        @input="emit('update-dimension', 'z', looseNumberFromEvent($event))"
      />
    </label>
  </div>
</template>

<style scoped>
.dimension-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}

.dimension-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.dimension-grid span {
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.65rem 0.8rem;
  outline: none;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(255, 31, 45, 0.18);
}

input:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

@media (max-width: 640px) {
  .dimension-grid {
    grid-template-columns: 1fr;
  }
}
</style>
