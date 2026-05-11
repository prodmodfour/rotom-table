<script setup lang="ts">
import { type FilterMode } from '~/utils/pokedex/searchText'

const filterMode = defineModel<FilterMode>({ required: true })
</script>

<template>
  <div class="filter-mode" role="group" aria-label="Filter mode">
    <button
      type="button"
      :class="['filter-mode__button', { active: filterMode === 'fields' }]"
      @click="filterMode = 'fields'"
    >
      Field filters
    </button>
    <button
      type="button"
      :class="['filter-mode__button', { active: filterMode === 'advanced' }]"
      @click="filterMode = 'advanced'"
    >
      All together
    </button>
  </div>
</template>

<style scoped>
.filter-mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
  margin-bottom: 0.65rem;
}

.filter-mode__button {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-muted);
  padding: 0.45rem 0.6rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
}

.filter-mode__button:hover,
.filter-mode__button.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
</style>
