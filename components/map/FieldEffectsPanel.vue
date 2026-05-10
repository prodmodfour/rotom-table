<script setup lang="ts">
import CollapsiblePanelHeading from '~/components/map/CollapsiblePanelHeading.vue'
import FieldEffectSection from '~/components/map/FieldEffectSection.vue'
import { checkedValueFromEvent } from '~/utils/domEvents'
import type { MapEffectDefinition } from '~/utils/mapFieldEffects'
import type {
  MapRoomEffect,
  MapRoomKind,
  MapTerrainEffect,
  MapTerrainKind,
  MapWeatherEffect,
  MapWeatherKind,
} from '~/types/map'

defineProps<{
  collapsed: boolean
  canEditMap: boolean
  fieldEffectCount: number
  weatherCoexistNext: boolean
  activeWeatherEffects: MapWeatherEffect[]
  activeTerrainEffects: MapTerrainEffect[]
  activeRoomEffects: MapRoomEffect[]
  weatherPalette: MapEffectDefinition<MapWeatherKind>[]
  terrainPalette: MapEffectDefinition<MapTerrainKind>[]
  roomPalette: MapEffectDefinition<MapRoomKind>[]
  weatherDefinition: (kind: MapWeatherKind) => MapEffectDefinition<MapWeatherKind>
  terrainDefinition: (kind: MapTerrainKind) => MapEffectDefinition<MapTerrainKind>
  roomDefinition: (kind: MapRoomKind) => MapEffectDefinition<MapRoomKind>
  weatherIsActive: (kind: MapWeatherKind) => boolean
  terrainIsActive: (kind: MapTerrainKind) => boolean
  roomIsActive: (kind: MapRoomKind) => boolean
  durationLabel: (rounds: number | null | undefined) => string
}>()

const emit = defineEmits<{
  (event: 'toggle-collapsed'): void
  (event: 'set-weather', kind: MapWeatherKind): void
  (event: 'remove-weather', kind: MapWeatherKind): void
  (event: 'clear-weather'): void
  (event: 'update-weather-coexist-next', value: boolean): void
  (event: 'toggle-terrain', kind: MapTerrainKind): void
  (event: 'remove-terrain', kind: MapTerrainKind): void
  (event: 'toggle-room', kind: MapRoomKind): void
  (event: 'remove-room', kind: MapRoomKind): void
  (event: 'set-weather-rounds', kind: MapWeatherKind, value: Event): void
  (event: 'set-terrain-rounds', kind: MapTerrainKind, value: Event): void
  (event: 'set-room-rounds', kind: MapRoomKind, value: Event): void
  (event: 'tick-durations'): void
  (event: 'clear-all'): void
}>()

const selectWeather = (kind: string) => emit('set-weather', kind as MapWeatherKind)
const removeWeather = (kind: string) => emit('remove-weather', kind as MapWeatherKind)
const setWeatherRounds = (kind: string, value: Event) =>
  emit('set-weather-rounds', kind as MapWeatherKind, value)
const toggleTerrain = (kind: string) => emit('toggle-terrain', kind as MapTerrainKind)
const removeTerrain = (kind: string) => emit('remove-terrain', kind as MapTerrainKind)
const setTerrainRounds = (kind: string, value: Event) =>
  emit('set-terrain-rounds', kind as MapTerrainKind, value)
const toggleRoom = (kind: string) => emit('toggle-room', kind as MapRoomKind)
const removeRoom = (kind: string) => emit('remove-room', kind as MapRoomKind)
const setRoomRounds = (kind: string, value: Event) =>
  emit('set-room-rounds', kind as MapRoomKind, value)
</script>

<template>
  <section class="panel-card field-effects-panel">
    <CollapsiblePanelHeading
      title="Field effects"
      :badge="`${fieldEffectCount} active`"
      :collapsed="collapsed"
      controls-id="map-field-effects-section"
      @toggle-collapsed="emit('toggle-collapsed')"
    />

    <div id="map-field-effects-section" v-show="!collapsed" class="collapsible-section-body">
      <FieldEffectSection
        title="Weather"
        aria-label="Weather"
        :effects="weatherPalette"
        :active-effects="activeWeatherEffects"
        :can-edit-map="canEditMap"
        :is-active="weatherIsActive"
        :definition="weatherDefinition"
        :duration-label="durationLabel"
        :clear-disabled="!activeWeatherEffects.length"
        clearable
        flush-top
        empty-text="Clear / normal weather."
        @select="selectWeather"
        @clear="emit('clear-weather')"
        @set-rounds="setWeatherRounds"
        @remove="removeWeather"
      >
        <label v-if="canEditMap" class="coexist-toggle" :class="{ active: weatherCoexistNext }">
          <input
            :checked="weatherCoexistNext"
            type="checkbox"
            :disabled="!activeWeatherEffects.length"
            @change="emit('update-weather-coexist-next', checkedValueFromEvent($event))"
          />
          Add next weather alongside current one (Climate Control)
        </label>
      </FieldEffectSection>

      <FieldEffectSection
        title="Terrain"
        aria-label="Terrain effects"
        note="Field-wide toggles"
        :effects="terrainPalette"
        :active-effects="activeTerrainEffects"
        :can-edit-map="canEditMap"
        :is-active="terrainIsActive"
        :definition="terrainDefinition"
        :duration-label="durationLabel"
        empty-text="No active terrain field effect."
        @select="toggleTerrain"
        @set-rounds="setTerrainRounds"
        @remove="removeTerrain"
      />

      <FieldEffectSection
        title="Rooms"
        aria-label="Room effects"
        note="Independent"
        :effects="roomPalette"
        :active-effects="activeRoomEffects"
        :can-edit-map="canEditMap"
        :is-active="roomIsActive"
        :definition="roomDefinition"
        :duration-label="durationLabel"
        empty-text="No active room."
        @select="toggleRoom"
        @set-rounds="setRoomRounds"
        @remove="removeRoom"
      />

      <div v-if="canEditMap" class="field-effect-actions">
        <button
          type="button"
          class="bulk-button"
          :disabled="!fieldEffectCount"
          @click="emit('tick-durations')"
        >
          Advance durations
        </button>
        <button
          type="button"
          class="bulk-button bulk-button--danger"
          :disabled="!fieldEffectCount"
          @click="emit('clear-all')"
        >
          Clear effects
        </button>
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

.collapsible-section-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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

.field-effects-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.coexist-toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin-top: 0.55rem;
  color: var(--ink-muted);
  font-size: 0.75rem;
  line-height: 1.35;
}

.coexist-toggle.active {
  color: var(--accent);
}

.coexist-toggle input {
  width: auto;
  margin-top: 0.15rem;
  accent-color: var(--accent);
}

.field-effect-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  border-top: 1px solid var(--rule-soft);
  padding-top: 0.85rem;
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
