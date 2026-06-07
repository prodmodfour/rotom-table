<script setup lang="ts">
import { PhSquaresFour } from '@phosphor-icons/vue'
import LibraryCardBadge from '~/components/library/LibraryCardBadge.vue'
import LibraryCardMedia from '~/components/library/LibraryCardMedia.vue'
import LibraryCardMetaList from '~/components/library/LibraryCardMetaList.vue'
import LibraryCardText from '~/components/library/LibraryCardText.vue'
import { encounterTableDisplayEntryCountLabel, formatRegionLabel, formatTableLabel } from '~/utils/encounterTables'
import type { EncounterTableEntry } from '~/types/encounterTable'

defineProps<{
  item: EncounterTableEntry
  selected: boolean
  canDrag: boolean
  isDraggingSelf: boolean
}>()

const emit = defineEmits<{
  select: [item: EncounterTableEntry]
  contextmenu: [event: MouseEvent, item: EncounterTableEntry]
  dragstart: [event: DragEvent, item: EncounterTableEntry]
  dragend: []
}>()
</script>

<template>
  <button
    type="button"
    class="encounter-table-card"
    :class="{
      'encounter-table-card--selected': selected,
      'is-dragging-self': isDraggingSelf,
    }"
    :draggable="canDrag"
    @click="emit('select', item)"
    @contextmenu="emit('contextmenu', $event, item)"
    @dragstart="emit('dragstart', $event, item)"
    @dragend="emit('dragend')"
  >
    <LibraryCardMedia size="map" tone="accent">
      <PhSquaresFour :size="38" weight="duotone" aria-hidden="true" />
    </LibraryCardMedia>

    <LibraryCardText
      :title="item.table.name"
      :subtitle="`Lv ${item.table.min_level}–${item.table.max_level} · ${encounterTableDisplayEntryCountLabel(item.table)}`"
      title-size="compact"
      subtitle-tone="muted"
      subtitle-size="compact"
    >
      <template #title-extra>
        <LibraryCardBadge v-if="selected" variant="accent">Selected</LibraryCardBadge>
      </template>
      <LibraryCardMetaList>
        <li>{{ formatRegionLabel(item.region) }}</li>
        <li>{{ formatTableLabel(item.key) }}</li>
      </LibraryCardMetaList>
    </LibraryCardText>
  </button>
</template>

<style scoped>
.encounter-table-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  color: var(--ink);
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    opacity 0.15s ease;
}

.encounter-table-card:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.encounter-table-card--selected {
  border-color: var(--accent);
  background: var(--paper-active);
}

.encounter-table-card[draggable='true'] {
  cursor: grab;
}

.encounter-table-card[draggable='true']:active {
  cursor: grabbing;
}

.encounter-table-card.is-dragging-self {
  opacity: 0.4;
}
</style>
