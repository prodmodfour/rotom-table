import type { PtuManeuver } from '~/types/ptuReference'
import { matchesReferenceSearch, normalizeReferenceSearch } from '~/utils/reference/search'

export interface ManeuverFilterOptions {
  searchTerm?: string
  action?: string | null
}

export interface ManeuverSelectOption {
  value: string | null
  label: string
}

export const ALL_MANEUVERS_ACTION_OPTION: ManeuverSelectOption = {
  value: null,
  label: 'All actions',
}

export const buildManeuverActionOptions = (sourceManeuvers: readonly PtuManeuver[]): ManeuverSelectOption[] => {
  const actions = new Set<string>()
  for (const maneuver of sourceManeuvers) {
    if (maneuver.action) actions.add(maneuver.action)
  }

  return [
    ALL_MANEUVERS_ACTION_OPTION,
    ...Array.from(actions)
      .sort((a, b) => a.localeCompare(b))
      .map((action) => ({ value: action, label: action })),
  ]
}

export const maneuverMatchesSearch = (maneuver: PtuManeuver, normalizedQuery: string): boolean => {
  const haystacks = [
    maneuver.name,
    maneuver.category,
    maneuver.action ?? '',
    maneuver.maneuver_class ?? '',
    maneuver.range ?? '',
    maneuver.trigger ?? '',
    maneuver.effect ?? '',
    maneuver.special ?? '',
    maneuver.source ?? '',
    ...(maneuver.aliases ?? []),
  ]
  return matchesReferenceSearch(haystacks, normalizedQuery)
}

export const filterManeuversForIndex = (
  sourceManeuvers: readonly PtuManeuver[],
  options: ManeuverFilterOptions,
): PtuManeuver[] => {
  const query = normalizeReferenceSearch(options.searchTerm ?? '')
  return sourceManeuvers.filter((maneuver) => {
    if (options.action && maneuver.action !== options.action) return false
    return maneuverMatchesSearch(maneuver, query)
  })
}
