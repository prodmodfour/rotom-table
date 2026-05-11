<script setup lang="ts">
import {
  allTogetherFilterField,
  filterFieldConfigs,
  type FieldFilterKey,
  type FilterMode,
  type FilterOperator,
  type PokedexSearchTextKey,
} from '~/utils/pokedex/searchText'

const filterMode = defineModel<FilterMode>('filterMode', { required: true })

defineProps<{
  filterOperators: Record<FieldFilterKey, FilterOperator>
  searchFilters: Record<PokedexSearchTextKey, string>
}>()
</script>

<template>
  <div class="filter-panel">
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

    <div v-if="filterMode === 'advanced'" class="filter-fields" aria-label="All together filter">
      <label class="filter-field">
        <span class="filter-field__label">{{ allTogetherFilterField.label }}</span>
        <input
          v-model.trim="searchFilters.any"
          type="search"
          :placeholder="allTogetherFilterField.placeholder"
        />
      </label>
    </div>

    <div v-else class="filter-fields" aria-label="Pokédex field filters">
      <template v-for="(field, index) in filterFieldConfigs" :key="field.key">
        <div v-if="index > 0" class="filter-operator">
          <span class="filter-operator__rule" />
          <select
            v-model="filterOperators[field.key]"
            class="filter-operator__select"
            :aria-label="`Combine ${field.label} filter with previous filled filter`"
          >
            <option value="and">and</option>
            <option value="or">or</option>
          </select>
          <span class="filter-operator__rule" />
        </div>
        <label class="filter-field">
          <span class="filter-field__label">{{ field.label }}</span>
          <input
            v-model.trim="searchFilters[field.key]"
            type="search"
            :placeholder="field.placeholder"
          />
        </label>
      </template>
    </div>

    <p class="filter-help">
      Use <code>and</code>, <code>or</code>, parentheses, and <code>-term</code> exclusions inside any filter. Numeric/dice terms are minimums (for example, <code>sky 5</code> matches Sky 5+ and <code>3d6</code> matches 3d6+). Field filters combine using the toggles.
    </p>
  </div>
</template>

<style scoped>
.filter-panel {
  min-height: 0;
  overflow: auto;
  padding-right: 0.25rem;
}

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

.filter-fields {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 0.7rem;
}

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

.filter-help {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.75rem;
  line-height: 1.45;
}

input,
select {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.6rem 0.75rem;
  outline: none;
}

input:focus,
select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.filter-operator__select {
  width: auto;
  min-width: 4.8rem;
  padding: 0.25rem 0.45rem;
  border-radius: 999px;
  font-size: 0.72rem;
  text-transform: uppercase;
}

code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--accent);
}

@media (max-width: 760px) {
  .filter-panel {
    overflow: visible;
  }
}
</style>
