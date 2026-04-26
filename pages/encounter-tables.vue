<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  describeEntries,
  encounterRegions,
  encounterTables,
  formatRegionLabel,
  formatTableLabel,
  tablesInRegion,
} from '~/utils/encounterTables'

useHead({
  title: 'Encounter Tables · Rotom Table',
})

const searchTerm = ref('')

const normalize = (value: string) => value.trim().toLowerCase()

/**
 * Filter visible region/table tree by the search box. A region is shown if
 * its name matches; otherwise individual tables show if the table name or
 * any species inside it matches.
 */
const filteredByRegion = computed(() => {
  const query = normalize(searchTerm.value)
  return encounterRegions
    .map((region) => {
      const allTables = tablesInRegion(region)
      const regionMatches = !query || normalize(region).includes(query) || normalize(formatRegionLabel(region)).includes(query)
      const visibleTables = regionMatches
        ? allTables
        : allTables.filter((entry) => {
            const haystacks = [
              entry.key,
              entry.table.name,
              ...entry.table.entries.map(([, species]) => species),
            ]
            return haystacks.some((value) => normalize(value).includes(query))
          })
      return { region, tables: visibleTables }
    })
    .filter(({ tables }) => tables.length > 0)
})

const initialEntry = encounterTables[0] ?? null
const selectedRegion = ref<string | null>(initialEntry?.region ?? null)
const selectedKey    = ref<string | null>(initialEntry?.key ?? null)

const selectEntry = (region: string, key: string) => {
  selectedRegion.value = region
  selectedKey.value = key
}

const selectedEntry = computed(() => {
  if (!selectedRegion.value || !selectedKey.value) return null
  return (
    encounterTables.find(
      (entry) => entry.region === selectedRegion.value && entry.key === selectedKey.value,
    ) ?? null
  )
})

const selectedRows = computed(() =>
  selectedEntry.value ? describeEntries(selectedEntry.value.table) : [],
)

const totalCount = encounterTables.length
const filteredCount = computed(() =>
  filteredByRegion.value.reduce((sum, group) => sum + group.tables.length, 0),
)
</script>

<template>
  <div class="encounter-layout">
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
          Use the <NuxtLink to="/generate" class="inline-link">Generate</NuxtLink>
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
              @click="selectEntry(entry.region, entry.key)"
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

    <main class="encounter-detail">
      <article v-if="selectedEntry" class="panel-card">
        <header class="detail-heading">
          <div class="detail-titles">
            <h2 class="detail-title">{{ selectedEntry.table.name }}</h2>
            <p class="detail-subtitle">
              <span class="path-segment">{{ formatRegionLabel(selectedEntry.region) }}</span>
              <span class="path-sep">/</span>
              <span class="path-segment">{{ formatTableLabel(selectedEntry.key) }}</span>
            </p>
          </div>
          <div class="detail-pills">
            <span class="badge">Lv {{ selectedEntry.table.min_level }}–{{ selectedEntry.table.max_level }}</span>
            <span class="badge">{{ selectedEntry.table.entries.length }} entries</span>
          </div>
        </header>

        <div class="entry-list">
          <div class="entry-row entry-row--head">
            <span class="entry-roll">Roll</span>
            <span class="entry-pct">%</span>
            <span class="entry-species">Species</span>
          </div>
          <div
            v-for="(row, index) in selectedRows"
            :key="`${row.species}-${index}`"
            class="entry-row"
          >
            <span class="entry-roll">{{ row.range }}</span>
            <span class="entry-pct">{{ row.percent }}%</span>
            <span class="entry-species">{{ row.species }}</span>
          </div>
        </div>

        <footer class="detail-actions">
          <NuxtLink
            :to="`/generate?region=${selectedEntry.region}&table=${selectedEntry.key}`"
            class="cta-link"
          >
            Roll on this table →
          </NuxtLink>
        </footer>
      </article>

      <section v-else class="panel-card panel-card--empty">
        <h2>No encounter tables yet</h2>
        <p>
          Drop a JSON file into
          <code>encounter_tables/&lt;region&gt;/&lt;table&gt;.json</code>
          and refresh.
        </p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.encounter-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  min-height: 100vh;
  background: var(--paper);
}

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
  font-family: var(--serif);
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
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
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
  font-family: var(--serif);
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

/* ----- detail pane ----- */

.encounter-detail {
  min-width: 0;
  padding: 1.5rem;
  display: flex;
  justify-content: center;
}

.panel-card {
  width: 100%;
  max-width: 720px;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 1.6rem 1.8rem;
}

.panel-card--empty {
  text-align: center;
  color: var(--ink-muted);
}

.detail-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin: 0 0 1rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--rule);
}

.detail-titles {
  min-width: 0;
}

.detail-title {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.detail-subtitle {
  margin: 0.25rem 0 0;
  color: var(--ink-muted);
  font-size: 0.85rem;
  letter-spacing: 0.06em;
}

.path-sep {
  color: var(--ink-faint);
  margin: 0 0.4rem;
}

.detail-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: flex-end;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-variant-numeric: tabular-nums;
}

.entry-row {
  display: grid;
  grid-template-columns: 6.5rem 4rem 1fr;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.45rem 0.65rem;
  border-radius: 8px;
}

.entry-row:nth-child(odd) {
  background: var(--paper-inset);
}

.entry-row--head {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
  background: transparent !important;
  padding-top: 0;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--rule);
  border-radius: 0;
  margin-bottom: 0.2rem;
}

.entry-roll {
  font-weight: 700;
  color: var(--accent);
}

.entry-row--head .entry-roll {
  color: var(--ink-muted);
  font-weight: 600;
}

.entry-pct {
  color: var(--ink-soft);
  font-size: 0.85rem;
}

.entry-species {
  color: var(--ink);
  font-family: var(--serif);
  font-size: 1.02rem;
  letter-spacing: 0.02em;
}

.detail-actions {
  margin-top: 1.2rem;
  display: flex;
  justify-content: flex-end;
}

.cta-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--accent);
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
  text-decoration: none;
  letter-spacing: 0.04em;
  font-weight: 600;
  transition: background 0.15s ease, color 0.15s ease;
}

.cta-link:hover {
  background: rgba(250, 189, 47, 0.22);
  color: var(--ink-bright);
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
  .encounter-layout {
    grid-template-columns: 1fr;
  }

  .encounter-sidebar {
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid var(--rule);
  }

  .encounter-detail {
    padding: 1rem;
  }
}
</style>
