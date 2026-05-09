<script setup lang="ts">
defineProps<{
  modelValue: string
  label: string
  placeholder: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const updateValue = (event: Event) => {
  const input = event.target as HTMLInputElement | null
  emit('update:modelValue', input?.value.trim() ?? '')
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
