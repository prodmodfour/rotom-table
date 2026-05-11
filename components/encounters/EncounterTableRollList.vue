<script setup lang="ts">
import type { DisplayedEncounterRow } from '~/utils/encounterTables'

defineProps<{
  rows: DisplayedEncounterRow[]
}>()
</script>

<template>
  <div class="entry-list">
    <div class="entry-row entry-row--head">
      <span class="entry-roll">Roll</span>
      <span class="entry-pct">%</span>
      <span class="entry-species">Species</span>
    </div>
    <div
      v-for="(row, index) in rows"
      :key="`${row.species}-${index}`"
      class="entry-row"
    >
      <span class="entry-roll">{{ row.range }}</span>
      <span class="entry-pct">{{ row.percent }}%</span>
      <span class="entry-species">{{ row.species }}</span>
    </div>
  </div>
</template>

<style scoped>
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
</style>
