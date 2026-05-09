<script setup lang="ts">
import pokedexData from '~/ptu-data/data/pokedex.json'
import { usePokedexBrowser } from '~/composables/pokedex/usePokedexBrowser'
import type { PokedexRecord } from '~/types/pokemon'

definePageMeta({
  // Keep the browser mounted between /pokedex and /pokedex/:pokemon_name so
  // selecting a Pokémon updates the detail pane in-place instead of feeling
  // like a whole new page load.
  key: 'pokedex-browser',
  scrollToTop: (to, from) => !(to.path.startsWith('/pokedex') && from.path.startsWith('/pokedex')),
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
  pageNumber,
  pageTitle,
  requestedPokemonName,
  searchFilters,
  selectedEntry,
  selectedId,
  selectedSprite,
  skillPhrase,
  tmHmTokens,
  tutorMoveTokens,
  typeMatchupGroups,
  weightLabel,
} = usePokedexBrowser(pokedexData as PokedexRecord[])

useHead(() => ({ title: pageTitle.value }))
</script>

<template>
  <div class="pokedex-layout">
    <PokedexSidebar
      v-model:filter-mode="filterMode"
      :entries="filteredEntries"
      :filter-operators="filterOperators"
      :search-filters="searchFilters"
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
      :sprite-url="selectedSprite?.spriteUrl ?? null"
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
