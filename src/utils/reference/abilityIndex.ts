import type { PtuAbility } from '~/types/ptuReference'
import { matchesReferenceSearch, normalizeReferenceSearch } from '~/utils/reference/search'

export interface AbilityFilterOptions {
  searchTerm?: string
}

export const abilityMatchesSearch = (
  ability: PtuAbility,
  normalizedQuery: string,
): boolean => {
  const haystacks = [
    ability.name,
    ability.frequency ?? '',
    ability.trigger ?? '',
    ability.effect ?? '',
  ]
  return matchesReferenceSearch(haystacks, normalizedQuery)
}

export const filterAbilitiesForIndex = (
  abilities: readonly PtuAbility[],
  options: AbilityFilterOptions,
): PtuAbility[] => {
  const query = normalizeReferenceSearch(options.searchTerm ?? '')
  if (!query) return [...abilities]
  return abilities.filter((ability) => abilityMatchesSearch(ability, query))
}
