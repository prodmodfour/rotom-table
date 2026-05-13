<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import type { EditableCellValue } from '~/utils/editableCell'
import type { TrainerEdgeEntry, TrainerSheet } from '~/types/trainerSheet'
import {
  TRAINER_EDGE_AUTOFILL_COLUMNS,
  TRAINER_EDGE_NAME_COLUMN,
  TRAINER_EDGE_NAME_OPTIONS,
  TRAINER_EDGE_SKILL_OPTIONS,
  isBasicSkillsEdge,
  isTrainerSkillKey,
  trainerEdgeFieldValue,
  trainerSkillLabel,
  type TrainerEdgeAutofillField,
} from '~/utils/sheets/trainerEdges'

defineProps<{
  sheet: TrainerSheet
}>()

const emit = defineEmits<{
  addEdge: []
  removeEdge: [index: number]
}>()

const autofillValue = (edge: TrainerEdgeEntry, field: TrainerEdgeAutofillField): string =>
  trainerEdgeFieldValue(edge, field)

const setEdgeName = (edge: TrainerEdgeEntry, value: EditableCellValue) => {
  edge.name = typeof value === 'string' ? value : ''
  if (!isBasicSkillsEdge(edge)) delete edge.basicSkill
}

const setBasicSkill = (edge: TrainerEdgeEntry, value: EditableCellValue) => {
  if (isTrainerSkillKey(value)) edge.basicSkill = value
  else delete edge.basicSkill
}

const formatBasicSkill = (value: EditableCellValue): string =>
  typeof value === 'string' ? trainerSkillLabel(value) : ''
</script>

<template>
  <section class="tab-panel">
    <div class="block">
      <h2 class="block-title">
        Edges ({{ sheet.edges?.length ?? 0 }})
        <button type="button" class="row-add" @click="emit('addEdge')">
          <PhPlus :size="14" weight="bold" /> Add row
        </button>
      </h2>
      <div class="table-scroll">
        <table class="data-table edge-table">
          <thead>
            <tr>
              <th>{{ TRAINER_EDGE_NAME_COLUMN.label }}</th>
              <th
                v-for="column in TRAINER_EDGE_AUTOFILL_COLUMNS"
                :key="column.key"
              >{{ column.label }}</th>
              <th aria-label="Row actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(edge, index) in sheet.edges" :key="index">
              <th class="edge-name-col">
                <div class="edge-name-stack">
                  <EditableCell
                    :model-value="edge.name"
                    type="select"
                    :options="TRAINER_EDGE_NAME_OPTIONS"
                    @update:model-value="(value) => setEdgeName(edge, value)"
                  />
                  <label v-if="isBasicSkillsEdge(edge)" class="edge-extra-control">
                    <span class="edge-extra-label">Skill</span>
                    <EditableCell
                      :model-value="edge.basicSkill"
                      type="select"
                      :options="TRAINER_EDGE_SKILL_OPTIONS"
                      :format="formatBasicSkill"
                      @update:model-value="(value) => setBasicSkill(edge, value)"
                    />
                  </label>
                </div>
              </th>
              <td
                v-for="column in TRAINER_EDGE_AUTOFILL_COLUMNS"
                :key="column.key"
                class="auto-fill-col"
                :class="{ 'auto-fill-col--multiline': column.multiline }"
              >
                {{ autofillValue(edge, column.key) || '—' }}
              </td>
              <td class="row-actions">
                <button type="button" class="row-remove" title="Remove edge" @click="emit('removeEdge', index)">
                  <PhX :size="14" weight="bold" />
                </button>
              </td>
            </tr>
            <tr v-if="!sheet.edges?.length">
              <td :colspan="TRAINER_EDGE_AUTOFILL_COLUMNS.length + 2" class="muted">No edges taken.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.block {
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.7rem 0.85rem;
}

.block-title {
  margin: 0 0 0.5rem;
  font-family: var(--font-book);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-bright);
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.table-scroll {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.edge-table {
  min-width: 82rem;
}

.data-table th,
.data-table td {
  padding: 0.35rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--rule);
  vertical-align: top;
}

.data-table th {
  font-weight: 600;
  color: var(--ink-bright);
}

.data-table thead th {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-muted);
  background: transparent;
  font-weight: 600;
}

.row-add {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid var(--rule-soft);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink-soft);
  padding: 0.2rem 0.45rem;
  font: inherit;
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  cursor: pointer;
  text-transform: none;
}

.row-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.row-remove {
  display: inline-flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-soft);
  padding: 0.2rem;
  font: inherit;
  cursor: pointer;
  margin-left: 0.4rem;
}

.row-remove:hover {
  color: #d36464;
  border-color: rgba(220, 80, 80, 0.45);
  background: rgba(220, 80, 80, 0.08);
}

.edge-name-col {
  min-width: 12rem;
}

.edge-name-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
}

.edge-extra-control {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  color: var(--ink-soft);
  font-weight: 400;
}

.edge-extra-label {
  color: var(--ink-muted);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.auto-fill-col {
  min-width: 9rem;
  color: var(--ink-soft);
}

.auto-fill-col--multiline {
  min-width: 14rem;
  white-space: pre-wrap;
}

.row-actions {
  width: 1.5rem;
  text-align: right;
}

.muted {
  color: var(--ink-muted);
  font-size: 0.85rem;
}
</style>
