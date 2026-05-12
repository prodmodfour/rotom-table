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

  let matches = matchesSearchExpression(entry.searchTexts[filters[0].key], filters[0].expression)

  for (let index = 1; index < filters.length; index += 1) {
    const filter = filters[index]
    const currentMatches = matchesSearchExpression(entry.searchTexts[filter.key], filter.expression)
    matches = filter.operator === 'and' ? matches && currentMatches : matches || currentMatches
  }

  return matches
}
