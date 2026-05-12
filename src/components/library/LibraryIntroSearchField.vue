<script setup lang="ts">
import { trimmedTextValueFromEvent } from '~/utils/domEvents'

withDefaults(defineProps<{
  modelValue: string
  label: string
  placeholder: string
}>(), {
  modelValue: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <label class="library-search-field">
    <span class="sr-only">{{ label }}</span>
    <input
      class="library-search-field__input"
      :value="modelValue"
      type="search"
      :placeholder="placeholder"
      @input="emit('update:modelValue', trimmedTextValueFromEvent($event))"
    />
  </label>
</template>

<style scoped>
.library-search-field {
  flex: 1 1 240px;
  display: block;
}

.library-search-field__input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.65rem 0.8rem;
  outline: none;
}

.library-search-field__input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
