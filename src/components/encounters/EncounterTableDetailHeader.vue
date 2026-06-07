<script setup lang="ts">
import {
  encounterTableDisplayEntryCountLabel,
  formatRegionLabel,
  formatTableLabel,
} from '~/utils/encounterTables'
import type { EncounterTableEntry } from '~/types/encounterTable'

defineProps<{
  selectedEntry: EncounterTableEntry
}>()
</script>

<template>
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
      <span class="badge">{{ encounterTableDisplayEntryCountLabel(selectedEntry.table) }}</span>
    </div>
  </header>
</template>

<style scoped>
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
</style>
