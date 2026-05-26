import { describe, expect, it } from 'vitest'
import {
  HOME_PATH,
  LOGIN_PATH,
  SESSION_LOBBY_GM_SECTION_ID,
  SESSION_LOBBY_PATH,
  SESSION_LOBBY_PLAYER_SECTION_ID,
  SESSION_LOBBY_REMEMBERED_SECTION_ID,
  homePath,
  isHomePath,
  loginPath,
  sessionLobbyJoinPath,
  sessionLobbyPath,
  sessionLobbyRememberedPath,
  sessionLobbySectionPath,
  sessionLobbyStartManagePath,
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

  it('builds stable hash links to session lobby start, join, and remembered-identity sections', () => {
    expect(SESSION_LOBBY_GM_SECTION_ID).toBe('gm-lobby-title')
    expect(SESSION_LOBBY_PLAYER_SECTION_ID).toBe('player-lobby-title')
    expect(SESSION_LOBBY_REMEMBERED_SECTION_ID).toBe('remembered-session-title')
    expect(sessionLobbySectionPath('gm')).toBe('/sessions#gm-lobby-title')
    expect(sessionLobbyStartManagePath()).toBe('/sessions#gm-lobby-title')
    expect(sessionLobbyJoinPath()).toBe('/sessions#player-lobby-title')
    expect(sessionLobbyRememberedPath()).toBe('/sessions#remembered-session-title')
  })

  it('recognizes only the exact home path', () => {
    expect(isHomePath('/')).toBe(true)
    expect(isHomePath('/maps')).toBe(false)
    expect(isHomePath('/?redirect=/maps')).toBe(false)
  })
})
