<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: number | undefined
  pointsLeft: number
  label: string
  min?: number
  max?: number
  constraintLabel?: string
}>(), {
  min: undefined,
  max: undefined,
  constraintLabel: 'allocation rules',
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const normalizePointValue = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

const normalizeOptionalPointValue = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.trunc(value))
}

const currentValue = computed(() => normalizePointValue(props.modelValue))
const ruleMin = computed(() => normalizeOptionalPointValue(props.min) ?? 0)
const ruleMax = computed(() => normalizeOptionalPointValue(props.max))
const budgetMax = computed(() => currentValue.value + normalizePointValue(props.pointsLeft))
const sliderMin = computed(() => Math.min(currentValue.value, ruleMin.value))
const sliderMax = computed(() => {
  const constrainedMax = ruleMax.value == null
    ? budgetMax.value
    : Math.min(budgetMax.value, ruleMax.value)
  return Math.max(currentValue.value, constrainedMax, sliderMin.value)
})
const sliderDisabled = computed(() => sliderMax.value <= sliderMin.value)
const sliderLabel = computed(() => `${props.label} allocation`)
const ariaValueText = computed(() => (
  `${currentValue.value} points for ${props.label}; allowed range ${sliderMin.value} to ${sliderMax.value}`
))
const constraintSummary = computed(() => {
  const clauses: string[] = []
  if (ruleMin.value > 0) clauses.push(`minimum ${ruleMin.value}`)
  if (ruleMax.value != null) clauses.push(`maximum ${ruleMax.value}`)
  return clauses.length ? ` ${props.constraintLabel} sets ${clauses.join(' and ')}.` : ''
})
const titleText = computed(() => (
  `${props.label}: ${currentValue.value} allocated. Drag to assign available points; `
  + `reduce another stat first to raise this beyond ${sliderMax.value}.${constraintSummary.value}`
))

const clampToSliderRange = (value: number): number => Math.min(Math.max(value, sliderMin.value), sliderMax.value)

const commitValue = (value: unknown) => {
  const nextValue = clampToSliderRange(normalizePointValue(value))
  emit('update:modelValue', nextValue)
}

const updateFromRange = (event: Event) => {
  const input = event.target instanceof HTMLInputElement ? event.target : null
  commitValue(input?.valueAsNumber)
}
</script>

<template>
  <div class="stat-allocation-slider" :title="titleText">
    <div class="stat-allocation-slider__summary">
      <EditableCell
        :model-value="currentValue"
        type="number"
        :min="sliderMin"
        :max="sliderMax"
        @update:model-value="commitValue"
      />
      <span class="stat-allocation-slider__max" aria-hidden="true">/ {{ sliderMax }}</span>
    </div>
    <label class="stat-allocation-slider__control">
      <span class="sr-only">{{ sliderLabel }}</span>
      <input
        type="range"
        :min="sliderMin"
        :max="sliderMax"
        step="1"
        :value="currentValue"
        :aria-label="sliderLabel"
        :aria-valuetext="ariaValueText"
        :disabled="sliderDisabled"
        @input="updateFromRange"
      >
    </label>
  </div>
</template>

<style scoped>
.stat-allocation-slider {
  display: grid;
  gap: 0.18rem;
  min-width: 7rem;
}

.stat-allocation-slider__summary {
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 0.18rem;
  font-variant-numeric: tabular-nums;
}

.stat-allocation-slider__max {
  color: var(--ink-muted);
  font-size: 0.68rem;
  white-space: nowrap;
}

.stat-allocation-slider__control {
  display: block;
  line-height: 1;
}

.stat-allocation-slider__control input {
  display: block;
  width: 100%;
  margin: 0;
  accent-color: var(--accent);
}

.stat-allocation-slider__control input:disabled {
  opacity: 0.48;
}
</style>
