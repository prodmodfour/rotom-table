import { describe, expect, it } from 'vitest'
import {
  HOME_PATH,
  LOGIN_PATH,
  SESSION_LOBBY_PATH,
  homePath,
  isHomePath,
  loginPath,
  sessionLobbyPath,
} from '~/utils/appRoutes'

describe('app route helpers', () => {
  it('exposes canonical home, login, and session lobby routes', () => {
    expect(HOME_PATH).toBe('/')
    expect(homePath()).toBe('/')
    expect(LOGIN_PATH).toBe('/login')
    expect(loginPath()).toBe('/login')
    expect(SESSION_LOBBY_PATH).toBe('/sessions')
    expect(sessionLobbyPath()).toBe('/sessions')
  })

  it('recognizes only the exact home path', () => {
    expect(isHomePath('/')).toBe(true)
    expect(isHomePath('/maps')).toBe(false)
    expect(isHomePath('/?redirect=/maps')).toBe(false)
  })
})
