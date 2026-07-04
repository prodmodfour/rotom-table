<script setup lang="ts">
import { ref, watch } from 'vue'
import FieldEffectBulkActions from '~/components/map/FieldEffectBulkActions.vue'
import FieldEffectSection from '~/components/map/FieldEffectSection.vue'
import FieldEffectWeatherOptions from '~/components/map/FieldEffectWeatherOptions.vue'
import HazardBuilderControls from '~/components/map/HazardBuilderControls.vue'
import type {
  FieldEffectsControlsEmit,
  FieldEffectsControlsProps,
} from '~/types/mapFieldEffectsControls'
import type { MapRoomKind, MapTerrainKind, MapWeatherKind } from '~/types/map'

type FieldEffectsTab = 'weather' | 'terrain' | 'hazards'

const FIELD_EFFECT_TABS = [
  { key: 'weather', label: 'Weather' },
  { key: 'terrain', label: 'Terrain' },
  { key: 'hazards', label: 'Hazards' },
] as const satisfies readonly { key: FieldEffectsTab, label: string }[]

const props = defineProps<FieldEffectsControlsProps>()
const emit = defineEmits<FieldEffectsControlsEmit>()

const activeTab = ref<FieldEffectsTab>(props.hazardMode ? 'hazards' : 'weather')

const fieldEffectTabId = (tab: FieldEffectsTab): string => `map-field-effects-${tab}-tab`
const fieldEffectTabPanelId = (tab: FieldEffectsTab): string => `map-field-effects-${tab}-panel`

const selectTab = (tab: FieldEffectsTab) => {
  activeTab.value = tab

  if (!props.canEditMap) return

  if (tab === 'hazards') {
    if (!props.hazardMode) emit('set-mode', 'hazards')
    return
  }

  if (props.hazardMode) emit('set-mode', 'play')
}

watch(
  () => props.hazardMode,
  (hazardMode) => {
    if (hazardMode) {
      activeTab.value = 'hazards'
      return
    }

    if (activeTab.value === 'hazards' && props.canEditMap) activeTab.value = 'weather'
  },
)

const selectWeather = (kind: string) => emit('set-weather', kind as MapWeatherKind)
const removeWeather = (kind: string) => emit('remove-weather', kind as MapWeatherKind)
const setWeatherRounds = (kind: string, value: Event) =>
  emit('set-weather-rounds', kind as MapWeatherKind, value)
const weatherIsActiveForSection = (kind: string) => props.weatherIsActive(kind as MapWeatherKind)
const weatherDefinitionForSection = (kind: string) => props.weatherDefinition(kind as MapWeatherKind)

const toggleTerrain = (kind: string) => emit('toggle-terrain', kind as MapTerrainKind)
const removeTerrain = (kind: string) => emit('remove-terrain', kind as MapTerrainKind)
const setTerrainRounds = (kind: string, value: Event) =>
  emit('set-terrain-rounds', kind as MapTerrainKind, value)
const terrainIsActiveForSection = (kind: string) => props.terrainIsActive(kind as MapTerrainKind)
const terrainDefinitionForSection = (kind: string) => props.terrainDefinition(kind as MapTerrainKind)

const toggleRoom = (kind: string) => emit('toggle-room', kind as MapRoomKind)
const removeRoom = (kind: string) => emit('remove-room', kind as MapRoomKind)
const setRoomRounds = (kind: string, value: Event) =>
  emit('set-room-rounds', kind as MapRoomKind, value)
const roomIsActiveForSection = (kind: string) => props.roomIsActive(kind as MapRoomKind)
const roomDefinitionForSection = (kind: string) => props.roomDefinition(kind as MapRoomKind)
</script>

<template>
  <div class="field-effects-panel">
    <div class="field-effects-tabs" role="tablist" aria-label="Field effect type">
      <button
        v-for="tab in FIELD_EFFECT_TABS"
        :id="fieldEffectTabId(tab.key)"
        :key="tab.key"
        type="button"
        class="field-effects-tab"
        :class="{ 'is-active': activeTab === tab.key }"
        role="tab"
        :aria-selected="activeTab === tab.key"
        :aria-controls="fieldEffectTabPanelId(tab.key)"
        @click="selectTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div
      v-if="activeTab === 'weather'"
      :id="fieldEffectTabPanelId('weather')"
      class="field-effects-tab-panel"
      role="tabpanel"
      :aria-labelledby="fieldEffectTabId('weather')"
    >
      <FieldEffectSection
        title="Weather"
        ariaLabel="Weather"
        :effects="weatherPalette"
        :active-effects="activeWeatherEffects"
        :can-edit-map="canEditMap"
        :is-active="weatherIsActiveForSection"
        :definition="weatherDefinitionForSection"
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
    </div>

    <div
      v-if="activeTab === 'terrain'"
      :id="fieldEffectTabPanelId('terrain')"
      class="field-effects-tab-panel"
      role="tabpanel"
      :aria-labelledby="fieldEffectTabId('terrain')"
    >
      <FieldEffectSection
        title="Terrain"
        ariaLabel="Terrain effects"
        note="Field-wide toggles"
        :effects="terrainPalette"
        :active-effects="activeTerrainEffects"
        :can-edit-map="canEditMap"
        :is-active="terrainIsActiveForSection"
        :definition="terrainDefinitionForSection"
        :duration-label="durationLabel"
        flush-top
        empty-text="No active terrain field effect."
        @select="toggleTerrain"
        @set-rounds="setTerrainRounds"
        @remove="removeTerrain"
      />

      <FieldEffectSection
        title="Rooms"
        ariaLabel="Room effects"
        note="Independent"
        :effects="roomPalette"
        :active-effects="activeRoomEffects"
        :can-edit-map="canEditMap"
        :is-active="roomIsActiveForSection"
        :definition="roomDefinitionForSection"
        :duration-label="durationLabel"
        empty-text="No active room."
        @select="toggleRoom"
        @set-rounds="setRoomRounds"
        @remove="removeRoom"
      />
    </div>

    <div
      v-if="activeTab === 'hazards'"
      :id="fieldEffectTabPanelId('hazards')"
      class="field-effects-tab-panel"
      role="tabpanel"
      :aria-labelledby="fieldEffectTabId('hazards')"
    >
      <template v-if="canEditMap">
        <p class="hazard-mode-note">
          Hazard placement mode is active while this tab is selected.
        </p>
        <HazardBuilderControls
          :hazard-tool="hazardTool"
          :hazard-kind="hazardKind"
          :active-hazard-def="activeHazardDef"
          :hazard-palette="hazardPalette"
          :hazard-count="hazardCount"
          :hazard-clear-pending="hazardClearPending"
          @set-hazard-tool="emit('set-hazard-tool', $event)"
          @select-hazard-kind="emit('select-hazard-kind', $event)"
          @clear-all-hazards="emit('clear-all-hazards')"
        />
      </template>
      <p v-else class="permission-note">
        Hazard editing is GM-only.
      </p>
    </div>

    <FieldEffectBulkActions
      v-if="activeTab !== 'hazards'"
      :can-edit-map="canEditMap"
      :field-effect-count="fieldEffectCount"
      @tick-durations="emit('tick-durations')"
      @clear-all="emit('clear-all')"
    />
  </div>
</template>

<style scoped>
.field-effects-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
}

.field-effects-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
}

.field-effects-tab {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  padding: 0.55rem 0.6rem;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.field-effects-tab:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.field-effects-tab.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.field-effects-tab-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.hazard-mode-note,
.permission-note {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.86rem;
  line-height: 1.45;
}
</style>
