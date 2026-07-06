<script setup lang="ts">
import { computed } from 'vue'
import MapInitiativeTracker from '~/components/map/InitiativeTracker.vue'
import MapMenuModalShell from '~/components/map/MapMenuModalShell.vue'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'
import { pluralizeCount } from '~/utils/mapPanelBadges'

const props = defineProps<{
  rows: InitiativeRow[]
  sortedRows: InitiativeRow[]
  activeId: string | null
  round: number
  selectedId: string | null
  canManage: boolean
  hasInitiativeValues: boolean
  manualOrderActive: boolean
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'set-round', value: Event): void
  (event: 'previous'): void
  (event: 'next'): void
  (event: 'fill-from-speed'): void
  (event: 'clear-active'): void
  (event: 'clear-values'): void
  (event: 'set-active-and-focus', id: string): void
  (event: 'focus', id: string): void
  (event: 'set-initiative-input', id: string, value: Event): void
  (event: 'set-initiative-from-speed', id: string, speed: number): void
  (event: 'move-row', id: string, direction: -1 | 1): void
  (event: 'reorder', ids: string[]): void
  (event: 'clear-manual-order'): void
}>()

const initiativeBadge = computed(() => pluralizeCount(props.rows.length, 'combatant'))
</script>

<template>
  <MapMenuModalShell
    title="Initiative"
    title-id="initiative-menu-title"
    description-id="initiative-menu-description"
    :shortcut-keys="['Ctrl', 'I']"
    :badge="initiativeBadge"
    size="standard"
    @close="emit('close')"
  >
    <MapInitiativeTracker
      :rows="rows"
      :sorted-rows="sortedRows"
      :active-id="activeId"
      :round="round"
      :selected-id="selectedId"
      :can-manage="canManage"
      :has-initiative-values="hasInitiativeValues"
      :manual-order-active="manualOrderActive"
      @set-round="emit('set-round', $event)"
      @previous="emit('previous')"
      @next="emit('next')"
      @fill-from-speed="emit('fill-from-speed')"
      @clear-active="emit('clear-active')"
      @clear-values="emit('clear-values')"
      @set-active-and-focus="emit('set-active-and-focus', $event)"
      @focus="emit('focus', $event)"
      @set-initiative-input="(id, value) => emit('set-initiative-input', id, value)"
      @set-initiative-from-speed="(id, speed) => emit('set-initiative-from-speed', id, speed)"
      @move-row="(id, direction) => emit('move-row', id, direction)"
      @reorder="emit('reorder', $event)"
      @clear-manual-order="emit('clear-manual-order')"
    />
  </MapMenuModalShell>
</template>
