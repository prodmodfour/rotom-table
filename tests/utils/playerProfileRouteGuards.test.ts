import { describe, expect, it } from 'vitest'
import { GM_PATH, LOGIN_PATH, SESSION_LOBBY_PATH } from '~/utils/appRoutes'
import { ENCOUNTER_GENERATOR_PATH } from '~/utils/encounterRoutes'
import { DEFAULT_LOGIN_REDIRECT } from '~/utils/loginRedirect'
import { MAP_LIBRARY_PATH } from '~/utils/mapRoutes'
import { POKEDEX_PATH } from '~/utils/pokedex/routes'
import { referenceDetailPath, referenceIndexPath } from '~/utils/reference/routes'
import { SHEET_LIBRARY_PATH } from '~/utils/sheetRoutes'
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

describe('player profile-aware route guards', () => {
  it('keeps login, profile picker, Pokédex, reference, and informational routes reachable without a selected profile', () => {
    expect(isPlayerProfileOptionalPath(LOGIN_PATH)).toBe(true)
    expect(isPlayerProfileOptionalPath(POKEDEX_PATH)).toBe(true)
    expect(isPlayerProfileOptionalPath(`${POKEDEX_PATH}/pikachu`)).toBe(true)
    expect(isPlayerProfileOptionalPath(referenceIndexPath('move'))).toBe(true)
    expect(isPlayerProfileOptionalPath(referenceDetailPath('rule', 'combat-stages'))).toBe(true)
    expect(isPlayerProfileOptionalPath(MAP_LIBRARY_PATH)).toBe(true)
    expect(isPlayerProfileOptionalPath(`${MAP_LIBRARY_PATH}?folder=routes`)).toBe(true)
    expect(isPlayerProfileOptionalPath(SHEET_LIBRARY_PATH)).toBe(true)
    expect(isPlayerProfileOptionalPath(`${SHEET_LIBRARY_PATH}?folder=party`)).toBe(true)
    expect(isPlayerProfileOptionalPath(SESSION_LOBBY_PATH)).toBe(true)
  })

  it('requires a selected profile before player map-control and sheet-editor routes', () => {
    expect(isPlayerProfileRequiredPath('/maps/viridian-forest')).toBe(true)
    expect(isPlayerProfileRequiredPath('/maps/viridian-forest?floor=1')).toBe(true)
    expect(isPlayerProfileRequiredPath('/sheets/pikachu')).toBe(true)
    expect(isPlayerProfileRequiredPath('/sheets/trainers/brock')).toBe(true)

    expect(isPlayerProfileRequiredPath('/maps')).toBe(false)
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
      '/sheets',
      '/pokedex/pikachu',
      '/moves/tackle',
      '/rules/combat-stages',
      SESSION_LOBBY_PATH,
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

  it('keeps GM-only routes blocked for players regardless of selected profile state', () => {
    for (const hasSelectedPlayerProfile of [false, true]) {
      expect(resolveProfileAwareRouteGuard({
        path: GM_PATH,
        fullPath: GM_PATH,
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
