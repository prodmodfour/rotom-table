<script setup lang="ts">
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
  <section class="panel-card map-details-panel">
    <div class="panel-heading panel-heading--collapsible">
      <button
        type="button"
        class="section-toggle-button"
        :aria-expanded="!collapsed"
        aria-controls="map-details-section"
        @click="emit('toggle-collapsed')"
      >
        <span class="section-toggle-button__chevron" aria-hidden="true">
          {{ collapsed ? '›' : '⌄' }}
        </span>
        <span class="section-toggle-button__title">{{ name }}</span>
      </button>
      <span class="badge">
        {{ dimensions.x }} × {{ dimensions.y }} × {{ dimensions.z }}
      </span>
    </div>

    <div id="map-details-section" v-show="!collapsed" class="collapsible-section-body">
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
    </div>
  </section>
</template>

<style scoped>
.panel-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.panel-heading--collapsible {
  margin-bottom: 0;
}

.section-toggle-button {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  background: transparent;
  color: var(--ink-bright);
  padding: 0;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.section-toggle-button:hover,
.section-toggle-button:focus-visible {
  color: var(--accent);
}

.section-toggle-button:focus-visible {
  outline: 2px solid rgba(250, 189, 47, 0.35);
  outline-offset: 3px;
  border-radius: 8px;
}

.section-toggle-button__chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15rem;
  height: 1.15rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  color: var(--accent);
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1;
}

.section-toggle-button__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.map-details-panel,
.collapsible-section-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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
