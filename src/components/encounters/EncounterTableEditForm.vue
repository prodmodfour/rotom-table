<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { formatEncounterChancePercent } from '#shared/encounterTables'
import type { EncounterTable } from '~/types/encounterTable'
import {
  createEncounterTableEditRow,
  encounterTableEditModelToTable,
  encounterTableEditTotalWeight,
  encounterTableToEditModel,
  validateEncounterTableEditModel,
  type EncounterTableEditModel,
} from '~/utils/encounterTableEditing'

const props = defineProps<{
  table: EncounterTable
  saving: boolean
  error: string | null
}>()

const emit = defineEmits<{
  save: [table: EncounterTable]
  cancel: []
}>()

const model = ref<EncounterTableEditModel>(encounterTableToEditModel(props.table))
const localError = ref<string | null>(null)

const rarityWeightGuide = [
  { rarity: 'Common', weight: 60, feel: 'Seen constantly' },
  { rarity: 'Uncommon', weight: 25, feel: 'Seen regularly' },
  { rarity: 'Rare', weight: 10, feel: 'Noticeably special' },
  { rarity: 'Very Rare', weight: 4, feel: 'Takes some searching' },
  { rarity: 'Extremely Rare', weight: 1, feel: 'Exciting when it appears' },
] as const

watch(
  () => props.table,
  (table) => {
    model.value = encounterTableToEditModel(table)
    localError.value = null
  },
)

const totalWeight = computed(() => encounterTableEditTotalWeight(model.value.rows))
const encounterChanceLabel = (weight: number): string => {
  const numericWeight = Number(weight)
  if (!Number.isFinite(numericWeight) || numericWeight <= 0 || totalWeight.value <= 0) return '—'
  return formatEncounterChancePercent(numericWeight, totalWeight.value)
}
const validation = computed(() => validateEncounterTableEditModel(model.value))
const validationErrors = computed(() => validation.value.errors)
const canSave = computed(() => validation.value.valid && !props.saving)

const addRow = () => {
  model.value = {
    ...model.value,
    rows: [...model.value.rows, createEncounterTableEditRow(model.value.rows)],
  }
}

const removeRow = (id: string) => {
  if (model.value.rows.length <= 1) return
  model.value = {
    ...model.value,
    rows: model.value.rows.filter((row) => row.id !== id),
  }
}

const save = () => {
  localError.value = null
  try {
    emit('save', encounterTableEditModelToTable(model.value))
  } catch (err: unknown) {
    localError.value = err instanceof Error ? err.message : 'Invalid encounter table.'
  }
}
</script>

<template>
  <form class="encounter-edit-form" @submit.prevent="save">
    <label class="field field--name">
      <span class="field-label">Table name</span>
      <input v-model.trim="model.name" type="text" maxlength="80" :disabled="saving" />
    </label>

    <section class="weight-guide" aria-labelledby="weight-guide-title">
      <div class="weight-guide-copy">
        <h3 id="weight-guide-title">Weighting guide</h3>
        <p>Optional reference only; these rarity labels and weights are not enforced.</p>
      </div>
      <table class="weight-guide-table">
        <thead>
          <tr>
            <th scope="col">Rarity</th>
            <th scope="col">Weight</th>
            <th scope="col">Approx. feel</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="guide in rarityWeightGuide" :key="guide.rarity">
            <td class="weight-guide-rarity">{{ guide.rarity }}</td>
            <td class="weight-guide-weight">{{ guide.weight }}</td>
            <td>{{ guide.feel }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="table-heading">
      <span>Pokémon</span>
      <span>Weight</span>
      <span>Min Lv</span>
      <span>Max Lv</span>
      <span>Chance</span>
      <span class="sr-only">Actions</span>
    </div>

    <div
      v-for="(row, index) in model.rows"
      :key="row.id"
      class="table-row"
    >
      <label class="field">
        <span class="sr-only">Row {{ index + 1 }} species</span>
        <input v-model.trim="row.species" type="text" :disabled="saving" placeholder="Species" />
      </label>
      <label class="field numeric-field">
        <span class="sr-only">Row {{ index + 1 }} encounter weight</span>
        <input v-model.number="row.weight" type="number" min="1" :disabled="saving" />
      </label>
      <label class="field">
        <span class="sr-only">Row {{ index + 1 }} minimum level</span>
        <input v-model.number="row.minLevel" type="number" min="1" max="100" :disabled="saving" />
      </label>
      <label class="field">
        <span class="sr-only">Row {{ index + 1 }} maximum level</span>
        <input v-model.number="row.maxLevel" type="number" min="1" max="100" :disabled="saving" />
      </label>
      <output class="row-chance" :aria-label="`Row ${index + 1} calculated encounter chance`">
        {{ encounterChanceLabel(row.weight) }}
      </output>
      <button
        type="button"
        class="row-remove"
        :disabled="saving || model.rows.length <= 1"
        @click="removeRow(row.id)"
      >
        Remove
      </button>
    </div>

    <div class="edit-summary">
      Total weight: {{ totalWeight }}
      <span class="summary-note">Chances are calculated from relative weights when rolling.</span>
    </div>

    <ul v-if="validationErrors.length || localError || error" class="edit-errors">
      <li v-for="validationError in validationErrors" :key="validationError">
        {{ validationError }}
      </li>
      <li v-if="localError">{{ localError }}</li>
      <li v-if="error">{{ error }}</li>
    </ul>

    <footer class="form-actions">
      <button type="button" class="secondary-button" :disabled="saving" @click="addRow">
        Add Pokémon
      </button>
      <span class="action-spacer" aria-hidden="true" />
      <button type="button" class="secondary-button" :disabled="saving" @click="emit('cancel')">
        Cancel
      </button>
      <button type="submit" class="primary-button" :disabled="!canSave">
        {{ saving ? 'Saving…' : 'Save table' }}
      </button>
    </footer>
  </form>
</template>

<style scoped>
.encounter-edit-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.field--name {
  margin-bottom: 0.15rem;
}

.field-label {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

input {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.7rem;
  outline: none;
  font: inherit;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(255, 31, 45, 0.18);
}

input:disabled {
  opacity: 0.65;
  cursor: progress;
}

.weight-guide {
  display: grid;
  gap: 0.65rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.75rem 0.85rem;
}

.weight-guide-copy {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.65rem;
  align-items: baseline;
}

.weight-guide h3,
.weight-guide p {
  margin: 0;
}

.weight-guide h3 {
  color: var(--ink-bright);
  font-size: 0.78rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.weight-guide p {
  color: var(--ink-muted);
  font-size: 0.8rem;
  line-height: 1.45;
}

.weight-guide-table {
  width: 100%;
  border-collapse: collapse;
  color: var(--ink-soft);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

.weight-guide-table th,
.weight-guide-table td {
  padding: 0.3rem 0.45rem;
  text-align: left;
  border-top: 1px solid var(--rule-soft);
}

.weight-guide-table th {
  color: var(--ink-muted);
  font-size: 0.68rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.weight-guide-table th:nth-child(2),
.weight-guide-weight {
  text-align: right;
}

.weight-guide-weight {
  color: var(--accent);
  font-family: var(--font-mono);
  white-space: nowrap;
}

.weight-guide-rarity {
  color: var(--ink-bright);
  font-weight: 700;
}

.table-heading,
.table-row {
  display: grid;
  grid-template-columns: minmax(7rem, 1fr) 4.5rem 4.25rem 4.25rem 4.75rem 4.75rem;
  gap: 0.5rem;
  align-items: center;
}

.table-heading {
  color: var(--ink-muted);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.numeric-field {
  position: relative;
}

.row-chance {
  display: inline-flex;
  align-items: center;
  min-height: 2.5rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  color: var(--good);
  padding: 0.55rem 0.7rem;
  font-family: var(--font-mono);
  font-size: 0.86rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.row-remove,
.secondary-button,
.primary-button {
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: var(--paper-soft);
  color: var(--ink);
  padding: 0.55rem 0.75rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
}

.row-remove {
  color: var(--ink-muted);
}

.primary-button {
  border-color: var(--accent);
  color: var(--accent);
}

.row-remove:hover:not(:disabled),
.secondary-button:hover:not(:disabled),
.primary-button:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
}

.primary-button:hover:not(:disabled) {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.edit-summary {
  color: var(--good);
  font-size: 0.84rem;
  letter-spacing: 0.04em;
}

.summary-note {
  color: var(--ink-muted);
  margin-left: 0.35rem;
}

.edit-errors {
  margin: 0;
  padding: 0.7rem 0.9rem;
  border: 1px solid rgba(255, 31, 45, 0.35);
  border-radius: 10px;
  background: rgba(255, 31, 45, 0.08);
  color: var(--bad);
  list-style-position: inside;
  font-size: 0.84rem;
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.action-spacer {
  flex: 1 1 auto;
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

@media (max-width: 720px) {
  .table-heading {
    display: none;
  }

  .table-row {
    grid-template-columns: 1fr 1fr;
    padding: 0.7rem;
    border: 1px solid var(--rule-soft);
    border-radius: 12px;
    background: var(--paper-inset);
  }

  .row-chance {
    justify-content: space-between;
    gap: 0.5rem;
  }

  .row-chance::before {
    content: 'Chance';
    color: var(--ink-muted);
    font-family: var(--font-ui);
    font-size: 0.68rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .row-remove {
    grid-column: 1 / -1;
  }
}
</style>
