<script setup lang="ts">
import InitiativeRowItem from '~/components/map/InitiativeRowItem.vue'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'

defineProps<{
  rows: InitiativeRow[]
  activeId: string | null
  selectedId: string | null
  canManage: boolean
  manualOrderActive: boolean
}>()

const emit = defineEmits<{
  (event: 'set-active-and-focus', id: string): void
  (event: 'focus', id: string): void
  (event: 'set-initiative-input', id: string, value: Event): void
  (event: 'set-initiative-from-speed', id: string, speed: number): void
  (event: 'move-row', id: string, direction: -1 | 1): void
  (event: 'reorder', ids: string[]): void
}>()
</script>

<template>
  <ol v-if="rows.length" class="initiative-list">
    <InitiativeRowItem
      v-for="(entry, index) in rows"
      :key="entry.id"
      :entry="entry"
      :index="index"
      :row-count="rows.length"
      :active-id="activeId"
      :selected-id="selectedId"
      :can-manage="canManage"
      @set-active-and-focus="emit('set-active-and-focus', $event)"
      @focus="emit('focus', $event)"
      @set-initiative-input="(id, value) => emit('set-initiative-input', id, value)"
      @set-initiative-from-speed="(id, speed) => emit('set-initiative-from-speed', id, speed)"
      @move-row="(id, direction) => emit('move-row', id, direction)"
    />
  </ol>

  <p v-else class="initiative-empty">
    Spawn Pokémon or trainers onto the map to track turn order.
  </p>
</template>

<style scoped>
.initiative-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.initiative-empty {
  margin: 0;
  border: 1px dashed var(--rule-soft);
  border-radius: 12px;
  padding: 1rem;
  color: var(--ink-muted);
  font-size: 0.86rem;
  line-height: 1.45;
  text-align: center;
}
</style>
