<script setup lang="ts">
import { computed, watch } from 'vue'
import { PhPlus, PhX } from '@phosphor-icons/vue'
import type { EditableCellValue } from '~/utils/editableCell'
import type { TrainerFeatureEntry, TrainerSheet } from '~/types/trainerSheet'
import {
  TRAINER_FEATURE_AUTOFILL_COLUMNS,
  TRAINER_FEATURE_NAME_COLUMN,
  TRAINER_FEATURE_NAME_OPTIONS,
  trainerFeatureFieldValue,
  trainerFeatureInspectorStatus,
  trainerFreeTrainingFeatureEntry,
  syncTrainerFeatureAutomation,
  type TrainerFeatureAutofillField,
} from '~/utils/sheets/trainerFeatures'
import {
  TRAINER_FREE_TRAINING_FEATURE_NAME,
  TRAINER_TRAINING_FEATURE_CHOICE_KEY,
  stripTrainerEntryChoiceSuffix,
  trainerFeatureSubchoices,
  updateTrainerChoiceEntryName,
} from '~/utils/sheets/trainerSubchoices'
import {
  POKEMON_TRAINING_FEATURE_OPTIONS,
  normalizePokemonTrainingFeatureName,
} from '~/utils/sheets/pokemonTrainingFeatures'

const props = defineProps<{
  sheet: TrainerSheet
}>()

const sheet = computed(() => props.sheet)

const emit = defineEmits<{
  addFeature: []
  removeFeature: [index: number]
}>()

const featureCount = computed(() => (sheet.value.features?.length ?? 0) + 1)
const freeTrainingFeature = computed(() => trainerFreeTrainingFeatureEntry(sheet.value.trainingFeature))
const freeTrainingFeatureValue = computed(() => freeTrainingFeature.value.choices?.[TRAINER_TRAINING_FEATURE_CHOICE_KEY] ?? '')

const autofillValue = (feature: TrainerFeatureEntry, field: TrainerFeatureAutofillField): string =>
  trainerFeatureFieldValue(feature, field)

const setFeatureName = (feature: TrainerFeatureEntry, index: number, value: EditableCellValue) => {
  delete feature.automation
  updateTrainerChoiceEntryName(feature, value, trainerFeatureSubchoices)
  syncTrainerFeatureAutomation(props.sheet, feature, index)
}

watch(
  () => props.sheet.features,
  features => features?.forEach((feature, index) => syncTrainerFeatureAutomation(props.sheet, feature, index)),
  { deep: true, immediate: true, flush: 'sync' },
)

const setFreeTrainingFeature = (value: EditableCellValue) => {
  const selectedFeature = normalizePokemonTrainingFeatureName(value)
  if (selectedFeature) sheet.value.trainingFeature = selectedFeature
  else delete sheet.value.trainingFeature
}
</script>

<template>
  <section class="tab-panel">
    <div class="block">
      <h2 class="block-title">
        Features ({{ featureCount }})
        <button type="button" class="row-add" @click="emit('addFeature')">
          <PhPlus :size="14" weight="bold" /> Add row
        </button>
      </h2>
      <div class="table-scroll">
        <table class="data-table feat-table">
          <thead>
            <tr>
              <th>{{ TRAINER_FEATURE_NAME_COLUMN.label }}</th>
              <th
                v-for="column in TRAINER_FEATURE_AUTOFILL_COLUMNS"
                :key="column.key"
              >{{ column.label }}</th>
              <th aria-label="Row actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr class="free-training-row">
              <th class="feature-name-col">
                <div class="feature-name-stack">
                  <span class="locked-feature-name">{{ TRAINER_FREE_TRAINING_FEATURE_NAME }}</span>
                  <label class="trainer-subchoice-control">
                    <span class="trainer-subchoice-label">Training feature</span>
                    <EditableCell
                      :model-value="freeTrainingFeatureValue"
                      type="select"
                      :options="POKEMON_TRAINING_FEATURE_OPTIONS"
                      placeholder="Choose feature"
                      @update:model-value="setFreeTrainingFeature"
                    />
                  </label>
                </div>
              </th>
              <td
                v-for="column in TRAINER_FEATURE_AUTOFILL_COLUMNS"
                :key="column.key"
                class="auto-fill-col"
                :class="{ 'auto-fill-col--multiline': column.multiline }"
              >
                {{ autofillValue(freeTrainingFeature, column.key) || '—' }}
              </td>
              <td class="row-actions row-actions--locked">
                <span class="row-locked-note" title="Every trainer gets one free Training Feature.">Free</span>
              </td>
            </tr>
            <tr v-for="(feature, index) in sheet.features" :key="index">
              <th class="feature-name-col">
                <div class="feature-name-stack">
                  <EditableCell
                    :model-value="stripTrainerEntryChoiceSuffix(feature.name)"
                    type="select"
                    :options="TRAINER_FEATURE_NAME_OPTIONS"
                    @update:model-value="(value) => setFeatureName(feature, index, value)"
                  />
                  <TrainerEntrySubchoiceControls
                    :entry="feature"
                    :definitions="trainerFeatureSubchoices(feature)"
                  />
                  <span
                    class="feature-automation-status"
                    :class="`feature-automation-status--${trainerFeatureInspectorStatus(sheet, feature, index).status}`"
                    :title="trainerFeatureInspectorStatus(sheet, feature, index).diagnostics.join('\n')"
                  >{{ trainerFeatureInspectorStatus(sheet, feature, index).label }}</span>
                </div>
              </th>
              <td
                v-for="column in TRAINER_FEATURE_AUTOFILL_COLUMNS"
                :key="column.key"
                class="auto-fill-col"
                :class="{ 'auto-fill-col--multiline': column.multiline }"
              >
                {{ autofillValue(feature, column.key) || '—' }}
              </td>
              <td class="row-actions">
                <button type="button" class="row-remove" title="Remove feature" @click="emit('removeFeature', index)">
                  <PhX :size="14" weight="bold" />
                </button>
              </td>
            </tr>
            <tr v-if="!sheet.features?.length">
              <td :colspan="TRAINER_FEATURE_AUTOFILL_COLUMNS.length + 2" class="muted">No additional features taken.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped src="./sheetTabTablePanel.css"></style>
<style scoped>
.feat-table {
  min-width: 92rem;
}

.free-training-row {
  background: rgba(var(--accent-rgb), 0.055);
}

.locked-feature-name {
  font-weight: 700;
  color: var(--ink-bright);
}

.trainer-subchoice-control {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  color: var(--ink-soft);
  font-weight: 400;
}

.trainer-subchoice-label {
  color: var(--ink-muted);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.row-locked-note {
  display: inline-flex;
  align-items: center;
  margin-left: 0.35rem;
  color: var(--ink-muted);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  vertical-align: middle;
}

.feature-name-col {
  min-width: 12rem;
}

.feature-name-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
}

.feature-automation-status {
  border: 1px solid rgba(var(--accent-rgb), 0.3);
  border-radius: 999px;
  padding: 0.1rem 0.4rem;
  color: var(--ink-muted);
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.feature-automation-status--ready { color: #78d7a5; border-color: rgba(120, 215, 165, 0.45); }
.feature-automation-status--missing-required-data { color: #f4cc72; border-color: rgba(244, 204, 114, 0.45); }
.feature-automation-status--malformed,
.feature-automation-status--unresolved-identity { color: #ef8d8d; border-color: rgba(239, 141, 141, 0.45); }
</style>
