<script setup lang="ts">
import { formatSheetMovementCapabilityValue } from '~/utils/sheets/movementCapabilityAdjustments'
import type { EditableCellValue } from '~/utils/editableCell'

const props = defineProps<{
  modelValue?: number | string | null
  name: string
  conditions?: readonly string[] | null
  trainingFeature?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: EditableCellValue]
}>()

const movementCapabilityValue = (value: EditableCellValue): number | string | null | undefined => (
  typeof value === 'boolean' ? undefined : value
)

const formatAdjustedValue = (value: EditableCellValue): string => formatSheetMovementCapabilityValue(
  props.name,
  movementCapabilityValue(value),
  props.conditions,
  props.trainingFeature,
)
</script>

<template>
  <EditableCell
    :model-value="modelValue"
    type="number"
    :min="0"
    :format="formatAdjustedValue"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
