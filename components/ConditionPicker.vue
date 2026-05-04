<script setup lang="ts">
import { computed } from 'vue'
import {
  conditionGroups,
  conditionTitle,
  normalizeConditionNames,
  type ConditionTagSize,
} from '~/utils/statusConditions'

const props = withDefaults(defineProps<{
  modelValue?: string[]
  disabled?: boolean
  compact?: boolean
  tagSize?: ConditionTagSize
}>(), {
  modelValue: () => [],
  disabled: false,
  compact: false,
  tagSize: 'sm',
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: string[]): void
}>()

const selected = computed(() => normalizeConditionNames(props.modelValue))
const selectedSet = computed(() => new Set(selected.value))

const update = (value: string[]) => {
  if (props.disabled) return
  emit('update:modelValue', normalizeConditionNames(value))
}

const toggle = (name: string) => {
  const next = selected.value.filter((condition) => condition !== name)
  if (!selectedSet.value.has(name)) next.push(name)
  update(next)
}

const clear = () => update([])
</script>

<template>
  <div class="condition-picker" :class="{ 'condition-picker--compact': compact }">
    <div v-if="selected.length" class="condition-picker__active" aria-label="Applied conditions">
      <button
        v-for="name in selected"
        :key="name"
        type="button"
        class="condition-picker__active-tag"
        :title="`Remove ${name}`"
        :disabled="disabled"
        @click="toggle(name)"
      >
        <ConditionTag :name="name" :size="tagSize" />
        <span aria-hidden="true" class="condition-picker__remove">×</span>
        <span class="sr-only">Remove {{ name }}</span>
      </button>
      <button
        type="button"
        class="condition-picker__clear"
        :disabled="disabled"
        @click="clear"
      >
        Clear all
      </button>
    </div>

    <p v-else class="condition-picker__empty">No conditions applied.</p>

    <div class="condition-picker__groups">
      <section
        v-for="group in conditionGroups"
        :key="group.category"
        class="condition-picker__group"
      >
        <h4>{{ group.label }}</h4>
        <div class="condition-picker__options">
          <button
            v-for="condition in group.conditions"
            :key="condition.name"
            type="button"
            class="condition-picker__option"
            :class="{ 'is-selected': selectedSet.has(condition.name) }"
            :aria-pressed="selectedSet.has(condition.name)"
            :title="conditionTitle(condition.name)"
            :disabled="disabled"
            @click="toggle(condition.name)"
          >
            <ConditionTag :name="condition.name" :size="tagSize" />
            <span v-if="!compact" class="condition-picker__option-name">{{ condition.name }}</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.condition-picker {
  display: grid;
  gap: 0.75rem;
}

.condition-picker__active {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}

.condition-picker__active-tag,
.condition-picker__clear,
.condition-picker__option {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: rgba(60, 56, 54, 0.36);
  color: var(--ink);
  font-family: var(--font-ui);
  cursor: pointer;
  transition: border-color 0.14s ease, background 0.14s ease, transform 0.14s ease;
}

.condition-picker__active-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.18rem 0.42rem 0.18rem 0.2rem;
}

.condition-picker__active-tag:hover:not(:disabled),
.condition-picker__option:hover:not(:disabled),
.condition-picker__clear:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
  transform: translateY(-1px);
}

.condition-picker__remove {
  color: var(--ink-soft);
  font-weight: 900;
  line-height: 1;
}

.condition-picker__clear {
  padding: 0.34rem 0.65rem;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.condition-picker__empty {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.9rem;
}

.condition-picker__groups {
  display: grid;
  gap: 0.65rem;
}

.condition-picker__group {
  display: grid;
  gap: 0.4rem;
}

.condition-picker__group h4 {
  margin: 0;
  color: var(--ink-soft);
  font-family: var(--font-ui);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.condition-picker__options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.condition-picker__option {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  padding: 0.22rem 0.48rem 0.22rem 0.22rem;
}

.condition-picker__option.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--ink-bright);
}

.condition-picker__option-name {
  font-size: 0.78rem;
  font-weight: 800;
  white-space: nowrap;
}

.condition-picker--compact {
  gap: 0.55rem;
}

.condition-picker--compact .condition-picker__groups {
  gap: 0.5rem;
}

.condition-picker--compact .condition-picker__option {
  padding: 0.18rem;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
