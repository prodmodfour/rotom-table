import { describe, expect, it } from 'vitest'
import { GM_PATH, LOGIN_PATH } from '~/utils/appRoutes'
import {
  ENCOUNTER_GENERATOR_PATH,
  ENCOUNTER_TABLES_PATH,
} from '~/utils/encounterRoutes'
import {
  DEFAULT_LOGIN_REDIRECT,
  PLAYER_BLOCKED_REDIRECT_PREFIXES,
  isPlayerBlockedRedirectPath,
  isSafeInternalRedirect,
  resolveLoginRedirectTarget,
} from '~/utils/loginRedirect'
import { PLAYER_PROFILE_MANAGEMENT_PATH } from '~/utils/playerProfileRoutes'
import { POKEDEX_PATH } from '~/utils/pokedex/routes'
import { referenceDetailPath, referenceIndexPath } from '~/utils/reference/routes'

describe('loginRedirect', () => {
  it('exposes canonical login and player-blocked route constants', () => {
    expect(LOGIN_PATH).toBe('/login')
    expect(PLAYER_BLOCKED_REDIRECT_PREFIXES).toEqual([
      GM_PATH,
      ENCOUNTER_GENERATOR_PATH,
      ENCOUNTER_TABLES_PATH,
      PLAYER_PROFILE_MANAGEMENT_PATH,
    ])
  })

  it('accepts only single-slash internal redirects', () => {
    expect(isSafeInternalRedirect('/maps/atrium')).toBe(true)
    expect(isSafeInternalRedirect('//evil.example/path')).toBe(false)
    expect(isSafeInternalRedirect('https://evil.example/path')).toBe(false)
    expect(isSafeInternalRedirect(['/', '/maps'])).toBe(false)
    expect(isSafeInternalRedirect(null)).toBe(false)
  })

  it('detects player-blocked paths and nested routes', () => {
    expect(isPlayerBlockedRedirectPath(GM_PATH)).toBe(true)
    expect(isPlayerBlockedRedirectPath(`${GM_PATH}/campaign`)).toBe(true)
    expect(isPlayerBlockedRedirectPath(ENCOUNTER_GENERATOR_PATH)).toBe(true)
    expect(isPlayerBlockedRedirectPath(`${ENCOUNTER_GENERATOR_PATH}/history`)).toBe(true)
    expect(isPlayerBlockedRedirectPath(ENCOUNTER_TABLES_PATH)).toBe(true)
    expect(isPlayerBlockedRedirectPath(`${ENCOUNTER_TABLES_PATH}/kanto`)).toBe(true)
    expect(isPlayerBlockedRedirectPath(PLAYER_PROFILE_MANAGEMENT_PATH)).toBe(true)
    expect(isPlayerBlockedRedirectPath(`${PLAYER_PROFILE_MANAGEMENT_PATH}/profile_ash00000`)).toBe(true)
    expect(isPlayerBlockedRedirectPath('/maps/generate')).toBe(false)
  })

  it('uses the default route for unsafe redirects', () => {
    expect(resolveLoginRedirectTarget('//evil.example', 'gm')).toBe(DEFAULT_LOGIN_REDIRECT)
    expect(resolveLoginRedirectTarget(undefined, 'player')).toBe(DEFAULT_LOGIN_REDIRECT)
  })

  it('blocks player redirects to GM-only routes while allowing GM redirects', () => {
    expect(resolveLoginRedirectTarget(GM_PATH, 'player')).toBe(DEFAULT_LOGIN_REDIRECT)
    expect(resolveLoginRedirectTarget(ENCOUNTER_GENERATOR_PATH, 'player')).toBe(DEFAULT_LOGIN_REDIRECT)
    expect(resolveLoginRedirectTarget(`${ENCOUNTER_TABLES_PATH}/kanto`, 'player')).toBe(DEFAULT_LOGIN_REDIRECT)
    expect(resolveLoginRedirectTarget(PLAYER_PROFILE_MANAGEMENT_PATH, 'player')).toBe(DEFAULT_LOGIN_REDIRECT)
    expect(resolveLoginRedirectTarget(GM_PATH, 'gm')).toBe(GM_PATH)
    expect(resolveLoginRedirectTarget(ENCOUNTER_GENERATOR_PATH, 'gm')).toBe(ENCOUNTER_GENERATOR_PATH)
    expect(resolveLoginRedirectTarget('/maps/atrium', 'player')).toBe('/maps/atrium')
  })

  it('allows player redirects to map, Pokédex, and reference pages', () => {
    expect(resolveLoginRedirectTarget('/maps/atrium', 'player')).toBe('/maps/atrium')
    expect(resolveLoginRedirectTarget(`${POKEDEX_PATH}/pikachu`, 'player')).toBe(`${POKEDEX_PATH}/pikachu`)
    expect(resolveLoginRedirectTarget(referenceIndexPath('move'), 'player')).toBe('/moves')
    expect(resolveLoginRedirectTarget(referenceDetailPath('rule', 'combat-stages'), 'player')).toBe('/rules/combat-stages')
  })
})
