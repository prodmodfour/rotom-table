<script setup lang="ts">
import { checkedValueFromEvent } from '~/utils/domEvents'
import { formatLayerVisibilityLabel, type MapLayerVisibilityKey } from '~/utils/mapLayerVisibility'
import type { LayerVisibility } from '~/types/map'

defineProps<{
  layerVisibility: LayerVisibility
  layerOptions: readonly MapLayerVisibilityKey[]
}>()

const emit = defineEmits<{
  (event: 'set-layer-visibility', layer: MapLayerVisibilityKey, value: boolean): void
}>()
</script>

<template>
  <div class="build-section layer-panel">
    <div class="panel-heading panel-heading--compact">
      <h2>Layers</h2>
      <span class="badge">visibility</span>
    </div>
    <div class="layer-grid">
      <label v-for="layer in layerOptions" :key="layer" class="layer-toggle">
        <input
          :checked="layerVisibility[layer]"
          type="checkbox"
          @change="emit('set-layer-visibility', layer, checkedValueFromEvent($event))"
        />
        <span>{{ formatLayerVisibilityLabel(layer) }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.build-section {
  border-top: 1px solid var(--rule-soft);
  margin-top: 0.15rem;
  padding-top: 0.85rem;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.panel-heading h2 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-heading--compact {
  margin-bottom: 0.6rem;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.layer-panel {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.layer-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
}

.layer-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 9px;
  background: var(--paper);
  padding: 0.45rem 0.55rem;
  color: var(--ink);
  font-size: 0.8rem;
  text-transform: capitalize;
}

.layer-toggle input {
  width: auto;
  accent-color: var(--accent);
}
</style>
