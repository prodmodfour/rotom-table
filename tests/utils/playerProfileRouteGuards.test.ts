import { describe, expect, it } from 'vitest'
import { CAMPAIGN_PATH, GROUP_INVENTORY_PATH, LOGIN_PATH, SESSION_LOBBY_PATH, SETTINGS_PATH } from '~/utils/appRoutes'
import { ENCOUNTER_GENERATOR_PATH } from '~/utils/encounterRoutes'
import { DEFAULT_LOGIN_REDIRECT } from '~/utils/loginRedirect'
import { MAP_LIBRARY_PATH } from '~/utils/mapRoutes'
import { ENCOUNTER_LIBRARY_PATH } from '#shared/encounterWorkspace/routes'
import { BREEDING_WORKSHOP_PATH } from '#shared/breeding/workshop'
import { POKEDEX_PATH } from '~/utils/pokedex/routes'
import { referenceDetailPath, referenceIndexPath } from '~/utils/reference/routes'
import { SHEET_LIBRARY_PATH } from '~/utils/sheetRoutes'
import { SHOP_LIBRARY_PATH, shopEditorPath, shopfrontPath } from '~/utils/shopRoutes'
import {
  PLAYER_PROFILE_REQUIRED_LOGIN_NOTICE,
  PLAYER_PROFILE_REQUIRED_QUERY_KEY,
  PLAYER_PROFILE_REQUIRED_QUERY_VALUE,
  authRequiredLoginRoute,
  isPlayerProfileOptionalPath,
  isPlayerProfileRequiredPath,
  playerProfileRequiredLoginRoute,
  profileRequiredLoginNotice,
  resolveProfileAwareRouteGuard,
} from '~/utils/playerProfileRouteGuards'
import { PLAYER_PROFILE_MANAGEMENT_PATH } from '~/utils/playerProfileRoutes'
import { PLAYER_TRAINER_PORTAL_PATH } from '~/utils/playerTrainerPortalRoutes'

describe('player profile-aware route guards', () => {
  it('keeps login, profile picker, Pokédex, reference, and informational routes reachable without a selected profile', () => {
    expect(isPlayerProfileOptionalPath(LOGIN_PATH)).toBe(true)
    expect(isPlayerProfileOptionalPath(POKEDEX_PATH)).toBe(true)
    expect(isPlayerProfileOptionalPath(`${POKEDEX_PATH}/pikachu`)).toBe(true)
    expect(isPlayerProfileOptionalPath(referenceIndexPath('move'))).toBe(true)
    expect(isPlayerProfileOptionalPath(referenceDetailPath('rule', 'combat-stages'))).toBe(true)
    expect(isPlayerProfileOptionalPath(MAP_LIBRARY_PATH)).toBe(true)
    expect(isPlayerProfileOptionalPath(`${MAP_LIBRARY_PATH}?folder=routes`)).toBe(true)
    expect(isPlayerProfileOptionalPath(ENCOUNTER_LIBRARY_PATH)).toBe(true)
    expect(isPlayerProfileOptionalPath(BREEDING_WORKSHOP_PATH)).toBe(true)
    expect(isPlayerProfileOptionalPath(GROUP_INVENTORY_PATH)).toBe(true)
    expect(isPlayerProfileOptionalPath(`${GROUP_INVENTORY_PATH}?tab=medicalKit`)).toBe(true)
    expect(isPlayerProfileOptionalPath(PLAYER_TRAINER_PORTAL_PATH)).toBe(true)
    expect(isPlayerProfileOptionalPath(`${PLAYER_TRAINER_PORTAL_PATH}?folder=party`)).toBe(true)
    expect(isPlayerProfileOptionalPath(SHEET_LIBRARY_PATH)).toBe(false)
    expect(isPlayerProfileOptionalPath(`${SHEET_LIBRARY_PATH}?folder=party`)).toBe(false)
    expect(isPlayerProfileOptionalPath(SESSION_LOBBY_PATH)).toBe(true)
    expect(isPlayerProfileOptionalPath(SETTINGS_PATH)).toBe(true)
  })

  it('requires a selected profile before player map-control and sheet-editor routes', () => {
    expect(isPlayerProfileRequiredPath('/maps/viridian-forest')).toBe(true)
    expect(isPlayerProfileRequiredPath('/maps/viridian-forest?floor=1')).toBe(true)
    expect(isPlayerProfileRequiredPath('/play/viridian-forest')).toBe(true)
    expect(isPlayerProfileRequiredPath('/sheets/pikachu')).toBe(true)
    expect(isPlayerProfileRequiredPath('/sheets/trainers/brock')).toBe(true)
    expect(isPlayerProfileRequiredPath(`${BREEDING_WORKSHOP_PATH}/project/example`)).toBe(true)

    expect(isPlayerProfileRequiredPath('/maps')).toBe(false)
    expect(isPlayerProfileRequiredPath(BREEDING_WORKSHOP_PATH)).toBe(false)
    expect(isPlayerProfileRequiredPath('/play')).toBe(false)
    expect(isPlayerProfileRequiredPath('/sheets')).toBe(false)
    expect(isPlayerProfileRequiredPath('/pokedex/pikachu')).toBe(false)
    expect(isPlayerProfileRequiredPath('/moves/tackle')).toBe(false)
  })

  it('redirects unauthenticated users to login without treating profileless reference browsing as a loop', () => {
    expect(resolveProfileAwareRouteGuard({
      path: '/moves/tackle',
      fullPath: '/moves/tackle?from=map',
      hasRole: false,
      isPlayer: false,
      hasSelectedPlayerProfile: false,
    })).toEqual({
      type: 'login',
      location: authRequiredLoginRoute('/moves/tackle?from=map'),
    })

    expect(resolveProfileAwareRouteGuard({
      path: GROUP_INVENTORY_PATH,
      fullPath: GROUP_INVENTORY_PATH,
      hasRole: false,
      isPlayer: false,
      hasSelectedPlayerProfile: false,
    })).toEqual({
      type: 'login',
      location: authRequiredLoginRoute(GROUP_INVENTORY_PATH),
    })

    expect(resolveProfileAwareRouteGuard({
      path: LOGIN_PATH,
      fullPath: `${LOGIN_PATH}?redirect=/maps/viridian`,
      hasRole: false,
      isPlayer: false,
      hasSelectedPlayerProfile: false,
    })).toEqual({ type: 'allow' })
  })

  it('sends profileless players from protected player action routes to the profile picker', () => {
    expect(resolveProfileAwareRouteGuard({
      path: '/maps/viridian',
      fullPath: '/maps/viridian?floor=1',
      hasRole: true,
      isPlayer: true,
      hasSelectedPlayerProfile: false,
    })).toEqual({
      type: 'login',
      location: playerProfileRequiredLoginRoute('/maps/viridian?floor=1'),
    })

    expect(resolveProfileAwareRouteGuard({
      path: '/play/viridian',
      fullPath: '/play/viridian?participant=actor%3Aone',
      hasRole: true,
      isPlayer: true,
      hasSelectedPlayerProfile: false,
    })).toEqual({
      type: 'login',
      location: playerProfileRequiredLoginRoute('/play/viridian?participant=actor%3Aone'),
    })

    expect(resolveProfileAwareRouteGuard({
      path: '/sheets/trainers/brock',
      fullPath: '/sheets/trainers/brock',
      hasRole: true,
      isPlayer: true,
      hasSelectedPlayerProfile: false,
    })).toEqual({
      type: 'login',
      location: playerProfileRequiredLoginRoute('/sheets/trainers/brock'),
    })
  })

  it('does not over-restrict players without profiles from browsing allowed app routes', () => {
    for (const path of [
      '/maps',
      '/play',
      BREEDING_WORKSHOP_PATH,
      GROUP_INVENTORY_PATH,
      PLAYER_TRAINER_PORTAL_PATH,
      SHOP_LIBRARY_PATH,
      shopfrontPath('viridian-mart'),
      '/pokedex/pikachu',
      '/moves/tackle',
      '/rules/combat-stages',
      SESSION_LOBBY_PATH,
      SETTINGS_PATH,
    ]) {
      expect(resolveProfileAwareRouteGuard({
        path,
        fullPath: path,
        hasRole: true,
        isPlayer: true,
        hasSelectedPlayerProfile: false,
      })).toEqual({ type: 'allow' })
    }
  })

  it('redirects players away from the sheet library to the trainer portal', () => {
    expect(resolveProfileAwareRouteGuard({
      path: SHEET_LIBRARY_PATH,
      fullPath: `${SHEET_LIBRARY_PATH}?folder=party`,
      hasRole: true,
      isPlayer: true,
      hasSelectedPlayerProfile: true,
    })).toEqual({ type: 'redirect', location: PLAYER_TRAINER_PORTAL_PATH })

    expect(resolveProfileAwareRouteGuard({
      path: SHEET_LIBRARY_PATH,
      fullPath: SHEET_LIBRARY_PATH,
      hasRole: true,
      isPlayer: false,
      hasSelectedPlayerProfile: false,
    })).toEqual({ type: 'allow' })
  })

  it('keeps GM-only routes blocked for players regardless of selected profile state', () => {
    for (const hasSelectedPlayerProfile of [false, true]) {
      expect(resolveProfileAwareRouteGuard({
        path: CAMPAIGN_PATH,
        fullPath: CAMPAIGN_PATH,
        hasRole: true,
        isPlayer: true,
        hasSelectedPlayerProfile,
      })).toEqual({ type: 'redirect', location: DEFAULT_LOGIN_REDIRECT })

      expect(resolveProfileAwareRouteGuard({
        path: PLAYER_PROFILE_MANAGEMENT_PATH,
        fullPath: PLAYER_PROFILE_MANAGEMENT_PATH,
        hasRole: true,
        isPlayer: true,
        hasSelectedPlayerProfile,
      })).toEqual({ type: 'redirect', location: DEFAULT_LOGIN_REDIRECT })

      expect(resolveProfileAwareRouteGuard({
        path: ENCOUNTER_GENERATOR_PATH,
        fullPath: ENCOUNTER_GENERATOR_PATH,
        hasRole: true,
        isPlayer: true,
        hasSelectedPlayerProfile,
      })).toEqual({ type: 'redirect', location: DEFAULT_LOGIN_REDIRECT })

      expect(resolveProfileAwareRouteGuard({
        path: shopEditorPath('viridian-mart'),
        fullPath: shopEditorPath('viridian-mart'),
        hasRole: true,
        isPlayer: true,
        hasSelectedPlayerProfile,
      })).toEqual({ type: 'redirect', location: DEFAULT_LOGIN_REDIRECT })
    }
  })

  it('allows selected players and GMs through protected player action routes', () => {
    expect(resolveProfileAwareRouteGuard({
      path: '/maps/viridian',
      fullPath: '/maps/viridian',
      hasRole: true,
      isPlayer: true,
      hasSelectedPlayerProfile: true,
    })).toEqual({ type: 'allow' })

    expect(resolveProfileAwareRouteGuard({
      path: '/sheets/pikachu',
      fullPath: '/sheets/pikachu',
      hasRole: true,
      isPlayer: false,
      hasSelectedPlayerProfile: false,
    })).toEqual({ type: 'allow' })

    expect(resolveProfileAwareRouteGuard({
      path: '/maps/viridian',
      fullPath: '/maps/viridian',
      hasRole: true,
      isPlayer: true,
      hasSelectedPlayerProfile: null,
    })).toEqual({ type: 'allow' })
  })

  it('builds safe profile-required login notices and redirect queries for picker recovery', () => {
    expect(playerProfileRequiredLoginRoute('/maps/viridian')).toEqual({
      path: LOGIN_PATH,
      query: {
        redirect: '/maps/viridian',
        [PLAYER_PROFILE_REQUIRED_QUERY_KEY]: PLAYER_PROFILE_REQUIRED_QUERY_VALUE,
      },
    })
    expect(playerProfileRequiredLoginRoute('//evil.example/maps')).toEqual({
      path: LOGIN_PATH,
      query: {
        redirect: DEFAULT_LOGIN_REDIRECT,
        [PLAYER_PROFILE_REQUIRED_QUERY_KEY]: PLAYER_PROFILE_REQUIRED_QUERY_VALUE,
      },
    })
    expect(profileRequiredLoginNotice(PLAYER_PROFILE_REQUIRED_QUERY_VALUE)).toBe(PLAYER_PROFILE_REQUIRED_LOGIN_NOTICE)
    expect(profileRequiredLoginNotice(['0', PLAYER_PROFILE_REQUIRED_QUERY_VALUE])).toBe(PLAYER_PROFILE_REQUIRED_LOGIN_NOTICE)
    expect(profileRequiredLoginNotice(undefined)).toBeNull()
  })
})
