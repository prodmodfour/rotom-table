<script setup lang="ts">
import { computed } from 'vue'

export interface ReferenceSelectOption {
  value: string | null
  label: string
}

const props = defineProps<{
  modelValue: string | null
  label: string
  options: ReferenceSelectOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const selectedValue = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})
</script>

<template>
  <label class="select-field">
    <span>{{ label }}</span>
    <select v-model="selectedValue">
      <option
        v-for="option in options"
        :key="option.value ?? '__all__'"
        :value="option.value"
      >
        {{ option.label }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.select-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.select-field span {
  color: var(--ink-muted);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.select-field select {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.7rem 0.85rem;
  outline: none;
}

.select-field select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}
</style>
