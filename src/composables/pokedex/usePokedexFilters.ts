import { computed, onMounted, reactive, ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  filterFieldConfigs,
  searchFieldConfigs,
  type FieldFilterKey,
  type FilterMode,
  type FilterOperator,
  type PokedexSearchTextKey,
} from '~/utils/pokedex/searchText'
import { matchesActiveSearchFilters, parseSearchExpression, type ActiveSearchFilter } from '~/utils/pokedex/searchQuery'
import type { DisplayPokedexEntry, PokedexEntrySummary } from '~/utils/pokedex/entryIndex'

export const createEmptyPokedexSearchFilters = (): Record<PokedexSearchTextKey, string> => (
  Object.fromEntries(searchFieldConfigs.map(({ key }) => [key, ''])) as Record<PokedexSearchTextKey, string>
)

export const createDefaultPokedexFilterOperators = (): Record<FieldFilterKey, FilterOperator> => (
  Object.fromEntries(filterFieldConfigs.map(({ key }) => [key, 'and'])) as Record<FieldFilterKey, FilterOperator>
)

export const buildActivePokedexSearchFilters = (
  filterMode: FilterMode,
  searchFilters: Record<PokedexSearchTextKey, string>,
  filterOperators: Record<FieldFilterKey, FilterOperator>,
): ActiveSearchFilter[] => {
  if (filterMode === 'advanced') {
    const expression = parseSearchExpression(searchFilters.any)
    return expression ? [{ key: 'any', expression, operator: 'and' }] : []
  }

  const filters: ActiveSearchFilter[] = []

  for (const { key } of filterFieldConfigs) {
    const expression = parseSearchExpression(searchFilters[key])
    if (expression) {
      filters.push({ key, expression, operator: filterOperators[key] })
    }
  }

  return filters
}

export const filterPokedexEntries = <TEntry extends DisplayPokedexEntry>(
  entries: TEntry[],
  filters: ActiveSearchFilter[],
): TEntry[] => {
  if (filters.length === 0) return entries
  return entries.filter((entry) => matchesActiveSearchFilters(entry, filters))
}

export interface UsePokedexFiltersOptions {
  loadSearchEntries?: () => Promise<DisplayPokedexEntry[]>
}

const hasSearchTexts = (entry: PokedexEntrySummary | DisplayPokedexEntry): entry is DisplayPokedexEntry => (
  Boolean((entry as Partial<DisplayPokedexEntry>).searchTexts)
)

const collectSearchableEntries = <TEntry extends PokedexEntrySummary>(
  entries: readonly TEntry[],
): DisplayPokedexEntry[] => entries.filter(hasSearchTexts) as unknown as DisplayPokedexEntry[]

const resolveSearchableEntries = <TEntry extends PokedexEntrySummary>(
  entries: readonly TEntry[],
  loadedSearchEntries: DisplayPokedexEntry[] | null,
): DisplayPokedexEntry[] => loadedSearchEntries ?? collectSearchableEntries(entries)

export const usePokedexFilters = <TEntry extends PokedexEntrySummary>(
  entries: MaybeRefOrGetter<TEntry[]>,
  options: UsePokedexFiltersOptions = {},
) => {
  const filterMode = useState<FilterMode>('pokedex-filter-mode', () => 'fields')
  const searchFilters = reactive<Record<PokedexSearchTextKey, string>>(
    useState<Record<PokedexSearchTextKey, string>>(
      'pokedex-search-filters',
      createEmptyPokedexSearchFilters,
    ).value,
  )
  const filterOperators = reactive<Record<FieldFilterKey, FilterOperator>>(
    useState<Record<FieldFilterKey, FilterOperator>>(
      'pokedex-filter-operators',
      createDefaultPokedexFilterOperators,
    ).value,
  )
  const loadedSearchEntries = shallowRef<DisplayPokedexEntry[] | null>(null)
  const searchIndexRequestPending = ref(false)
  const searchIndexError = shallowRef<unknown>(null)

  const activeSearchFilters = computed(() => buildActivePokedexSearchFilters(
    filterMode.value,
    searchFilters,
    filterOperators,
  ))

  const hasInlineSearchEntries = computed(() => toValue(entries).some(hasSearchTexts))
  const isSearchIndexLoading = computed(() => (
    activeSearchFilters.value.length > 0 &&
    !loadedSearchEntries.value &&
    !hasInlineSearchEntries.value &&
    !searchIndexError.value
  ) || searchIndexRequestPending.value)

  const ensureSearchEntries = async () => {
    if (loadedSearchEntries.value || searchIndexRequestPending.value) return

    const currentEntries = toValue(entries)
    if (!options.loadSearchEntries) {
      loadedSearchEntries.value = collectSearchableEntries(currentEntries)
      return
    }

    searchIndexRequestPending.value = true
    searchIndexError.value = null

    try {
      loadedSearchEntries.value = await options.loadSearchEntries()
    } catch (error) {
      searchIndexError.value = error
    } finally {
      searchIndexRequestPending.value = false
    }
  }

  const scheduleSearchEntries = () => {
    if (!import.meta.client) {
      void ensureSearchEntries()
      return
    }

    const requestIdleCallback = window.requestIdleCallback ?? ((callback: IdleRequestCallback) => {
      const id = window.setTimeout(() => callback({
        didTimeout: false,
        timeRemaining: () => 0,
      }), 150)
      return id as unknown as number
    })

    requestIdleCallback(() => {
      void ensureSearchEntries()
    }, { timeout: 750 })
  }

  watch(activeSearchFilters, (filters) => {
    if (filters.length > 0) {
      void ensureSearchEntries()
    }
  }, { flush: 'post' })

  onMounted(() => {
    if (activeSearchFilters.value.length > 0) {
      scheduleSearchEntries()
    }
  })

  const filteredEntries = computed<PokedexEntrySummary[]>(() => {
    const currentEntries = toValue(entries)
    const filters = activeSearchFilters.value

    if (filters.length === 0) return currentEntries

    return filterPokedexEntries(
      resolveSearchableEntries(currentEntries, loadedSearchEntries.value),
      filters,
    )
  })

  return {
    activeSearchFilters,
    filteredEntries,
    filterMode,
    filterOperators,
    isSearchIndexLoading,
    searchFilters,
    searchIndexError,
  }
}
