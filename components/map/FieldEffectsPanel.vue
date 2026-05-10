<script setup lang="ts">
import CollapsiblePanelHeading from '~/components/map/CollapsiblePanelHeading.vue'
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
      <div class="field-effect-group">
        <div class="field-effect-header">
          <h3>Weather</h3>
          <button
            v-if="canEditMap"
            type="button"
            class="mini-action"
            :disabled="!activeWeatherEffects.length"
            @click="emit('clear-weather')"
          >
            Clear
          </button>
        </div>
        <div class="effect-swatch-grid effect-swatch-grid--weather" role="group" aria-label="Weather">
          <button
            v-for="weather in weatherPalette"
            :key="weather.kind"
            type="button"
            class="effect-swatch"
            :class="{ 'is-active': weatherIsActive(weather.kind) }"
            :aria-pressed="weatherIsActive(weather.kind)"
            :disabled="!canEditMap"
            :title="weather.rules"
            :style="{ '--effect-color': weather.color }"
            @click="emit('set-weather', weather.kind)"
          >
            <span class="effect-swatch__icon">{{ weather.shortLabel }}</span>
            <span class="effect-swatch__label">{{ weather.label }}</span>
          </button>
        </div>
        <label v-if="canEditMap" class="coexist-toggle" :class="{ active: weatherCoexistNext }">
          <input
            :checked="weatherCoexistNext"
            type="checkbox"
            :disabled="!activeWeatherEffects.length"
            @change="emit('update-weather-coexist-next', checkedValueFromEvent($event))"
          />
          Add next weather alongside current one (Climate Control)
        </label>
        <div v-if="activeWeatherEffects.length" class="effect-chip-list">
          <article
            v-for="effect in activeWeatherEffects"
            :key="effect.kind"
            class="effect-chip"
            :style="{ '--effect-color': weatherDefinition(effect.kind).color }"
          >
            <div class="effect-chip__main">
              <strong>{{ weatherDefinition(effect.kind).label }}</strong>
              <span>{{ weatherDefinition(effect.kind).description }}</span>
            </div>
            <label class="duration-field">
              <span>Duration</span>
              <input
                type="number"
                min="0"
                :value="durationLabel(effect.rounds)"
                :disabled="!canEditMap"
                placeholder="∞"
                @input="emit('set-weather-rounds', effect.kind, $event)"
              />
            </label>
            <button
              v-if="canEditMap"
              type="button"
              class="chip-remove"
              :aria-label="`Remove ${weatherDefinition(effect.kind).label}`"
              @click="emit('remove-weather', effect.kind)"
            >
              ×
            </button>
          </article>
        </div>
        <p v-else class="field-effect-empty">Clear / normal weather.</p>
      </div>

      <div class="field-effect-group">
        <div class="field-effect-header">
          <h3>Terrain</h3>
          <span class="field-effect-note">Field-wide toggles</span>
        </div>
        <div class="effect-swatch-grid" role="group" aria-label="Terrain effects">
          <button
            v-for="terrain in terrainPalette"
            :key="terrain.kind"
            type="button"
            class="effect-swatch"
            :class="{ 'is-active': terrainIsActive(terrain.kind) }"
            :aria-pressed="terrainIsActive(terrain.kind)"
            :disabled="!canEditMap"
            :title="terrain.rules"
            :style="{ '--effect-color': terrain.color }"
            @click="emit('toggle-terrain', terrain.kind)"
          >
            <span class="effect-swatch__icon">{{ terrain.shortLabel }}</span>
            <span class="effect-swatch__label">{{ terrain.label }}</span>
          </button>
        </div>
        <div v-if="activeTerrainEffects.length" class="effect-chip-list">
          <article
            v-for="effect in activeTerrainEffects"
            :key="effect.kind"
            class="effect-chip"
            :style="{ '--effect-color': terrainDefinition(effect.kind).color }"
          >
            <div class="effect-chip__main">
              <strong>{{ terrainDefinition(effect.kind).label }}</strong>
              <span>{{ terrainDefinition(effect.kind).description }}</span>
            </div>
            <label class="duration-field">
              <span>Duration</span>
              <input
                type="number"
                min="0"
                :value="durationLabel(effect.rounds)"
                :disabled="!canEditMap"
                placeholder="∞"
                @input="emit('set-terrain-rounds', effect.kind, $event)"
              />
            </label>
            <button
              v-if="canEditMap"
              type="button"
              class="chip-remove"
              :aria-label="`Remove ${terrainDefinition(effect.kind).label}`"
              @click="emit('remove-terrain', effect.kind)"
            >
              ×
            </button>
          </article>
        </div>
        <p v-else class="field-effect-empty">No active terrain field effect.</p>
      </div>

      <div class="field-effect-group">
        <div class="field-effect-header">
          <h3>Rooms</h3>
          <span class="field-effect-note">Independent</span>
        </div>
        <div class="effect-swatch-grid" role="group" aria-label="Room effects">
          <button
            v-for="room in roomPalette"
            :key="room.kind"
            type="button"
            class="effect-swatch"
            :class="{ 'is-active': roomIsActive(room.kind) }"
            :aria-pressed="roomIsActive(room.kind)"
            :disabled="!canEditMap"
            :title="room.rules"
            :style="{ '--effect-color': room.color }"
            @click="emit('toggle-room', room.kind)"
          >
            <span class="effect-swatch__icon">{{ room.shortLabel }}</span>
            <span class="effect-swatch__label">{{ room.label }}</span>
          </button>
        </div>
        <div v-if="activeRoomEffects.length" class="effect-chip-list">
          <article
            v-for="effect in activeRoomEffects"
            :key="effect.kind"
            class="effect-chip"
            :style="{ '--effect-color': roomDefinition(effect.kind).color }"
          >
            <div class="effect-chip__main">
              <strong>{{ roomDefinition(effect.kind).label }}</strong>
              <span>{{ roomDefinition(effect.kind).description }}</span>
              <em v-if="effect.startsNextRound">starts next round</em>
            </div>
            <label class="duration-field">
              <span>Duration</span>
              <input
                type="number"
                min="0"
                :value="durationLabel(effect.rounds)"
                :disabled="!canEditMap"
                placeholder="∞"
                @input="emit('set-room-rounds', effect.kind, $event)"
              />
            </label>
            <button
              v-if="canEditMap"
              type="button"
              class="chip-remove"
              :aria-label="`Remove ${roomDefinition(effect.kind).label}`"
              @click="emit('remove-room', effect.kind)"
            >
              ×
            </button>
          </article>
        </div>
        <p v-else class="field-effect-empty">No active room.</p>
      </div>

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

.field-effect-group {
  border-top: 1px solid var(--rule-soft);
  padding-top: 0.8rem;
}

.field-effects-panel .collapsible-section-body > .field-effect-group:first-child {
  border-top: 0;
  padding-top: 0;
}

.field-effect-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  margin-bottom: 0.55rem;
}

.field-effect-header h3 {
  margin: 0;
  color: var(--ink-bright);
  font-size: 0.86rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.field-effect-note,
.field-effect-empty {
  color: var(--ink-muted);
  font-size: 0.74rem;
  letter-spacing: 0.04em;
}

.field-effect-empty {
  margin: 0.5rem 0 0;
  line-height: 1.35;
}

.effect-swatch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
}

.effect-swatch-grid--weather {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.effect-swatch {
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
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.effect-swatch:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--effect-color) 55%, var(--rule-strong));
  background: var(--paper-hover);
}

.effect-swatch:disabled {
  cursor: default;
  opacity: 0.8;
}

.effect-swatch.is-active {
  border-color: color-mix(in srgb, var(--effect-color) 72%, var(--accent));
  background: color-mix(in srgb, var(--effect-color) 16%, var(--paper));
}

.effect-swatch__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.65rem;
  min-height: 1.9rem;
  border: 1px solid color-mix(in srgb, var(--effect-color) 65%, #1d2021);
  border-radius: 8px;
  background: color-mix(in srgb, var(--effect-color) 20%, transparent);
  color: color-mix(in srgb, var(--effect-color) 78%, #fbf1c7);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.effect-swatch__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.76rem;
  letter-spacing: 0.03em;
}

.effect-chip-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-top: 0.6rem;
}

.effect-chip {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4.4rem auto;
  align-items: center;
  gap: 0.55rem;
  border: 1px solid color-mix(in srgb, var(--effect-color) 40%, var(--rule-soft));
  border-radius: 12px;
  background: color-mix(in srgb, var(--effect-color) 9%, var(--paper));
  padding: 0.55rem;
}

.effect-chip__main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
}

.effect-chip__main strong {
  color: color-mix(in srgb, var(--effect-color) 70%, var(--ink-bright));
  font-size: 0.82rem;
}

.effect-chip__main span,
.effect-chip__main em {
  color: var(--ink-muted);
  font-size: 0.72rem;
  line-height: 1.25;
}

.duration-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.duration-field span {
  color: var(--ink-muted);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.duration-field input {
  padding: 0.4rem 0.45rem;
  text-align: center;
}

.chip-remove,
.mini-action {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.chip-remove {
  width: 1.9rem;
  height: 1.9rem;
  padding: 0;
  font-size: 1.05rem;
  line-height: 1;
}

.mini-action {
  padding: 0.25rem 0.6rem;
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.chip-remove:hover:not(:disabled),
.mini-action:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.chip-remove:disabled,
.mini-action:disabled {
  cursor: not-allowed;
  opacity: 0.55;
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
