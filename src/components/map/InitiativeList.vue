<script setup lang="ts">
import { ref } from 'vue'
import InitiativeRowItem from '~/components/map/InitiativeRowItem.vue'
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'

const props = defineProps<{
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

const draggedId = ref<string | null>(null)

const moveIdBefore = (
  ids: readonly string[],
  draggedId: string,
  targetId: string,
): string[] => {
  if (draggedId === targetId) return [...ids]
  const next = ids.filter((id) => id !== draggedId)
  const targetIndex = next.indexOf(targetId)
  if (targetIndex < 0) return [...ids]
  next.splice(targetIndex, 0, draggedId)
  return next
}

const initiativeOrdersEqual = (first: readonly string[], second: readonly string[]): boolean => {
  if (first.length !== second.length) return false
  return first.every((id, index) => id === second[index])
}

const currentRowIds = (): string[] => props.rows.map((row) => row.id)

const startRowDrag = (id: string, event: DragEvent): void => {
  if (!props.canManage) {
    event.preventDefault()
    return
  }

  draggedId.value = id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
  }
}

const endRowDrag = (): void => {
  draggedId.value = null
}

const dragOverRow = (event: DragEvent): void => {
  if (!props.canManage || !draggedId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

const dropRow = (targetId: string, event: DragEvent): void => {
  const id = draggedId.value
  draggedId.value = null
  if (!props.canManage || !id) return

  event.preventDefault()
  const ids = currentRowIds()
  if (!ids.includes(id)) return
  const nextIds = moveIdBefore(ids, id, targetId)
  if (!initiativeOrdersEqual(ids, nextIds)) emit('reorder', nextIds)
}
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
      @drag-start="startRowDrag"
      @drag-end="endRowDrag"
      @dragover="dragOverRow"
      @drop-row="dropRow"
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
