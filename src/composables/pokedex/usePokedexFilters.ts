import { computed, reactive } from 'vue'
import {
  filterFieldConfigs,
  searchFieldConfigs,
  type FieldFilterKey,
  type FilterMode,
  type FilterOperator,
  type PokedexSearchTextKey,
} from '~/utils/pokedex/searchText'
import { matchesActiveSearchFilters, parseSearchExpression, type ActiveSearchFilter } from '~/utils/pokedex/searchQuery'
import type { DisplayPokedexEntry } from '~/utils/pokedex/entryIndex'

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

export const usePokedexFilters = (entries: DisplayPokedexEntry[]) => {
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

  const activeSearchFilters = computed(() => buildActivePokedexSearchFilters(
    filterMode.value,
    searchFilters,
    filterOperators,
  ))

  const filteredEntries = computed(() => filterPokedexEntries(entries, activeSearchFilters.value))

  return {
    activeSearchFilters,
    filteredEntries,
    filterMode,
    filterOperators,
    searchFilters,
  }
}
