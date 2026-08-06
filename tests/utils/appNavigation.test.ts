import { describe, expect, it } from 'vitest'
import {
  PRIMARY_APP_NAV_ITEMS,
  REFERENCE_APP_NAV_ITEMS,
  filterAppNavItems,
  isAppNavItemActive,
} from '~/utils/appNavigation'
import { CAMPAIGN_PATH, GROUP_INVENTORY_PATH, LOGIN_PATH, SETTINGS_PATH, USEFUL_CHARTS_PATH } from '~/utils/appRoutes'
import { ENCOUNTER_TABLES_PATH } from '~/utils/encounterRoutes'
import { BREEDING_WORKSHOP_PATH } from '#shared/breeding/workshop'
import { PLAYER_PROFILE_MANAGEMENT_PATH } from '~/utils/playerProfileRoutes'
import { SHOP_LIBRARY_PATH } from '~/utils/shopRoutes'
import {
  NO_PLAYER_PROFILE_NAV_LABEL,
  playerProfileNavStatusText,
  playerProfileSwitchRoute,
} from '~/utils/playerProfileNavigation'

describe('app navigation helpers', () => {
  it('filters GM-only nav items while keeping normal player navigation available', () => {
    expect(filterAppNavItems(PRIMARY_APP_NAV_ITEMS, false).map((item) => item.path)).toEqual([
      '/play',
      '/maps',
      BREEDING_WORKSHOP_PATH,
      GROUP_INVENTORY_PATH,
      SHOP_LIBRARY_PATH,
      '/pokedex',
      '/trainers',
      SETTINGS_PATH,
    ])
    expect(PRIMARY_APP_NAV_ITEMS.some((item) => item.path === '/sessions')).toBe(false)
    expect(filterAppNavItems(PRIMARY_APP_NAV_ITEMS, true).map((item) => item.path)).toEqual([
      '/play',
      '/maps',
      BREEDING_WORKSHOP_PATH,
      CAMPAIGN_PATH,
      GROUP_INVENTORY_PATH,
      SHOP_LIBRARY_PATH,
      '/pokedex',
      '/sheets',
      SETTINGS_PATH,
      PLAYER_PROFILE_MANAGEMENT_PATH,
      '/encounters/new',
    ])
    expect(filterAppNavItems(PRIMARY_APP_NAV_ITEMS, true).some((item) => item.path === '/sessions')).toBe(false)
    expect(filterAppNavItems(PRIMARY_APP_NAV_ITEMS, false).find((item) => item.path === GROUP_INVENTORY_PATH)?.label).toBe('Group Inventory')
    expect(filterAppNavItems(PRIMARY_APP_NAV_ITEMS, true).find((item) => item.path === GROUP_INVENTORY_PATH)?.label).toBe('Group Inventory')
    expect(filterAppNavItems(PRIMARY_APP_NAV_ITEMS, false).find((item) => item.path === SHOP_LIBRARY_PATH)?.label).toBe('Shops')
    expect(filterAppNavItems(PRIMARY_APP_NAV_ITEMS, true).find((item) => item.path === SHOP_LIBRARY_PATH)?.label).toBe('Shops')
    expect(filterAppNavItems(PRIMARY_APP_NAV_ITEMS, true).find((item) => item.path === SETTINGS_PATH)?.label).toBe('Settings')
    expect(filterAppNavItems(PRIMARY_APP_NAV_ITEMS, true).find((item) => item.path === PLAYER_PROFILE_MANAGEMENT_PATH)?.label).toBe('Players')
    expect(filterAppNavItems(REFERENCE_APP_NAV_ITEMS, false).map((item) => item.path)).toEqual([
      '/moves',
      '/maneuvers',
      '/abilities',
      '/capabilities',
      '/conditions',
      '/rules',
      USEFUL_CHARTS_PATH,
      '/items',
      '/features',
      '/edges',
    ])
    expect(filterAppNavItems(REFERENCE_APP_NAV_ITEMS, false).some((item) => item.path === ENCOUNTER_TABLES_PATH)).toBe(false)
    expect(filterAppNavItems(REFERENCE_APP_NAV_ITEMS, true).some((item) => item.path === ENCOUNTER_TABLES_PATH)).toBe(true)
  })

  it('keeps encounter and legacy map/grid routes in distinct active navigation groups', () => {
    expect(isAppNavItemActive('/play', '/play')).toBe(true)
    expect(isAppNavItemActive('/play/viridian', '/play')).toBe(true)
    expect(isAppNavItemActive('/maps/viridian', '/play')).toBe(false)
    expect(isAppNavItemActive('/', '/maps')).toBe(true)
    expect(isAppNavItemActive('/maps/airship', '/maps')).toBe(true)
    expect(isAppNavItemActive('/grids/legacy', '/maps')).toBe(true)
    expect(isAppNavItemActive('/sheets', '/maps')).toBe(false)
    expect(isAppNavItemActive(BREEDING_WORKSHOP_PATH, BREEDING_WORKSHOP_PATH)).toBe(true)
    expect(isAppNavItemActive(`${BREEDING_WORKSHOP_PATH}/project/example`, BREEDING_WORKSHOP_PATH)).toBe(true)
    expect(isAppNavItemActive('/maps', BREEDING_WORKSHOP_PATH)).toBe(false)
    expect(isAppNavItemActive('/encounters/new', '/encounters/new')).toBe(true)
    expect(isAppNavItemActive('/group-inventory', GROUP_INVENTORY_PATH)).toBe(true)
    expect(isAppNavItemActive('/group-inventory/history', GROUP_INVENTORY_PATH)).toBe(true)
    expect(isAppNavItemActive('/group-inventory-tools', GROUP_INVENTORY_PATH)).toBe(false)
    expect(isAppNavItemActive('/shops', SHOP_LIBRARY_PATH)).toBe(true)
    expect(isAppNavItemActive('/shops/viridian-mart', SHOP_LIBRARY_PATH)).toBe(true)
    expect(isAppNavItemActive('/shops/viridian-mart/edit', SHOP_LIBRARY_PATH)).toBe(true)
    expect(isAppNavItemActive('/shops-tools', SHOP_LIBRARY_PATH)).toBe(false)
    expect(isAppNavItemActive('/trainers', '/trainers')).toBe(true)
    expect(isAppNavItemActive('/sheets/trainers/brock', '/trainers')).toBe(true)
    expect(isAppNavItemActive('/sheets/pikachu', '/trainers')).toBe(true)
  })

  it('uses exact matching for the home route and prefix matching otherwise', () => {
    expect(isAppNavItemActive('/', '/')).toBe(true)
    expect(isAppNavItemActive('/maps', '/')).toBe(false)
    expect(isAppNavItemActive('/settings', SETTINGS_PATH)).toBe(true)
    expect(isAppNavItemActive('/settings/campaign', SETTINGS_PATH)).toBe(true)
    expect(isAppNavItemActive('/settings-tools', SETTINGS_PATH)).toBe(false)
    expect(isAppNavItemActive('/players', '/players')).toBe(true)
    expect(isAppNavItemActive('/players/profile_ash00000', '/players')).toBe(true)
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
