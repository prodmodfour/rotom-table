<script setup lang="ts">
import {
  allTogetherFilterField,
  filterFieldConfigs,
  type FieldFilterKey,
  type FilterMode,
  type FilterOperator,
  type PokedexSearchTextKey,
} from '~/utils/pokedex/searchText'

defineProps<{
  filterMode: FilterMode
  filterOperators: Record<FieldFilterKey, FilterOperator>
  searchFilters: Record<PokedexSearchTextKey, string>
}>()
</script>

<template>
  <div v-if="filterMode === 'advanced'" class="filter-fields" aria-label="All together filter">
    <PokedexSearchFilterInput
      v-model="searchFilters.any"
      :label="allTogetherFilterField.label"
      :placeholder="allTogetherFilterField.placeholder"
    />
  </div>

  <div v-else class="filter-fields" aria-label="Pokédex field filters">
    <template v-for="(field, index) in filterFieldConfigs" :key="field.key">
      <PokedexFilterOperatorSelect
        v-if="index > 0"
        v-model="filterOperators[field.key]"
        :select-label="`Combine ${field.label} filter with previous filled filter`"
      />
      <PokedexSearchFilterInput
        v-model="searchFilters[field.key]"
        :label="field.label"
        :placeholder="field.placeholder"
      />
    </template>
  </div>
</template>

<style scoped>
.filter-fields {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 0.7rem;
}
</style>
