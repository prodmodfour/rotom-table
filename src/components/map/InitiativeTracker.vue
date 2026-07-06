<script setup lang="ts">
import InitiativeControls from '~/components/map/InitiativeControls.vue'
import InitiativeList from '~/components/map/InitiativeList.vue'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'

defineProps<{
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
</script>

<template>
  <section class="panel-card initiative-panel">
    <InitiativeControls
      :row-count="rows.length"
      :active-id="activeId"
      :round="round"
      :can-manage="canManage"
      :has-initiative-values="hasInitiativeValues"
      @set-round="emit('set-round', $event)"
      @previous="emit('previous')"
      @next="emit('next')"
      @fill-from-speed="emit('fill-from-speed')"
      @clear-active="emit('clear-active')"
      @clear-values="emit('clear-values')"
    />

    <InitiativeList
      :rows="sortedRows"
      :active-id="activeId"
      :selected-id="selectedId"
      :can-manage="canManage"
      :manual-order-active="manualOrderActive"
      @set-active-and-focus="emit('set-active-and-focus', $event)"
      @focus="emit('focus', $event)"
      @set-initiative-input="(id, value) => emit('set-initiative-input', id, value)"
      @set-initiative-from-speed="(id, speed) => emit('set-initiative-from-speed', id, speed)"
      @move-row="(id, direction) => emit('move-row', id, direction)"
      @reorder="emit('reorder', $event)"
    />
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

.initiative-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

</style>
