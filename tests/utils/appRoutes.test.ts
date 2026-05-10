import { describe, expect, it } from 'vitest'
import { HOME_PATH, LOGIN_PATH, homePath, isHomePath, loginPath } from '~/utils/appRoutes'

describe('app route helpers', () => {
  it('exposes canonical home and login routes', () => {
    expect(HOME_PATH).toBe('/')
    expect(homePath()).toBe('/')
    expect(LOGIN_PATH).toBe('/login')
    expect(loginPath()).toBe('/login')
  })

  it('recognizes only the exact home path', () => {
    expect(isHomePath('/')).toBe(true)
    expect(isHomePath('/maps')).toBe(false)
    expect(isHomePath('/?redirect=/maps')).toBe(false)
  })
})
