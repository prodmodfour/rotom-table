import { computed } from 'vue'
import { pokemonCatalogBySpecies } from '~/data/pokemonCatalog'
import { usePokedexFilters } from '~/composables/pokedex/usePokedexFilters'
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
  type DisplayedPokedexEvolution,
} from '~/utils/pokedex/entryDetails'
import {
  buildPokedexEntries,
  buildPokedexEntryBySlug,
  pokedexEntryPath,
  routeParamToPokedexSlug,
  type DisplayPokedexEntry,
} from '~/utils/pokedex/entryIndex'
import { toPokedexSlug } from '~/utils/pokedex/searchText'
import { buildTypeMatchupGroups } from '~/utils/pokedex/typeMatchups'
import type { PokedexRecord } from '~/types/pokemon'

export const selectPokedexEntry = (
  routeSlug: string | null,
  filteredEntries: readonly DisplayPokedexEntry[],
  entryBySlug: ReadonlyMap<string, DisplayPokedexEntry>,
): DisplayPokedexEntry | null => {
  if (routeSlug) {
    return entryBySlug.get(routeSlug) ?? null
  }

  return filteredEntries[0] ?? null
}

export const requestedPokemonNameForRoute = (
  routeSlug: string | null,
  selectedEntry: DisplayPokedexEntry | null,
  rawParam: unknown,
): string | null => {
  if (!routeSlug || selectedEntry) return null

  const value = Array.isArray(rawParam) ? rawParam[0] : rawParam
  return typeof value === 'string' ? value : routeSlug
}

export const buildDisplayedPokedexEvolutions = (
  selectedEntry: DisplayPokedexEntry | null,
  selectedId: string | null,
  entryBySlug: ReadonlyMap<string, DisplayPokedexEntry>,
): DisplayedPokedexEvolution[] => (
  (selectedEntry?.evolutions ?? []).map((evolution) => {
    const entry = entryBySlug.get(toPokedexSlug(evolution.species)) ?? null
    return {
      ...evolution,
      href: entry && entry.id !== selectedId ? pokedexEntryPath(entry) : null,
    }
  })
)

export const pokedexPageTitle = (
  routeSlug: string | null,
  selectedEntry: DisplayPokedexEntry | null,
): string => {
  if (!routeSlug) return 'Pokédex · Rotom Table'
  return selectedEntry
    ? `${selectedEntry.species} · Pokédex · Rotom Table`
    : 'Pokémon not found · Pokédex · Rotom Table'
}

export const usePokedexBrowser = (records: PokedexRecord[]) => {
  const route = useRoute()
  const allEntries = buildPokedexEntries(records)
  const entryBySlug = buildPokedexEntryBySlug(allEntries)
  const pokemonRouteSlug = computed(() => routeParamToPokedexSlug(route.params.pokemon_name))

  const { filteredEntries, filterMode, filterOperators, searchFilters } = usePokedexFilters(allEntries)

  const selectedEntry = computed(() => selectPokedexEntry(
    pokemonRouteSlug.value,
    filteredEntries.value,
    entryBySlug,
  ))
  const selectedId = computed(() => selectedEntry.value?.id ?? null)
  const displayedEvolutions = computed(() => buildDisplayedPokedexEvolutions(
    selectedEntry.value,
    selectedId.value,
    entryBySlug,
  ))
  const requestedPokemonName = computed(() => requestedPokemonNameForRoute(
    pokemonRouteSlug.value,
    selectedEntry.value,
    route.params.pokemon_name,
  ))
  const pageTitle = computed(() => pokedexPageTitle(pokemonRouteSlug.value, selectedEntry.value))

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

  return {
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
  }
}
