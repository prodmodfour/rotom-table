import { computed } from 'vue'
import { usePokedexFilters } from '~/composables/pokedex/usePokedexFilters'
import { POKEDEX_API_PATHS } from '~/utils/apiRoutes'
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
  buildPokedexEntryBySlug,
  buildSearchablePokedexEntries,
  pokedexEntryPath,
  routeParamToPokedexSlug,
  type DisplayPokedexEntry,
  type IndexedPokedexEntry,
  type PokedexEntryDetail,
  type PokedexEntrySummary,
} from '~/utils/pokedex/entryIndex'
import { toPokedexSlug } from '~/utils/pokedex/searchText'
import { buildTypeMatchupGroups } from '~/utils/pokedex/typeMatchups'

export const selectPokedexEntry = <TEntry extends PokedexEntrySummary>(
  routeSlug: string | null,
  filteredEntries: readonly TEntry[],
  entryBySlug: ReadonlyMap<string, TEntry>,
): TEntry | null => {
  if (routeSlug) {
    return entryBySlug.get(routeSlug) ?? null
  }

  return filteredEntries[0] ?? null
}

export const requestedPokemonNameForRoute = (
  routeSlug: string | null,
  selectedEntry: Pick<IndexedPokedexEntry, 'species'> | null,
  rawParam: unknown,
): string | null => {
  if (!routeSlug || selectedEntry) return null

  const value = Array.isArray(rawParam) ? rawParam[0] : rawParam
  return typeof value === 'string' ? value : routeSlug
}

export const buildDisplayedPokedexEvolutions = (
  selectedEntry: Pick<IndexedPokedexEntry, 'evolutions'> | null,
  selectedId: string | null,
  entryBySlug: ReadonlyMap<string, Pick<IndexedPokedexEntry, 'id' | 'slug'>>,
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
  selectedEntry: Pick<IndexedPokedexEntry, 'species'> | null,
): string => {
  if (!routeSlug) return 'Pokédex · Rotom Table'
  return selectedEntry
    ? `${selectedEntry.species} · Pokédex · Rotom Table`
    : 'Pokémon not found · Pokédex · Rotom Table'
}

export const selectRandomPokedexEntry = <TEntry extends PokedexEntrySummary>(
  entries: readonly TEntry[],
  selectedId: string | null,
  random: () => number = Math.random,
): TEntry | null => {
  const candidates = selectedId && entries.length > 1
    ? entries.filter((entry) => entry.id !== selectedId)
    : entries

  if (candidates.length === 0) return null

  const randomIndex = Math.floor(random() * candidates.length)
  const boundedIndex = Number.isFinite(randomIndex)
    ? Math.min(candidates.length - 1, Math.max(0, randomIndex))
    : 0

  return candidates[boundedIndex] ?? null
}

export const randomPokedexEntryPath = <TEntry extends PokedexEntrySummary>(
  entries: readonly TEntry[],
  selectedId: string | null,
  random: () => number = Math.random,
): string | null => {
  const entry = selectRandomPokedexEntry(entries, selectedId, random)
  return entry ? pokedexEntryPath(entry) : null
}

export const usePokedexBrowser = () => {
  const route = useRoute()
  const router = useRouter()
  const pokemonRouteSlug = computed(() => routeParamToPokedexSlug(route.params.pokemon_name))

  const summariesRequest = useFetch<PokedexEntrySummary[]>(POKEDEX_API_PATHS.index, {
    key: 'pokedex-entry-summaries',
    default: () => [],
  })
  const allEntries = computed(() => summariesRequest.data.value ?? [])
  const entryBySlug = computed(() => buildPokedexEntryBySlug(allEntries.value))

  const loadSearchEntries = async (): Promise<DisplayPokedexEntry[]> => {
    const entries = await $fetch<IndexedPokedexEntry[]>(POKEDEX_API_PATHS.searchIndex)
    return buildSearchablePokedexEntries(entries)
  }

  const {
    filteredEntries,
    filterMode,
    filterOperators,
    isSearchIndexLoading,
    searchFilters,
    searchIndexError,
  } = usePokedexFilters(allEntries, { loadSearchEntries })

  const selectedSummary = computed(() => selectPokedexEntry(
    pokemonRouteSlug.value,
    filteredEntries.value,
    entryBySlug.value,
  ))
  const selectedDetailSlug = computed(() => pokemonRouteSlug.value ?? selectedSummary.value?.slug ?? null)
  const detailQuery = computed(() => (
    selectedDetailSlug.value ? { slug: selectedDetailSlug.value } : {}
  ))
  const detailRequest = useFetch<PokedexEntryDetail | null>(POKEDEX_API_PATHS.detail, {
    key: 'pokedex-entry-detail',
    query: detailQuery,
    watch: [selectedDetailSlug],
    default: () => null,
  })

  const selectedEntry = computed(() => detailRequest.data.value)
  const selectedId = computed(() => selectedSummary.value?.id ?? selectedEntry.value?.id ?? null)
  const selectedTitleEntry = computed(() => (
    pokemonRouteSlug.value ? selectedSummary.value : (selectedSummary.value ?? selectedEntry.value)
  ))
  const displayedEvolutions = computed(() => buildDisplayedPokedexEvolutions(
    selectedEntry.value,
    selectedId.value,
    entryBySlug.value,
  ))
  const requestedPokemonName = computed(() => requestedPokemonNameForRoute(
    pokemonRouteSlug.value,
    selectedTitleEntry.value,
    route.params.pokemon_name,
  ))
  const pageTitle = computed(() => pokedexPageTitle(pokemonRouteSlug.value, selectedTitleEntry.value))
  const selectedSpriteUrl = computed(() => selectedEntry.value?.spriteUrl ?? null)
  const searchIndexErrorMessage = computed(() => (
    searchIndexError.value ? 'Unable to load the Pokédex search index.' : null
  ))

  const isPlacementOnly = computed(() => isPlacementOnlyEntry(selectedEntry.value))
  const genderSummary = computed(() => genderSummaryForEntry(selectedEntry.value))
  const pageNumber = computed(() => pageNumberForSelectedEntry(selectedId.value, filteredEntries.value, allEntries.value))
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
  const typeMatchupGroups = computed(() => buildTypeMatchupGroups(
    selectedEntry.value?.types,
    selectedEntry.value?.capabilities,
  ))
  const ready = Promise.all([summariesRequest, detailRequest])

  const goToRandomPokemon = (): boolean => {
    const path = randomPokedexEntryPath(filteredEntries.value, selectedId.value)
    if (!path) return false

    void router.push(path)
    return true
  }

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
    isSearchIndexLoading,
    pageNumber,
    pageTitle,
    ready,
    goToRandomPokemon,
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
  }
}
