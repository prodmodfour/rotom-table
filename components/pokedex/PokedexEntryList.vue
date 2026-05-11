<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatNationalDexNumber } from '~/utils/pokedex/searchText'
import { pokedexEntryPath, type DisplayPokedexEntry } from '~/utils/pokedex/entryIndex'

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
      <NuxtLink
        v-for="entry in entries"
        :key="entry.id"
        :to="pokedexEntryPath(entry)"
        :class="['entry-button', { active: entry.id === selectedId }]"
        :aria-current="entry.id === selectedId ? 'page' : undefined"
        prefetch-on="interaction"
      >
        <span class="entry-name">{{ entry.species }}</span>
        <span class="entry-meta">
          <template v-if="entry.nationalDexNumber">
            {{ formatNationalDexNumber(entry.nationalDexNumber) }} ·
          </template>
          <span v-if="entry.types?.length" class="entry-type-badges">
            <TypeBadge
              v-for="type in entry.types"
              :key="`${entry.id}-${type}`"
              :type="type"
              size="xs"
            />
          </span>
          <span v-else>Unknown type</span>
          <template v-if="entry.source_gen"> · {{ entry.source_gen }}</template>
        </span>
      </NuxtLink>
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

.entry-button {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.entry-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.entry-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.entry-button.active {
  border-color: var(--accent);
  background: var(--paper-active);
  color: var(--ink-bright);
}

.entry-name {
  font-weight: 700;
  letter-spacing: 0.02em;
}

.entry-meta {
  color: var(--ink-muted);
  font-size: 0.78rem;
  line-height: 1.3;
}

.entry-type-badges {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.22rem;
  vertical-align: middle;
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
