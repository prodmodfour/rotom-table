import { ENCOUNTER_GENERATOR_PATH, ENCOUNTER_TABLES_PATH } from '~/utils/encounterRoutes'
import { MAP_LIBRARY_PATH } from '~/utils/mapRoutes'
import { SHEET_LIBRARY_PATH } from '~/utils/sheetRoutes'

export interface AppNavItem {
  path: string
  label: string
  gmOnly?: boolean
}

export const PRIMARY_APP_NAV_ITEMS: AppNavItem[] = [
  { path: MAP_LIBRARY_PATH, label: 'Maps' },
  { path: '/pokedex', label: 'Pokédex' },
  { path: SHEET_LIBRARY_PATH, label: 'Sheets' },
  { path: ENCOUNTER_GENERATOR_PATH, label: 'Generate', gmOnly: true },
]

export const REFERENCE_APP_NAV_ITEMS: AppNavItem[] = [
  { path: '/moves', label: 'Moves' },
  { path: '/abilities', label: 'Abilities' },
  { path: '/capabilities', label: 'Capabilities' },
  { path: '/conditions', label: 'Conditions' },
  { path: '/rules', label: 'Rules' },
  { path: '/items', label: 'Items' },
  { path: '/features', label: 'Features' },
  { path: '/edges', label: 'Edges' },
  { path: ENCOUNTER_TABLES_PATH, label: 'Encounter Tables', gmOnly: true },
]

export const filterAppNavItems = (
  items: readonly AppNavItem[],
  isGm: boolean,
): AppNavItem[] => items.filter((item) => !item.gmOnly || isGm)

export const isAppNavItemActive = (currentPath: string, itemPath: string): boolean => {
  if (itemPath === MAP_LIBRARY_PATH) {
    return currentPath === '/' || currentPath.startsWith(MAP_LIBRARY_PATH) || currentPath.startsWith('/grids')
  }

  if (itemPath === '/') return currentPath === '/'

  return currentPath.startsWith(itemPath)
}
