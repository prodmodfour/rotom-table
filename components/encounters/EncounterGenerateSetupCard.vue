<script setup lang="ts">
import {
  encounterRegions,
  formatRegionLabel,
  formatTableLabel,
} from '~/utils/encounterTables'
import type { EncounterTableEntry } from '~/types/encounterTable'

const region = defineModel<string>('region', { required: true })
const tableKey = defineModel<string>('tableKey', { required: true })
const count = defineModel<number>('count', { required: true })
const outRoot = defineModel<string>('outRoot', { required: true })
const preview = defineModel<boolean>('preview', { required: true })

defineProps<{
  tablesForRegion: EncounterTableEntry[]
  selectedTable: EncounterTableEntry | null
  generating: boolean
}>()

const emit = defineEmits<{
  (event: 'roll-preview'): void
  (event: 'generate'): void
}>()
</script>

<template>
  <section class="panel-card form-card">
    <h2 class="panel-title">Roll setup</h2>

    <div class="form-grid">
      <label class="field">
        <span class="field-label">Region</span>
        <select v-model="region" :disabled="generating">
          <option v-for="r in encounterRegions" :key="r" :value="r">
            {{ formatRegionLabel(r) }}
          </option>
        </select>
      </label>

      <label class="field">
        <span class="field-label">Table</span>
        <select v-model="tableKey" :disabled="generating || tablesForRegion.length === 0">
          <option
            v-for="entry in tablesForRegion"
            :key="entry.key"
            :value="entry.key"
          >
            {{ entry.table.name }}
          </option>
        </select>
      </label>

      <label class="field">
        <span class="field-label">Count</span>
        <input
          v-model.number="count"
          type="number"
          min="1"
          max="30"
          :disabled="generating"
        />
      </label>

      <label class="field">
        <span class="field-label">Output root</span>
        <input
          v-model.trim="outRoot"
          type="text"
          :disabled="generating || preview"
          placeholder="data/sheets/wild"
        />
      </label>
    </div>

    <div v-if="selectedTable" class="form-meta">
      <span class="meta-pill">
        Lv {{ selectedTable.table.min_level }}–{{ selectedTable.table.max_level }}
      </span>
      <span class="meta-pill">
        {{ selectedTable.table.entries.length }} entries
      </span>
      <span class="meta-pill subtle">
        {{ formatRegionLabel(selectedTable.region) }} /
        {{ formatTableLabel(selectedTable.key) }}
      </span>
    </div>

    <EncounterGenerateSetupActions
      v-model:preview="preview"
      :has-selected-table="Boolean(selectedTable)"
      :generating="generating"
      @roll-preview="emit('roll-preview')"
      @generate="emit('generate')"
    />
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

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.7rem;
  margin-bottom: 0.85rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.field-label {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

select,
input[type='text'],
input[type='number'] {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.75rem;
  outline: none;
  font: inherit;
}

select:focus,
input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

select:disabled,
input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

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

@media (max-width: 720px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
