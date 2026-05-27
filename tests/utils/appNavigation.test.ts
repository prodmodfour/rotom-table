import { describe, expect, it } from 'vitest'
import {
  PRIMARY_APP_NAV_ITEMS,
  REFERENCE_APP_NAV_ITEMS,
  filterAppNavItems,
  isAppNavItemActive,
} from '~/utils/appNavigation'
import { LOGIN_PATH } from '~/utils/appRoutes'
import { ENCOUNTER_TABLES_PATH } from '~/utils/encounterRoutes'
import { PLAYER_PROFILE_MANAGEMENT_PATH } from '~/utils/playerProfileRoutes'
import {
  NO_PLAYER_PROFILE_NAV_LABEL,
  playerProfileNavStatusText,
  playerProfileSwitchRoute,
} from '~/utils/playerProfileNavigation'

describe('app navigation helpers', () => {
  it('filters GM-only nav items while keeping normal player navigation available', () => {
    expect(filterAppNavItems(PRIMARY_APP_NAV_ITEMS, false).map((item) => item.path)).toEqual([
      '/maps',
      '/sessions',
      '/pokedex',
      '/sheets',
    ])
    expect(PRIMARY_APP_NAV_ITEMS.find((item) => item.path === '/sessions')?.label).toBe('Live session')
    expect(filterAppNavItems(PRIMARY_APP_NAV_ITEMS, true).some((item) => item.path === PLAYER_PROFILE_MANAGEMENT_PATH)).toBe(true)
    expect(filterAppNavItems(REFERENCE_APP_NAV_ITEMS, false).map((item) => item.path)).toEqual([
      '/moves',
      '/maneuvers',
      '/abilities',
      '/capabilities',
      '/conditions',
      '/rules',
      '/items',
      '/features',
      '/edges',
    ])
    expect(filterAppNavItems(REFERENCE_APP_NAV_ITEMS, false).some((item) => item.path === ENCOUNTER_TABLES_PATH)).toBe(false)
    expect(filterAppNavItems(REFERENCE_APP_NAV_ITEMS, true).some((item) => item.path === ENCOUNTER_TABLES_PATH)).toBe(true)
  })

  it('keeps legacy map/grid routes active under the Maps nav item', () => {
    expect(isAppNavItemActive('/', '/maps')).toBe(true)
    expect(isAppNavItemActive('/maps/airship', '/maps')).toBe(true)
    expect(isAppNavItemActive('/grids/legacy', '/maps')).toBe(true)
    expect(isAppNavItemActive('/sheets', '/maps')).toBe(false)
  })

  it('uses exact matching for the home route and prefix matching otherwise', () => {
    expect(isAppNavItemActive('/', '/')).toBe(true)
    expect(isAppNavItemActive('/maps', '/')).toBe(false)
    expect(isAppNavItemActive('/sessions', '/sessions')).toBe(true)
    expect(isAppNavItemActive('/sessions/join', '/sessions')).toBe(true)
    expect(isAppNavItemActive('/moves/tackle', '/moves')).toBe(true)
    expect(isAppNavItemActive('/abilities', '/moves')).toBe(false)
  })

  it('formats player profile navigation status without affecting route access', () => {
    expect(playerProfileNavStatusText('Ash Ketchum')).toBe('Profile: Ash Ketchum')
    expect(playerProfileNavStatusText('  Misty  ')).toBe('Profile: Misty')
    expect(playerProfileNavStatusText(null)).toBe(NO_PLAYER_PROFILE_NAV_LABEL)
  })

  it('builds switch-profile login links that return players to their current page', () => {
    expect(playerProfileSwitchRoute('/maps/viridian?floor=1')).toEqual({
      path: LOGIN_PATH,
      query: { redirect: '/maps/viridian?floor=1' },
    })
    expect(playerProfileSwitchRoute('/login')).toEqual({ path: LOGIN_PATH })
    expect(playerProfileSwitchRoute('/login?redirect=/maps')).toEqual({ path: LOGIN_PATH })
  })
})
