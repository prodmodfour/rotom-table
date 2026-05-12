<script setup lang="ts">
import type { RolledEncounter } from '~/types/encounterTable'

defineProps<{
  encounters: RolledEncounter[]
}>()
</script>

<template>
  <section class="panel-card preview-card">
    <h2 class="panel-title">
      Rolled encounters
      <span class="panel-subtle">browser-side preview · click <em>Generate folder</em> to stat</span>
    </h2>
    <ol class="rolled-list">
      <li
        v-for="(enc, index) in encounters"
        :key="`${enc.species}-${index}-${enc.roll}`"
        class="rolled-row"
      >
        <span class="rolled-num">{{ index + 1 }}.</span>
        <span class="rolled-roll">[{{ enc.roll }}]</span>
        <span class="rolled-species">{{ enc.species }}</span>
        <span class="rolled-level">Lv {{ enc.level }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.panel-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 1.1rem 1.2rem;
}

.panel-title {
  margin: 0 0 0.85rem;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.panel-subtle {
  font-size: 0.74rem;
  color: var(--ink-muted);
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: none;
  font-family: var(--font-ui);
}

.rolled-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-variant-numeric: tabular-nums;
}

.rolled-row {
  display: grid;
  grid-template-columns: 2.5rem 4rem minmax(0, 1fr) 5rem;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.4rem 0.65rem;
  border-radius: 8px;
}

.rolled-row:nth-child(odd) {
  background: var(--paper-inset);
}

.rolled-num {
  color: var(--ink-muted);
  font-size: 0.85rem;
}

.rolled-roll {
  color: var(--accent);
  font-weight: 700;
  font-size: 0.85rem;
}

.rolled-species {
  font-family: var(--font-book);
  font-size: 1.02rem;
  color: var(--ink-bright);
  letter-spacing: 0.02em;
}

.rolled-level {
  text-align: right;
  color: var(--ink);
  font-weight: 600;
}
</style>
