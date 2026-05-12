<script setup lang="ts">
import { usePokedexBrowser } from '~/composables/pokedex/usePokedexBrowser'
import { isPokedexPath } from '~/utils/pokedex/routes'

definePageMeta({
  // Keep the browser mounted between /pokedex and /pokedex/:pokemon_name so
  // selecting a Pokémon updates the detail pane in-place instead of feeling
  // like a whole new page load.
  key: 'pokedex-browser',
  scrollToTop: (to, from) => !(isPokedexPath(to.path) && isPokedexPath(from.path)),
})

const {
  capabilityTokens,
  dietSummary,
  displayedEvolutions,
  eggGroupSummary,
  eggMoveTokens,
  filterMode,
  filterOperators,
  filteredEntries,
  genderSummary,
  habitatSummary,
  heightLabel,
  isPlacementOnly,
  isSearchIndexLoading,
  pageNumber,
  pageTitle,
  ready,
  requestedPokemonName,
  searchFilters,
  searchIndexErrorMessage,
  selectedEntry,
  selectedId,
  selectedSpriteUrl,
  skillPhrase,
  tmHmTokens,
  tutorMoveTokens,
  typeMatchupGroups,
  weightLabel,
} = usePokedexBrowser()

useHead(() => ({ title: pageTitle.value }))

await ready
</script>

<template>
  <div class="pokedex-layout">
    <PokedexSidebar
      v-model:filter-mode="filterMode"
      :entries="filteredEntries"
      :filter-operators="filterOperators"
      :is-search-index-loading="isSearchIndexLoading"
      :search-filters="searchFilters"
      :search-index-error-message="searchIndexErrorMessage"
      :selected-id="selectedId"
    />

    <PokedexEntryDetail
      :capability-tokens="capabilityTokens"
      :diet-summary="dietSummary"
      :displayed-evolutions="displayedEvolutions"
      :egg-group-summary="eggGroupSummary"
      :egg-move-tokens="eggMoveTokens"
      :entry="selectedEntry"
      :gender-summary="genderSummary"
      :habitat-summary="habitatSummary"
      :height-label="heightLabel"
      :is-placement-only="isPlacementOnly"
      :page-number="pageNumber"
      :requested-pokemon-name="requestedPokemonName"
      :skill-phrase="skillPhrase"
      :sprite-url="selectedSpriteUrl"
      :tm-hm-tokens="tmHmTokens"
      :tutor-move-tokens="tutorMoveTokens"
      :type-matchup-groups="typeMatchupGroups"
      :weight-label="weightLabel"
    />
  </div>
</template>

<style scoped>
.pokedex-layout {
  display: grid;
  grid-template-columns: minmax(560px, 700px) minmax(0, 1fr);
  min-height: 100vh;
  background: var(--paper);
}

@media (max-width: 1040px) {
  .pokedex-layout {
    grid-template-columns: 1fr;
  }
}
</style>
