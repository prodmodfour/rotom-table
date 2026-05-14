import { describe, expect, it } from 'vitest'
import {
  PRIMARY_APP_NAV_ITEMS,
  REFERENCE_APP_NAV_ITEMS,
  filterAppNavItems,
  isAppNavItemActive,
} from '~/utils/appNavigation'
import { ENCOUNTER_TABLES_PATH } from '~/utils/encounterRoutes'

describe('app navigation helpers', () => {
  it('filters GM-only nav items for player-visible navigation', () => {
    expect(filterAppNavItems(PRIMARY_APP_NAV_ITEMS, false).map((item) => item.path)).toEqual([
      '/maps',
      '/pokedex',
      '/sheets',
    ])
    expect(filterAppNavItems(REFERENCE_APP_NAV_ITEMS, false).some((item) => item.path === '/maneuvers')).toBe(true)
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
    expect(isAppNavItemActive('/moves/tackle', '/moves')).toBe(true)
    expect(isAppNavItemActive('/abilities', '/moves')).toBe(false)
  })
})
