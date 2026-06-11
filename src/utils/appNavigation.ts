import { CAMPAIGN_PATH, HOME_PATH, SETTINGS_PATH, USEFUL_CHARTS_PATH, isHomePath, isSettingsPath } from '~/utils/appRoutes'
import { ENCOUNTER_GENERATOR_PATH, ENCOUNTER_TABLES_PATH } from '~/utils/encounterRoutes'
import { isLegacyGridPath } from '~/utils/legacyGridRoutes'
import { MAP_LIBRARY_PATH } from '~/utils/mapRoutes'
import { POKEDEX_PATH } from '~/utils/pokedex/routes'
import { PLAYER_PROFILE_MANAGEMENT_PATH } from '~/utils/playerProfileRoutes'
import { PLAYER_TRAINER_PORTAL_PATH } from '~/utils/playerTrainerPortalRoutes'
import { referenceIndexPath } from '~/utils/reference/routes'
import { SHEET_LIBRARY_PATH } from '~/utils/sheetRoutes'

export interface AppNavItem {
  path: string
  label: string
  gmOnly?: boolean
  playerOnly?: boolean
}

export const PRIMARY_APP_NAV_ITEMS: AppNavItem[] = [
  { path: MAP_LIBRARY_PATH, label: 'Maps' },
  { path: CAMPAIGN_PATH, label: 'Campaign' },
  { path: POKEDEX_PATH, label: 'Pokédex' },
  { path: PLAYER_TRAINER_PORTAL_PATH, label: 'Trainers', playerOnly: true },
  { path: SHEET_LIBRARY_PATH, label: 'Sheets', gmOnly: true },
  { path: SETTINGS_PATH, label: 'Settings', gmOnly: true },
  { path: PLAYER_PROFILE_MANAGEMENT_PATH, label: 'Players', gmOnly: true },
  { path: ENCOUNTER_GENERATOR_PATH, label: 'Generate', gmOnly: true },
]

export const REFERENCE_APP_NAV_ITEMS: AppNavItem[] = [
  { path: referenceIndexPath('move'), label: 'Moves' },
  { path: referenceIndexPath('maneuver'), label: 'Maneuvers' },
  { path: referenceIndexPath('ability'), label: 'Abilities' },
  { path: referenceIndexPath('capability'), label: 'Capabilities' },
  { path: referenceIndexPath('condition'), label: 'Conditions' },
  { path: referenceIndexPath('rule'), label: 'Rules' },
  { path: USEFUL_CHARTS_PATH, label: 'Charts' },
  { path: referenceIndexPath('item'), label: 'Items' },
  { path: referenceIndexPath('feature'), label: 'Features' },
  { path: referenceIndexPath('edge'), label: 'Edges' },
  { path: ENCOUNTER_TABLES_PATH, label: 'Encounter Tables', gmOnly: true },
]

export const filterAppNavItems = (
  items: readonly AppNavItem[],
  isGm: boolean,
  isPlayer = !isGm,
): AppNavItem[] => items.filter((item) => (
  (!item.gmOnly || isGm) && (!item.playerOnly || isPlayer)
))

export const isAppNavItemActive = (currentPath: string, itemPath: string): boolean => {
  if (itemPath === MAP_LIBRARY_PATH) {
    return (
      isHomePath(currentPath)
      || currentPath.startsWith(MAP_LIBRARY_PATH)
      || isLegacyGridPath(currentPath)
    )
  }

  if (itemPath === PLAYER_TRAINER_PORTAL_PATH) {
    return currentPath === PLAYER_TRAINER_PORTAL_PATH
      || currentPath.startsWith(`${PLAYER_TRAINER_PORTAL_PATH}/`)
      || currentPath === SHEET_LIBRARY_PATH
      || currentPath.startsWith(`${SHEET_LIBRARY_PATH}/`)
  }

  if (itemPath === SETTINGS_PATH) return isSettingsPath(currentPath)

  if (itemPath === HOME_PATH) return isHomePath(currentPath)

  return currentPath.startsWith(itemPath)
}
