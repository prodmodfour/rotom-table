<script setup lang="ts">
import type { EncounterTableEntry } from '~/types/encounterTable'
import { formatRegionLabel } from '~/utils/encounterTables'

const region = defineModel<string>('region', { required: true })
const tableKey = defineModel<string>('tableKey', { required: true })
const count = defineModel<number>('count', { required: true })
const outRoot = defineModel<string>('outRoot', { required: true })
const preview = defineModel<boolean>('preview', { required: true })

defineProps<{
  regions: string[]
  tablesForRegion: EncounterTableEntry[]
  generating: boolean
}>()
</script>

<template>
  <div class="form-grid">
    <label class="field">
      <span class="field-label">Region</span>
      <select v-model="region" :disabled="generating">
        <option v-for="r in regions" :key="r" :value="r">
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
</template>

<style scoped>
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
  box-shadow: 0 0 0 2px rgba(255, 31, 45, 0.18);
}

select:disabled,
input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 720px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
