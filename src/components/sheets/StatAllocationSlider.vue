<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: number | undefined
  pointsLeft: number
  label: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const normalizePointValue = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

const currentValue = computed(() => normalizePointValue(props.modelValue))
const sliderMax = computed(() => Math.max(
  currentValue.value,
  currentValue.value + normalizePointValue(props.pointsLeft),
  0,
))
const sliderDisabled = computed(() => sliderMax.value <= 0)
const sliderLabel = computed(() => `${props.label} allocation`)
const ariaValueText = computed(() => `${currentValue.value} of ${sliderMax.value} points currently available for ${props.label}`)
const titleText = computed(() => `${props.label}: ${currentValue.value} allocated. Drag to assign available points; reduce another stat first to raise this beyond ${sliderMax.value}.`)

const commitValue = (value: unknown) => {
  const nextValue = Math.min(normalizePointValue(value), sliderMax.value)
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
        :min="0"
        :max="sliderMax"
        @update:model-value="commitValue"
      />
      <span class="stat-allocation-slider__max" aria-hidden="true">/ {{ sliderMax }}</span>
    </div>
    <label class="stat-allocation-slider__control">
      <span class="sr-only">{{ sliderLabel }}</span>
      <input
        type="range"
        min="0"
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
