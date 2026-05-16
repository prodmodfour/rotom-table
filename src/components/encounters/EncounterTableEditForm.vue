<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EncounterTable } from '~/types/encounterTable'
import {
  createEncounterTableEditRow,
  encounterTableEditModelToTable,
  encounterTableEditTotalPercent,
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

watch(
  () => props.table,
  (table) => {
    model.value = encounterTableToEditModel(table)
    localError.value = null
  },
)

const totalPercent = computed(() => encounterTableEditTotalPercent(model.value.rows))
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

    <div class="table-heading">
      <span>Pokémon</span>
      <span>Chance</span>
      <span>Min Lv</span>
      <span>Max Lv</span>
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
        <span class="sr-only">Row {{ index + 1 }} chance percent</span>
        <input v-model.number="row.percent" type="number" min="1" max="100" :disabled="saving" />
        <span class="suffix">%</span>
      </label>
      <label class="field">
        <span class="sr-only">Row {{ index + 1 }} minimum level</span>
        <input v-model.number="row.minLevel" type="number" min="1" max="100" :disabled="saving" />
      </label>
      <label class="field">
        <span class="sr-only">Row {{ index + 1 }} maximum level</span>
        <input v-model.number="row.maxLevel" type="number" min="1" max="100" :disabled="saving" />
      </label>
      <button
        type="button"
        class="row-remove"
        :disabled="saving || model.rows.length <= 1"
        @click="removeRow(row.id)"
      >
        Remove
      </button>
    </div>

    <div class="edit-summary" :class="{ invalid: totalPercent !== 100 }">
      Total chance: {{ totalPercent }}%
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
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

input:disabled {
  opacity: 0.65;
  cursor: progress;
}

.table-heading,
.table-row {
  display: grid;
  grid-template-columns: minmax(9rem, 1fr) 5.5rem 5rem 5rem auto;
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

.numeric-field input {
  padding-right: 1.8rem;
}

.suffix {
  position: absolute;
  right: 0.65rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ink-muted);
  pointer-events: none;
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

.edit-summary.invalid {
  color: var(--bad);
}

.edit-errors {
  margin: 0;
  padding: 0.7rem 0.9rem;
  border: 1px solid rgba(251, 73, 52, 0.35);
  border-radius: 10px;
  background: rgba(251, 73, 52, 0.08);
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

  .row-remove {
    grid-column: 1 / -1;
  }
}
</style>
