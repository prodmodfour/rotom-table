<script setup lang="ts">
import type { EditableCellValue } from '~/utils/editableCell'
import {
  setTrainerSubchoiceValue,
  trainerSubchoiceDisplayValue,
  trainerSubchoiceValue,
  type TrainerChoiceEntry,
  type TrainerSubchoiceDefinition,
} from '~/utils/sheets/trainerSubchoices'

const props = defineProps<{
  entry: TrainerChoiceEntry
  definitions: readonly TrainerSubchoiceDefinition[]
}>()

const selectionValue = (definition: TrainerSubchoiceDefinition): string =>
  trainerSubchoiceValue(props.entry, definition, props.definitions)

const setSelectionValue = (definition: TrainerSubchoiceDefinition, value: EditableCellValue) => {
  setTrainerSubchoiceValue(props.entry, definition, value)
}

const formatSelection = (definition: TrainerSubchoiceDefinition) => (value: EditableCellValue): string =>
  trainerSubchoiceDisplayValue(definition, value)
</script>

<template>
  <div v-if="definitions.length" class="trainer-subchoice-stack">
    <label
      v-for="definition in definitions"
      :key="definition.key"
      class="trainer-subchoice-control"
    >
      <span class="trainer-subchoice-label">{{ definition.label }}</span>
      <EditableCell
        :model-value="selectionValue(definition)"
        type="select"
        :options="definition.options"
        :placeholder="definition.placeholder ?? definition.label"
        :format="formatSelection(definition)"
        @update:model-value="(value) => setSelectionValue(definition, value)"
      />
    </label>
  </div>
</template>

<style scoped>
.trainer-subchoice-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
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
</style>
