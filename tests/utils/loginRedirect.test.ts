import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOGIN_REDIRECT,
  isPlayerBlockedRedirectPath,
  isSafeInternalRedirect,
  resolveLoginRedirectTarget,
} from '~/utils/loginRedirect'

describe('loginRedirect', () => {
  it('accepts only single-slash internal redirects', () => {
    expect(isSafeInternalRedirect('/maps/atrium')).toBe(true)
    expect(isSafeInternalRedirect('//evil.example/path')).toBe(false)
    expect(isSafeInternalRedirect('https://evil.example/path')).toBe(false)
    expect(isSafeInternalRedirect(['/', '/maps'])).toBe(false)
    expect(isSafeInternalRedirect(null)).toBe(false)
  })

  it('detects player-blocked paths and nested routes', () => {
    expect(isPlayerBlockedRedirectPath('/generate')).toBe(true)
    expect(isPlayerBlockedRedirectPath('/generate/history')).toBe(true)
    expect(isPlayerBlockedRedirectPath('/encounter-tables')).toBe(true)
    expect(isPlayerBlockedRedirectPath('/encounter-tables/kanto')).toBe(true)
    expect(isPlayerBlockedRedirectPath('/maps/generate')).toBe(false)
  })

  it('uses the default route for unsafe redirects', () => {
    expect(resolveLoginRedirectTarget('//evil.example', 'gm')).toBe(DEFAULT_LOGIN_REDIRECT)
    expect(resolveLoginRedirectTarget(undefined, 'player')).toBe(DEFAULT_LOGIN_REDIRECT)
  })

  it('blocks player redirects to GM-only routes while allowing GM redirects', () => {
    expect(resolveLoginRedirectTarget('/generate', 'player')).toBe(DEFAULT_LOGIN_REDIRECT)
    expect(resolveLoginRedirectTarget('/encounter-tables/kanto', 'player')).toBe(DEFAULT_LOGIN_REDIRECT)
    expect(resolveLoginRedirectTarget('/generate', 'gm')).toBe('/generate')
    expect(resolveLoginRedirectTarget('/maps/atrium', 'player')).toBe('/maps/atrium')
  })
})
