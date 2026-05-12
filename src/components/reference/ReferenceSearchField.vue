<script setup lang="ts">
import { trimmedTextValueFromEvent } from '~/utils/domEvents'

defineProps<{
  modelValue: string
  label: string
  placeholder: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const updateValue = (event: Event) => {
  emit('update:modelValue', trimmedTextValueFromEvent(event))
}
</script>

<template>
  <label class="search-field">
    <span class="sr-only">{{ label }}</span>
    <input
      :value="modelValue"
      type="search"
      :placeholder="placeholder"
      @input="updateValue"
    />
  </label>
</template>
