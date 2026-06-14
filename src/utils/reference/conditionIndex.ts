import type { PtuConditionRecord } from '~/utils/statusConditions'
import { matchesReferenceSearch, normalizeReferenceSearch } from '~/utils/reference/search'

export interface ConditionFilterOptions {
  searchTerm?: string
}

export const conditionMatchesSearch = (
  condition: PtuConditionRecord,
  normalizedQuery: string,
): boolean => {
  const haystacks = [
    condition.name,
    condition.category,
    condition.effect ?? '',
    condition.source ?? '',
    ...(condition.aliases ?? []),
  ]
  return matchesReferenceSearch(haystacks, normalizedQuery)
}

export const filterConditionsForIndex = (
  conditions: readonly PtuConditionRecord[],
  options: ConditionFilterOptions,
): PtuConditionRecord[] => {
  const query = normalizeReferenceSearch(options.searchTerm ?? '')
  if (!query) return [...conditions]
  return conditions.filter((condition) => conditionMatchesSearch(condition, query))
}
