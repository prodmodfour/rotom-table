<script setup lang="ts">
import {
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
    <PokedexFilterModeToggle v-model="filterMode" />

    <PokedexSearchFilterFields
      :filter-mode="filterMode"
      :filter-operators="filterOperators"
      :search-filters="searchFilters"
    />

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

.filter-help {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.75rem;
  line-height: 1.45;
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
