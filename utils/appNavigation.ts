export interface AppNavItem {
  path: string
  label: string
  gmOnly?: boolean
}

export const PRIMARY_APP_NAV_ITEMS: AppNavItem[] = [
  { path: '/maps', label: 'Maps' },
  { path: '/pokedex', label: 'Pokédex' },
  { path: '/sheets', label: 'Sheets' },
  { path: '/generate', label: 'Generate', gmOnly: true },
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
  { path: '/encounter-tables', label: 'Encounter Tables', gmOnly: true },
]

export const filterAppNavItems = (
  items: readonly AppNavItem[],
  isGm: boolean,
): AppNavItem[] => items.filter((item) => !item.gmOnly || isGm)

export const isAppNavItemActive = (currentPath: string, itemPath: string): boolean => {
  if (itemPath === '/maps') {
    return currentPath === '/' || currentPath.startsWith('/maps') || currentPath.startsWith('/grids')
  }

  if (itemPath === '/') return currentPath === '/'

  return currentPath.startsWith(itemPath)
}
