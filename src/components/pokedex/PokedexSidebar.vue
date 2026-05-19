<script setup lang="ts">
import { usePokedexSidebarScroll } from '~/composables/pokedex/usePokedexSidebarScroll'
import {
  type FieldFilterKey,
  type FilterMode,
  type FilterOperator,
  type PokedexSearchTextKey,
} from '~/utils/pokedex/searchText'
import { type PokedexEntrySummary } from '~/utils/pokedex/entryIndex'

const filterMode = defineModel<FilterMode>('filterMode', { required: true })

defineProps<{
  entries: PokedexEntrySummary[]
  filterOperators: Record<FieldFilterKey, FilterOperator>
  isSearchIndexLoading: boolean
  searchFilters: Record<PokedexSearchTextKey, string>
  searchIndexErrorMessage: string | null
  selectedId: string | null
}>()

const { saveSidebarScroll, setEntryListRef, sidebarRef } = usePokedexSidebarScroll()
</script>

<template>
  <aside ref="sidebarRef" class="pokedex-sidebar" @scroll.passive="saveSidebarScroll">
    <AppNavigation />

    <section class="sidebar-card">
      <div class="sidebar-heading">
        <h1>Pokédex</h1>
        <span class="badge">{{ isSearchIndexLoading ? 'Searching…' : `${entries.length} shown` }}</span>
      </div>

      <p class="sidebar-copy">
        Browse every Pokémon entry from <code>data/reference/pokedex.json</code>.
      </p>

      <div class="filter-browser">
        <PokedexFilterPanel
          v-model:filter-mode="filterMode"
          :filter-operators="filterOperators"
          :search-filters="searchFilters"
        />

        <PokedexEntryList
          :entries="entries"
          :error-message="searchIndexErrorMessage"
          :loading="isSearchIndexLoading"
          :selected-id="selectedId"
          @entry-list-ref="setEntryListRef"
          @scroll="saveSidebarScroll"
        />
      </div>
    </section>
  </aside>
</template>

<style scoped>
.pokedex-sidebar {
  position: sticky;
  top: 0;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  height: 100vh;
  height: 100dvh;
  max-height: 100vh;
  max-height: 100dvh;
  padding: 0.85rem;
  border-right: 1px solid var(--rule);
  background: var(--paper);
  overflow: hidden;
}

.sidebar-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  padding: 0.85rem;
}

.sidebar-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.sidebar-heading h1 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.4rem;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.sidebar-copy {
  margin: 0 0 0.9rem;
  color: var(--ink-muted);
  line-height: 1.5;
  font-size: 0.85rem;
}

.filter-browser {
  display: grid;
  grid-template-columns: 340px minmax(190px, 1fr);
  gap: 0.75rem;
  min-height: 0;
  flex: 1;
}

code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--accent);
}

@media (max-width: 1040px) {
  .pokedex-sidebar {
    position: static;
    height: auto;
    max-height: none;
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
}

@media (max-width: 760px) {
  .filter-browser {
    grid-template-columns: 1fr;
  }
}
</style>
