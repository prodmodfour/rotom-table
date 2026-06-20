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

const normalizeEvolutionCondition = (value: string | null | undefined): string | null => {
  const normalized = value
    ?.replace(/^[\s,.;:–—-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized || null
}

const conditionFromResolvedEvolutionSpecies = (
  evolutionSpecies: string,
  resolvedSpecies: string,
): string | null => {
  const rawSpecies = evolutionSpecies.trim()
  const displaySpecies = resolvedSpecies.trim()
  if (!rawSpecies || !displaySpecies) return null

  if (!rawSpecies.toLowerCase().startsWith(displaySpecies.toLowerCase())) return null

  return normalizeEvolutionCondition(rawSpecies.slice(displaySpecies.length))
}

const mergeEvolutionConditions = (
  ...conditions: Array<string | null | undefined>
): string | null => {
  const merged: string[] = []

  for (const condition of conditions) {
    const normalized = normalizeEvolutionCondition(condition)
    if (normalized && !merged.includes(normalized)) merged.push(normalized)
  }

  return merged.length ? merged.join(' ') : null
}

export const buildPokedexEvolutionDisplay = (
  evolution: Pick<DisplayedPokedexEvolution, 'species' | 'condition'>,
  resolvedEntry: Pick<IndexedPokedexEntry, 'species'> | null,
): Pick<DisplayedPokedexEvolution, 'displaySpecies' | 'displayCondition'> => {
  const displaySpecies = resolvedEntry?.species ?? evolution.species
  const inlineCondition = resolvedEntry
    ? conditionFromResolvedEvolutionSpecies(evolution.species, resolvedEntry.species)
    : null

  return {
    displaySpecies,
    displayCondition: mergeEvolutionConditions(inlineCondition, evolution.condition),
  }
}

export const buildDisplayedPokedexEvolutions = (
  selectedEntry: Pick<IndexedPokedexEntry, 'evolutions'> | null,
  selectedId: string | null,
  entryBySlug: ReadonlyMap<string, Pick<IndexedPokedexEntry, 'id' | 'slug' | 'species'>>,
): DisplayedPokedexEvolution[] => (
  (selectedEntry?.evolutions ?? []).map((evolution) => {
    const entry = resolvePokedexEvolutionEntry(evolution.species, entryBySlug)
    return {
      ...evolution,
      ...buildPokedexEvolutionDisplay(evolution, entry),
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

export type PokedexNavigationDirection = 'previous' | 'next'

const POKEDEX_NAVIGATION_OFFSETS: Record<PokedexNavigationDirection, number> = {
  previous: -1,
  next: 1,
}

export const selectAdjacentPokedexNumberEntry = <TEntry extends PokedexEntrySummary>(
  entries: readonly TEntry[],
  selectedId: string | null,
  direction: PokedexNavigationDirection,
): TEntry | null => {
  if (!selectedId) return null

  const selectedIndex = entries.findIndex((entry) => entry.id === selectedId)
  if (selectedIndex < 0) return null

  return entries[selectedIndex + POKEDEX_NAVIGATION_OFFSETS[direction]] ?? null
}

// A small set of upstream book/parser evolution labels use abbreviations or
// typos that do not exactly match the target Pokédex entry slug.
const POKEDEX_EVOLUTION_SLUG_ALIASES: Readonly<Record<string, readonly string[]>> = {
  sligoo: ['sliggoo'],
  'lycanrock-dusk': ['lycanroc-dusk'],
  'lycanrock-midday': ['lycanroc-midday'],
  'lycanrock-midnight': ['lycanroc-midnight'],
  'palafin-loyalty-3': ['palafin-zero'],
  'urshifu-r': ['urshifu-rapid-strike-form'],
  'urshifu-s': ['urshifu-single-strike-form'],
  zacian: ['zacian-hero-of-many-battles-forme'],
  zamazenta: ['zamazenta-hero-of-many-battles-forme'],
}

const resolvePokedexEvolutionAliasSlug = <TEntry extends Pick<IndexedPokedexEntry, 'slug'>>(
  evolutionSlug: string,
  entryBySlug: ReadonlyMap<string, TEntry>,
): TEntry | null => {
  for (const aliasSlug of POKEDEX_EVOLUTION_SLUG_ALIASES[evolutionSlug] ?? []) {
    const entry = entryBySlug.get(aliasSlug)
    if (entry) return entry
  }

  return null
}

const resolvePokedexEvolutionSlug = <TEntry extends Pick<IndexedPokedexEntry, 'slug'>>(
  evolutionSlug: string,
  entryBySlug: ReadonlyMap<string, TEntry>,
): TEntry | null => {
  const exactEntry = entryBySlug.get(evolutionSlug)
  if (exactEntry) return exactEntry

  const aliasEntry = resolvePokedexEvolutionAliasSlug(evolutionSlug, entryBySlug)
  if (aliasEntry) return aliasEntry

  let longestPrefixEntry: TEntry | null = null
  let longestPrefixLength = 0

  for (const [entrySlug, entry] of entryBySlug) {
    if (!entrySlug || entrySlug.length <= longestPrefixLength) continue
    if (!evolutionSlug.startsWith(`${entrySlug}-`)) continue

    longestPrefixEntry = entry
    longestPrefixLength = entrySlug.length
  }

  return longestPrefixEntry
}

export const resolvePokedexEvolutionEntry = <TEntry extends Pick<IndexedPokedexEntry, 'slug'>>(
  evolutionSpecies: string,
  entryBySlug: ReadonlyMap<string, TEntry>,
): TEntry | null => {
  const evolutionSlug = toPokedexSlug(evolutionSpecies)
  return evolutionSlug ? resolvePokedexEvolutionSlug(evolutionSlug, entryBySlug) : null
}

export const selectAdjacentPokedexEvolutionEntry = <TEntry extends Pick<IndexedPokedexEntry, 'id' | 'slug'>>(
  selectedEntry: Pick<IndexedPokedexEntry, 'evolutions'> | null,
  selectedId: string | null,
  entryBySlug: ReadonlyMap<string, TEntry>,
  direction: PokedexNavigationDirection,
): TEntry | null => {
  if (!selectedEntry || !selectedId) return null

  const evolutionEntries = (selectedEntry.evolutions ?? []).map((evolution) => (
    resolvePokedexEvolutionEntry(evolution.species, entryBySlug)
  ))
  const selectedEvolutionIndex = evolutionEntries.findIndex((entry) => entry?.id === selectedId)
  if (selectedEvolutionIndex < 0) return null

  const targetEntry = evolutionEntries[selectedEvolutionIndex + POKEDEX_NAVIGATION_OFFSETS[direction]] ?? null
  return targetEntry?.id === selectedId ? null : targetEntry
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
    activeSearchFilters,
    clearSearchEntries,
    filteredEntries,
    filterMode,
    filterOperators,
    isSearchIndexLoading,
    refreshSearchEntries,
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
  const typeMatchupGroups = computed(() => buildTypeMatchupGroups(selectedEntry.value?.types))
  const ready = Promise.all([summariesRequest, detailRequest])

  const refreshPokedexData = async (): Promise<void> => {
    const shouldReloadSearchEntries = activeSearchFilters.value.length > 0
    clearSearchEntries()

    await Promise.all([
      summariesRequest.refresh(),
      detailRequest.refresh(),
    ])

    if (shouldReloadSearchEntries) await refreshSearchEntries()
  }

  const goToRandomPokemon = (): boolean => {
    const path = randomPokedexEntryPath(filteredEntries.value, selectedId.value)
    if (!path) return false

    void router.push(path)
    return true
  }

  const goToAdjacentPokedexNumber = (direction: PokedexNavigationDirection): boolean => {
    const entry = selectAdjacentPokedexNumberEntry(allEntries.value, selectedId.value, direction)
    if (!entry) return false

    void router.push(pokedexEntryPath(entry))
    return true
  }

  const goToAdjacentEvolution = (direction: PokedexNavigationDirection): boolean => {
    const entry = selectAdjacentPokedexEvolutionEntry(
      selectedEntry.value,
      selectedId.value,
      entryBySlug.value,
      direction,
    )
    if (!entry) return false

    void router.push(pokedexEntryPath(entry))
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
    goToAdjacentEvolution,
    goToAdjacentPokedexNumber,
    habitatSummary,
    heightLabel,
    isPlacementOnly,
    isSearchIndexLoading,
    pageNumber,
    pageTitle,
    ready,
    refreshPokedexData,
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
