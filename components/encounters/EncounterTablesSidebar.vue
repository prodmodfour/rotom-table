<script setup lang="ts">
import { ENCOUNTER_GENERATOR_PATH } from '~/utils/encounterRoutes'
import { formatRegionLabel } from '~/utils/encounterTables'
import type { EncounterRegionGroup } from '~/utils/encounterTables'

const searchTerm = defineModel<string>('searchTerm', { required: true })

defineProps<{
  filteredByRegion: EncounterRegionGroup[]
  selectedRegion: string | null
  selectedKey: string | null
  totalCount: number
  filteredCount: number
}>()

const emit = defineEmits<{
  (event: 'select-entry', region: string, key: string): void
}>()
</script>

<template>
  <aside class="encounter-sidebar">
    <AppNavigation />

    <section class="sidebar-card">
      <div class="sidebar-heading">
        <h1>Encounter Tables</h1>
        <span class="badge">{{ filteredCount }} of {{ totalCount }}</span>
      </div>

      <p class="sidebar-copy">
        Browse encounter tables from
        <code>encounter_tables/&lt;region&gt;/&lt;table&gt;.json</code>.
        Use the <NuxtLink :to="ENCOUNTER_GENERATOR_PATH" class="inline-link">Generate</NuxtLink>
        page to roll on a table and produce stat blocks.
      </p>

      <label class="search-field">
        <span class="sr-only">Search encounter tables</span>
        <input
          v-model.trim="searchTerm"
          type="search"
          placeholder="Search region, table, or species…"
        />
      </label>

      <div v-if="filteredByRegion.length > 0" class="region-list">
        <section
          v-for="group in filteredByRegion"
          :key="group.region"
          class="region-group"
        >
          <h2 class="region-title">{{ formatRegionLabel(group.region) }}</h2>
          <button
            v-for="entry in group.tables"
            :key="`${entry.region}/${entry.key}`"
            type="button"
            :class="['table-button', { active: entry.region === selectedRegion && entry.key === selectedKey }]"
            @click="emit('select-entry', entry.region, entry.key)"
          >
            <span class="table-name">{{ entry.table.name }}</span>
            <span class="table-meta">
              Lv {{ entry.table.min_level }}–{{ entry.table.max_level }} ·
              {{ entry.table.entries.length }} entries
            </span>
          </button>
        </section>
      </div>

      <p v-else class="empty-state">
        No tables match that search.
      </p>
    </section>
  </aside>
</template>

<style scoped>
.encounter-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  border-right: 1px solid var(--rule);
  background: var(--paper);
  max-height: 100vh;
  overflow: auto;
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
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
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

.empty-state {
  text-align: center;
  font-style: italic;
}

.inline-link {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-color: var(--rule-strong);
  text-underline-offset: 0.18em;
}

.inline-link:hover {
  text-decoration-color: var(--accent);
}

code {
  font-family: var(--font-mono);
  font-size: 0.88em;
  color: var(--accent);
}

.search-field {
  display: flex;
  flex-direction: column;
  margin-bottom: 0.85rem;
}

input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.75rem;
  outline: none;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.region-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow: auto;
  min-height: 0;
}

.region-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.region-title {
  margin: 0;
  font-family: var(--font-book);
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.table-button {
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
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.table-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.table-button.active {
  border-color: var(--accent);
  background: var(--paper-active);
  color: var(--accent);
}

.table-name {
  font-weight: 700;
  letter-spacing: 0.02em;
}

.table-meta {
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.04em;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 1040px) {
  .encounter-sidebar {
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }
}
</style>
