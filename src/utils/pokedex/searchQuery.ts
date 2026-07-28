import type { FilterOperator, PokedexSearchTextKey } from '~/utils/pokedex/searchText'
import {
  matchesSearchExpression,
  type SearchExpression,
} from '~/utils/pokedex/searchExpressions'

export type {
  SearchBooleanExpression,
  SearchCriterion,
  SearchExpression,
  SearchNotExpression,
  SearchToken,
} from '~/utils/pokedex/searchExpressions'

export {
  matchesSearchCriterion,
  matchesSearchExpression,
  normalizeSearchQuery,
  parseSearchExpression,
  tokenizeSearchQuery,
  toSearchCriterion,
} from '~/utils/pokedex/searchExpressions'

export interface ActiveSearchFilter {
  key: PokedexSearchTextKey
  expression: SearchExpression
  operator: FilterOperator
}

export interface PokedexSearchCandidate {
  searchTexts: Record<PokedexSearchTextKey, string>
}

export const matchesActiveSearchFilters = <TEntry extends PokedexSearchCandidate>(
  entry: TEntry,
  filters: ActiveSearchFilter[],
): boolean => {
  if (filters.length === 0) return true

  const firstFilter = filters[0]
  if (!firstFilter) return true
  let matches = matchesSearchExpression(entry.searchTexts[firstFilter.key], firstFilter.expression)

  for (let index = 1; index < filters.length; index += 1) {
    const filter = filters[index]
    if (!filter) continue
    const currentMatches = matchesSearchExpression(entry.searchTexts[filter.key], filter.expression)
    matches = filter.operator === 'and' ? matches && currentMatches : matches || currentMatches
  }

  return matches
}
