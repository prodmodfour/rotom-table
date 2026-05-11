<script setup lang="ts">
const value = defineModel<string>({ required: true })

defineProps<{
  label: string
  placeholder: string
}>()
</script>

<template>
  <label class="filter-field">
    <span class="filter-field__label">{{ label }}</span>
    <input
      v-model.trim="value"
      type="search"
      :placeholder="placeholder"
    />
  </label>
</template>

<style scoped>
.filter-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.filter-field__label {
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.75rem;
  outline: none;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}
</style>
