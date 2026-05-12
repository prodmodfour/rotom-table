<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DisplayPokedexEntry } from '~/utils/pokedex/entryIndex'

defineProps<{
  entries: DisplayPokedexEntry[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  scroll: []
  'entry-list-ref': [element: HTMLElement | null]
}>()

const entryListRef = ref<HTMLElement | null>(null)

const emitEntryListRef = () => {
  emit('entry-list-ref', entryListRef.value)
}

onMounted(emitEntryListRef)
onBeforeUnmount(() => emit('entry-list-ref', null))
watch(entryListRef, emitEntryListRef)
</script>

<template>
  <div class="entry-list-panel">
    <div v-if="entries.length > 0" ref="entryListRef" class="entry-list" @scroll.passive="emit('scroll')">
      <PokedexEntryListItem
        v-for="entry in entries"
        :key="entry.id"
        :entry="entry"
        :selected="entry.id === selectedId"
      />
    </div>

    <p v-else class="empty-state">
      No Pokédex entries match those filters.
    </p>
  </div>
</template>

<style scoped>
.entry-list-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.entry-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
  overflow: auto;
}

.empty-state {
  margin: 0 0 0.9rem;
  color: var(--ink-muted);
  line-height: 1.5;
  font-size: 0.85rem;
}

@media (max-width: 760px) {
  .entry-list-panel {
    overflow: visible;
  }

  .entry-list {
    max-height: 50vh;
    overflow: auto;
  }
}
</style>
