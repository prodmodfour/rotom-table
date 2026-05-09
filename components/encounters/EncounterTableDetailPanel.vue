<script setup lang="ts">
import {
  formatRegionLabel,
  formatTableLabel,
  type DisplayedEncounterRow,
} from '~/utils/encounterTables'
import type { EncounterTableEntry } from '~/types/encounterTable'

defineProps<{
  selectedEntry: EncounterTableEntry | null
  selectedRows: DisplayedEncounterRow[]
}>()
</script>

<template>
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
</template>

<style scoped>
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

code {
  font-family: var(--font-mono);
  font-size: 0.88em;
  color: var(--accent);
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
  font-family: var(--font-book);
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
  font-family: var(--font-book);
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

@media (max-width: 1040px) {
  .encounter-detail {
    padding: 1rem;
  }
}
</style>
