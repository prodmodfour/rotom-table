import type { PtuConditionRecord } from '~/utils/statusConditions'
import { matchesReferenceSearch, normalizeReferenceSearch } from '~/utils/reference/search'

export interface ConditionFilterOptions {
  searchTerm?: string
}

export interface ConditionGroupForIndex {
  category: string
  label: string
  conditions: readonly PtuConditionRecord[]
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

export const groupFilteredConditions = (
  groups: readonly ConditionGroupForIndex[],
  filteredConditions: readonly PtuConditionRecord[],
): ConditionGroupForIndex[] => {
  const filteredSet = new Set(filteredConditions)
  return groups
    .map((group) => ({
      ...group,
      conditions: group.conditions.filter((condition) => filteredSet.has(condition)),
    }))
    .filter((group) => group.conditions.length > 0)
}
