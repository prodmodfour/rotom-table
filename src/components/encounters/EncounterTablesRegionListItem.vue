<script setup lang="ts">
import type { EncounterTableEntry } from '~/types/encounterTable'
import { encounterTableDisplayEntryCountLabel } from '~/utils/encounterTables'

defineProps<{
  entry: EncounterTableEntry
  selected: boolean
}>()

const emit = defineEmits<{
  (event: 'select-entry', region: string, key: string): void
}>()
</script>

<template>
  <button
    type="button"
    :class="['table-button', { active: selected }]"
    @click="emit('select-entry', entry.region, entry.key)"
  >
    <span class="table-name">{{ entry.table.name }}</span>
    <span class="table-meta">
      Lv {{ entry.table.min_level }}–{{ entry.table.max_level }} ·
      {{ encounterTableDisplayEntryCountLabel(entry.table) }}
    </span>
  </button>
</template>

<style scoped>
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
</style>
