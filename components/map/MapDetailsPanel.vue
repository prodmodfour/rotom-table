<script setup lang="ts">
import CollapsiblePanelCard from '~/components/map/CollapsiblePanelCard.vue'
import { checkedValueFromEvent, looseNumberFromEvent } from '~/utils/domEvents'
import type { GridDimensions } from '~/types/map'

type DimensionAxis = keyof GridDimensions

defineProps<{
  collapsed: boolean
  name: string
  dimensions: GridDimensions
  playerVisible?: boolean
  isGm: boolean
  canEditMap: boolean
}>()

const emit = defineEmits<{
  (event: 'toggle-collapsed'): void
  (event: 'update-player-visible', value: boolean): void
  (event: 'update-dimension', axis: DimensionAxis, value: number | string): void
}>()

</script>

<template>
  <CollapsiblePanelCard
    class="map-details-panel"
    :title="name"
    :badge="`${dimensions.x} × ${dimensions.y} × ${dimensions.z}`"
    :collapsed="collapsed"
    controls-id="map-details-section"
    @toggle-collapsed="emit('toggle-collapsed')"
  >
    <label v-if="isGm" class="visibility-toggle" :class="{ active: playerVisible }">
      <input
        :checked="playerVisible === true"
        type="checkbox"
        @change="emit('update-player-visible', checkedValueFromEvent($event))"
      />
      Player visible
    </label>
    <p v-else class="permission-note">
      Player view: this map is visible, but GM-only map settings are locked.
    </p>

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
  </CollapsiblePanelCard>
</template>

<style scoped>
.visibility-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  width: fit-content;
  margin: 0 0 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-soft);
  padding: 0.35rem 0.7rem;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.visibility-toggle.active {
  border-color: rgba(184, 187, 38, 0.55);
  background: rgba(184, 187, 38, 0.12);
  color: var(--good);
}

.visibility-toggle input {
  width: auto;
}

.permission-note {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.86rem;
  line-height: 1.45;
}

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
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
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
