<script setup lang="ts">
import { computed } from 'vue'
import pokedexData from '~/ptu-data/data/pokedex.json'
import { pokemonCatalogBySpecies } from '~/data/pokemonCatalog'
import { usePokedexFilters } from '~/composables/pokedex/usePokedexFilters'
import { toPokedexSlug } from '~/utils/pokedex/searchText'
import {
  capabilityTokensForEntry,
  dietSummaryForEntry,
  eggGroupSummaryForEntry,
  eggMoveTokensForEntry,
  genderSummaryForEntry,
  habitatSummaryForEntry,
  heightLabelForEntry,
  isPlacementOnlyEntry,
  pageNumberForSelectedEntry,
  skillPhraseForEntry,
  tmHmTokensForEntry,
  tutorMoveTokensForEntry,
  weightLabelForEntry,
} from '~/utils/pokedex/entryDetails'
import {
  buildPokedexEntries,
  buildPokedexEntryBySlug,
  pokedexEntryPath,
  routeParamToPokedexSlug,
  type DisplayPokedexEntry,
} from '~/utils/pokedex/entryIndex'
import { buildTypeMatchupGroups } from '~/utils/pokedex/typeMatchups'
import type { PokedexRecord } from '~/types/pokemon'

definePageMeta({
  // Keep the browser mounted between /pokedex and /pokedex/:pokemon_name so
  // selecting a Pokémon updates the detail pane in-place instead of feeling
  // like a whole new page load.
  key: 'pokedex-browser',
  scrollToTop: (to, from) => !(to.path.startsWith('/pokedex') && from.path.startsWith('/pokedex')),
})

const route = useRoute()

const allEntries = buildPokedexEntries(pokedexData as PokedexRecord[])
const entryBySlug = buildPokedexEntryBySlug(allEntries)
const pokemonRouteSlug = computed(() => routeParamToPokedexSlug(route.params.pokemon_name))

const { filteredEntries, filterMode, filterOperators, searchFilters } = usePokedexFilters(allEntries)

const routedEntry = computed(() => (
  pokemonRouteSlug.value ? entryBySlug.get(pokemonRouteSlug.value) ?? null : null
))

const selectedEntry = computed(() => {
  if (pokemonRouteSlug.value) {
    return routedEntry.value
  }

  return filteredEntries.value[0] ?? null
})

const selectedId = computed(() => selectedEntry.value?.id ?? null)

const resolvePokedexSpecies = (species: string): DisplayPokedexEntry | null => (
  entryBySlug.get(toPokedexSlug(species)) ?? null
)

const displayedEvolutions = computed(() => (
  (selectedEntry.value?.evolutions ?? []).map((evolution) => {
    const entry = resolvePokedexSpecies(evolution.species)
    return {
      ...evolution,
      href: entry && entry.id !== selectedId.value ? pokedexEntryPath(entry) : null,
    }
  })
))

const requestedPokemonName = computed(() => {
  if (!pokemonRouteSlug.value || selectedEntry.value) return null
  const raw = route.params.pokemon_name
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : pokemonRouteSlug.value
})

useHead(() => ({
  title: pokemonRouteSlug.value
    ? selectedEntry.value
      ? `${selectedEntry.value.species} · Pokédex · Rotom Table`
      : 'Pokémon not found · Pokédex · Rotom Table'
    : 'Pokédex · Rotom Table',
}))

const selectedSprite = computed(() => {
  if (!selectedEntry.value) {
    return null
  }

  return pokemonCatalogBySpecies.get(selectedEntry.value.species) ?? null
})

const isPlacementOnly = computed(() => isPlacementOnlyEntry(selectedEntry.value))
const genderSummary = computed(() => genderSummaryForEntry(selectedEntry.value))
const pageNumber = computed(() => pageNumberForSelectedEntry(selectedId.value, filteredEntries.value, allEntries))
const capabilityTokens = computed(() => capabilityTokensForEntry(selectedEntry.value))
const tmHmTokens = computed(() => tmHmTokensForEntry(selectedEntry.value))
const eggMoveTokens = computed(() => eggMoveTokensForEntry(selectedEntry.value))
const tutorMoveTokens = computed(() => tutorMoveTokensForEntry(selectedEntry.value))
const skillPhrase = computed(() => skillPhraseForEntry(selectedEntry.value))
const heightLabel = computed(() => heightLabelForEntry(selectedEntry.value))
const weightLabel = computed(() => weightLabelForEntry(selectedEntry.value))
const eggGroupSummary = computed(() => eggGroupSummaryForEntry(selectedEntry.value))
const dietSummary = computed(() => dietSummaryForEntry(selectedEntry.value))
const habitatSummary = computed(() => habitatSummaryForEntry(selectedEntry.value))

const typeMatchupGroups = computed(() => buildTypeMatchupGroups(selectedEntry.value?.types))

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
