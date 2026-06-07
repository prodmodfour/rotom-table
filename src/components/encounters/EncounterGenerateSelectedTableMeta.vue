<script setup lang="ts">
import type { EncounterTableEntry } from '~/types/encounterTable'
import { encounterTableDisplayEntryCountLabel, formatRegionLabel, formatTableLabel } from '~/utils/encounterTables'

defineProps<{
  selectedTable: EncounterTableEntry | null
}>()
</script>

<template>
  <div v-if="selectedTable" class="form-meta">
    <span class="meta-pill">
      Lv {{ selectedTable.table.min_level }}–{{ selectedTable.table.max_level }}
    </span>
    <span class="meta-pill">
      {{ encounterTableDisplayEntryCountLabel(selectedTable.table) }}
    </span>
    <span class="meta-pill subtle">
      {{ formatRegionLabel(selectedTable.region) }} /
      {{ formatTableLabel(selectedTable.key) }}
    </span>
  </div>
</template>

<style scoped>
.form-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.85rem;
}

.meta-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.18rem 0.6rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  color: var(--ink);
}

.meta-pill.subtle {
  color: var(--ink-muted);
  border-style: dashed;
}
</style>
