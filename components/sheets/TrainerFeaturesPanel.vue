<script setup lang="ts">
import { PhPlus, PhX } from '@phosphor-icons/vue'
import type { TrainerFeatureEntry, TrainerSheet } from '~/types/trainerSheet'

defineProps<{
  sheet: TrainerSheet
  featureTagsCsv: (feature: TrainerFeatureEntry) => string
}>()

const emit = defineEmits<{
  addFeature: []
  removeFeature: [index: number]
  setFeatureTags: [feature: TrainerFeatureEntry, value: string]
}>()
</script>

<template>
  <section class="tab-panel">
    <div class="block">
      <h2 class="block-title">
        Features ({{ sheet.features?.length ?? 0 }})
        <button type="button" class="row-add" @click="emit('addFeature')">
          <PhPlus :size="14" weight="bold" /> Add row
        </button>
      </h2>
      <table class="data-table feat-table">
        <thead>
          <tr>
            <th>Feature</th>
            <th>Tags</th>
            <th>Frequency / Action</th>
            <th>Notes</th>
            <th aria-label="Row actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(feature, index) in sheet.features" :key="index">
            <th><EditableCell v-model="feature.name" placeholder="Feature" /></th>
            <td>
              <EditableCell
                :model-value="featureTagsCsv(feature)"
                placeholder="Class"
                @update:model-value="(value) => emit('setFeatureTags', feature, (value as string) ?? '')"
              />
            </td>
            <td><EditableCell v-model="feature.frequency" placeholder="—" /></td>
            <td class="effect-col">
              <EditableCell v-model="feature.notes" type="textarea" placeholder="—" multiline />
            </td>
            <td class="row-actions">
              <button type="button" class="row-remove" title="Remove feature" @click="emit('removeFeature', index)">
                <PhX :size="14" weight="bold" />
              </button>
            </td>
          </tr>
          <tr v-if="!sheet.features?.length">
            <td colspan="5" class="muted">No features taken.</td>
          </tr>
        </tbody>
      </table>
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

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
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

.row-actions {
  width: 1.5rem;
  text-align: right;
}

.effect-col {
  color: var(--ink-soft);
  white-space: pre-wrap;
  max-width: 22rem;
}

.muted {
  color: var(--ink-muted);
  font-size: 0.85rem;
}
</style>
