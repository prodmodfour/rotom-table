<script setup lang="ts">
import { usePokedexSidebarScroll } from '~/composables/pokedex/usePokedexSidebarScroll'
import {
  allTogetherFilterField,
  filterFieldConfigs,
  formatNationalDexNumber,
  type FieldFilterKey,
  type FilterMode,
  type FilterOperator,
  type PokedexSearchTextKey,
} from '~/utils/pokedex/searchText'
import { pokedexEntryPath, type DisplayPokedexEntry } from '~/utils/pokedex/entryIndex'

const filterMode = defineModel<FilterMode>('filterMode', { required: true })

defineProps<{
  entries: DisplayPokedexEntry[]
  filterOperators: Record<FieldFilterKey, FilterOperator>
  searchFilters: Record<PokedexSearchTextKey, string>
  selectedId: string | null
}>()

const { entryListRef, saveSidebarScroll, sidebarRef } = usePokedexSidebarScroll()
</script>

<template>
  <aside ref="sidebarRef" class="pokedex-sidebar" @scroll.passive="saveSidebarScroll">
    <AppNavigation />

    <section class="sidebar-card">
      <div class="sidebar-heading">
        <h1>Pokédex</h1>
        <span class="badge">{{ entries.length }} shown</span>
      </div>

      <p class="sidebar-copy">
        Browse every Pokémon entry from <code>ptu-data/data/pokedex.json</code>.
      </p>

      <div class="filter-browser">
        <div class="filter-panel">
          <div class="filter-mode" role="group" aria-label="Filter mode">
            <button
              type="button"
              :class="['filter-mode__button', { active: filterMode === 'fields' }]"
              @click="filterMode = 'fields'"
            >
              Field filters
            </button>
            <button
              type="button"
              :class="['filter-mode__button', { active: filterMode === 'advanced' }]"
              @click="filterMode = 'advanced'"
            >
              All together
            </button>
          </div>

          <div v-if="filterMode === 'advanced'" class="filter-fields" aria-label="All together filter">
            <label class="filter-field">
              <span class="filter-field__label">{{ allTogetherFilterField.label }}</span>
              <input
                v-model.trim="searchFilters.any"
                type="search"
                :placeholder="allTogetherFilterField.placeholder"
              />
            </label>
          </div>

          <div v-else class="filter-fields" aria-label="Pokédex field filters">
            <template v-for="(field, index) in filterFieldConfigs" :key="field.key">
              <div v-if="index > 0" class="filter-operator">
                <span class="filter-operator__rule" />
                <select
                  v-model="filterOperators[field.key]"
                  class="filter-operator__select"
                  :aria-label="`Combine ${field.label} filter with previous filled filter`"
                >
                  <option value="and">and</option>
                  <option value="or">or</option>
                </select>
                <span class="filter-operator__rule" />
              </div>
              <label class="filter-field">
                <span class="filter-field__label">{{ field.label }}</span>
                <input
                  v-model.trim="searchFilters[field.key]"
                  type="search"
                  :placeholder="field.placeholder"
                />
              </label>
            </template>
          </div>
          <p class="filter-help">
            Use <code>and</code>, <code>or</code>, parentheses, and <code>-term</code> exclusions inside any filter. Numeric/dice terms are minimums (for example, <code>sky 5</code> matches Sky 5+ and <code>3d6</code> matches 3d6+). Field filters combine using the toggles.
          </p>
        </div>

        <div class="entry-list-panel">
          <div v-if="entries.length > 0" ref="entryListRef" class="entry-list" @scroll.passive="saveSidebarScroll">
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
      </div>
    </section>
  </aside>
</template>

<style scoped>
.pokedex-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  border-right: 1px solid var(--rule);
  background: var(--paper);
  max-height: 100vh;
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

.sidebar-copy,
.empty-state {
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

.filter-panel,
.entry-list-panel {
  min-height: 0;
}

.filter-panel {
  overflow: auto;
  padding-right: 0.25rem;
}

.entry-list-panel {
  display: flex;
  flex-direction: column;
}

.filter-mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
  margin-bottom: 0.65rem;
}

.filter-mode__button {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-muted);
  padding: 0.45rem 0.6rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
}

.filter-mode__button:hover,
.filter-mode__button.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

.filter-fields {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 0.7rem;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.filter-field__label {
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.filter-operator {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.45rem;
  margin: -0.1rem 0;
}

.filter-operator__rule {
  height: 1px;
  background: var(--rule-soft);
}

.filter-help {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.75rem;
  line-height: 1.45;
}

input,
select {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.75rem;
  outline: none;
}

input:focus,
select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.filter-operator__select {
  width: auto;
  min-width: 4.8rem;
  padding: 0.25rem 0.45rem;
  border-radius: 999px;
  font-size: 0.72rem;
  text-transform: uppercase;
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

code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--accent);
}

@media (max-width: 1040px) {
  .pokedex-sidebar {
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

  .filter-panel,
  .entry-list-panel {
    overflow: visible;
  }

  .entry-list {
    max-height: 50vh;
    overflow: auto;
  }
}
</style>
