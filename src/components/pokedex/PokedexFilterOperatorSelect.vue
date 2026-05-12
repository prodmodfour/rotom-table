<script setup lang="ts">
import type { FilterOperator } from '~/utils/pokedex/searchText'

const operator = defineModel<FilterOperator>({ required: true })

defineProps<{
  selectLabel: string
}>()
</script>

<template>
  <div class="filter-operator">
    <span class="filter-operator__rule" />
    <select
      v-model="operator"
      class="filter-operator__select"
      :aria-label="selectLabel"
    >
      <option value="and">and</option>
      <option value="or">or</option>
    </select>
    <span class="filter-operator__rule" />
  </div>
</template>

<style scoped>
.filter-operator {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.45rem;
  margin: -0.1rem 0;
}

.filter-operator__rule {
  height: 1px;
  background: var(--rule-soft);
}

.filter-operator__select {
  width: auto;
  min-width: 4.8rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.25rem 0.45rem;
  outline: none;
  font-size: 0.72rem;
  text-transform: uppercase;
}

.filter-operator__select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}
</style>
