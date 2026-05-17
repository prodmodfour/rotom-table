<script setup lang="ts">
import { computed } from 'vue'
import FieldEffectsPanel from '~/components/map/FieldEffectsPanel.vue'
import MapMenuModalShell from '~/components/map/MapMenuModalShell.vue'
import { formatFieldEffectsHazardsBadge } from '~/utils/mapPanelBadges'
import type {
  FieldEffectsControlsProps,
  FieldEffectsMenuModalEmit,
} from '~/types/mapFieldEffectsControls'

const props = defineProps<FieldEffectsControlsProps>()
const emit = defineEmits<FieldEffectsMenuModalEmit>()

const fieldEffectsBadge = computed(() => formatFieldEffectsHazardsBadge(props.fieldEffectCount, props.hazardCount))
</script>

<template>
  <MapMenuModalShell
    title="Field effects"
    title-id="field-effects-menu-title"
    description-id="field-effects-menu-description"
    :shortcut-keys="['Ctrl', 'F']"
    :badge="fieldEffectsBadge"
    @close="emit('close')"
  >
    <FieldEffectsPanel
      v-bind="props"
      @set-mode="emit('set-mode', $event)"
      @set-hazard-tool="emit('set-hazard-tool', $event)"
      @select-hazard-kind="emit('select-hazard-kind', $event)"
      @clear-all-hazards="emit('clear-all-hazards')"
      @set-weather="emit('set-weather', $event)"
      @remove-weather="emit('remove-weather', $event)"
      @clear-weather="emit('clear-weather')"
      @update-weather-coexist-next="emit('update-weather-coexist-next', $event)"
      @toggle-terrain="emit('toggle-terrain', $event)"
      @remove-terrain="emit('remove-terrain', $event)"
      @toggle-room="emit('toggle-room', $event)"
      @remove-room="emit('remove-room', $event)"
      @set-weather-rounds="(kind, value) => emit('set-weather-rounds', kind, value)"
      @set-terrain-rounds="(kind, value) => emit('set-terrain-rounds', kind, value)"
      @set-room-rounds="(kind, value) => emit('set-room-rounds', kind, value)"
      @tick-durations="emit('tick-durations')"
      @clear-all="emit('clear-all')"
    />
  </MapMenuModalShell>
</template>
