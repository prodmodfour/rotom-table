import { describe, expect, it } from 'vitest'
import { LOGIN_PATH } from '~/utils/appRoutes'
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

describe('loginRedirect', () => {
  it('exposes canonical login and player-blocked route constants', () => {
    expect(LOGIN_PATH).toBe('/login')
    expect(PLAYER_BLOCKED_REDIRECT_PREFIXES).toEqual([
      ENCOUNTER_GENERATOR_PATH,
      ENCOUNTER_TABLES_PATH,
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
    expect(isPlayerBlockedRedirectPath(ENCOUNTER_GENERATOR_PATH)).toBe(true)
    expect(isPlayerBlockedRedirectPath(`${ENCOUNTER_GENERATOR_PATH}/history`)).toBe(true)
    expect(isPlayerBlockedRedirectPath(ENCOUNTER_TABLES_PATH)).toBe(true)
    expect(isPlayerBlockedRedirectPath(`${ENCOUNTER_TABLES_PATH}/kanto`)).toBe(true)
    expect(isPlayerBlockedRedirectPath('/maps/generate')).toBe(false)
  })

  it('uses the default route for unsafe redirects', () => {
    expect(resolveLoginRedirectTarget('//evil.example', 'gm')).toBe(DEFAULT_LOGIN_REDIRECT)
    expect(resolveLoginRedirectTarget(undefined, 'player')).toBe(DEFAULT_LOGIN_REDIRECT)
  })

  it('blocks player redirects to GM-only routes while allowing GM redirects', () => {
    expect(resolveLoginRedirectTarget(ENCOUNTER_GENERATOR_PATH, 'player')).toBe(DEFAULT_LOGIN_REDIRECT)
    expect(resolveLoginRedirectTarget(`${ENCOUNTER_TABLES_PATH}/kanto`, 'player')).toBe(DEFAULT_LOGIN_REDIRECT)
    expect(resolveLoginRedirectTarget(ENCOUNTER_GENERATOR_PATH, 'gm')).toBe(ENCOUNTER_GENERATOR_PATH)
    expect(resolveLoginRedirectTarget('/maps/atrium', 'player')).toBe('/maps/atrium')
  })
})
