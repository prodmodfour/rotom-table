<script setup lang="ts">
import CollapsiblePanelCard from '~/components/map/CollapsiblePanelCard.vue'
import FieldEffectBulkActions from '~/components/map/FieldEffectBulkActions.vue'
import FieldEffectSection from '~/components/map/FieldEffectSection.vue'
import FieldEffectWeatherOptions from '~/components/map/FieldEffectWeatherOptions.vue'
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
  <CollapsiblePanelCard
    class="field-effects-panel"
    title="Field effects"
    :badge="`${fieldEffectCount} active`"
    :collapsed="collapsed"
    controls-id="map-field-effects-section"
    wide-gap
    @toggle-collapsed="emit('toggle-collapsed')"
  >
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
      <FieldEffectWeatherOptions
        :can-edit-map="canEditMap"
        :active-weather-count="activeWeatherEffects.length"
        :weather-coexist-next="weatherCoexistNext"
        @update-weather-coexist-next="emit('update-weather-coexist-next', $event)"
      />
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

    <FieldEffectBulkActions
      :can-edit-map="canEditMap"
      :field-effect-count="fieldEffectCount"
      @tick-durations="emit('tick-durations')"
      @clear-all="emit('clear-all')"
    />
  </CollapsiblePanelCard>
</template>
