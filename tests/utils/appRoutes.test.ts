import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_PATH,
  GM_ONLY_PATH_PREFIXES,
  HOME_PATH,
  LOGIN_PATH,
  SESSION_LOBBY_GM_SECTION_ID,
  SESSION_LOBBY_PATH,
  SESSION_LOBBY_PLAYER_SECTION_ID,
  SESSION_LOBBY_REMEMBERED_SECTION_ID,
  SETTINGS_PATH,
  campaignPath,
  homePath,
  isHomePath,
  isSettingsPath,
  loginPath,
  sessionLobbyJoinPath,
  sessionLobbyPath,
  sessionLobbyRememberedPath,
  sessionLobbySectionPath,
  sessionLobbyStartManagePath,
  settingsPath,
} from '~/utils/appRoutes'

describe('app route helpers', () => {
  it('exposes canonical home, login, campaign, settings, and session lobby routes', () => {
    expect(HOME_PATH).toBe('/')
    expect(homePath()).toBe('/')
    expect(LOGIN_PATH).toBe('/login')
    expect(loginPath()).toBe('/login')
    expect(CAMPAIGN_PATH).toBe('/campaign')
    expect(campaignPath()).toBe('/campaign')
    expect(SETTINGS_PATH).toBe('/settings')
    expect(settingsPath()).toBe('/settings')
    expect(GM_ONLY_PATH_PREFIXES).toEqual(['/settings'])
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

  it('recognizes only the exact home path and exact-or-nested settings paths', () => {
    expect(isHomePath('/')).toBe(true)
    expect(isHomePath('/maps')).toBe(false)
    expect(isHomePath('/?redirect=/maps')).toBe(false)
    expect(isSettingsPath('/settings')).toBe(true)
    expect(isSettingsPath('/settings/campaign')).toBe(true)
    expect(isSettingsPath('/settings-tools')).toBe(false)
  })
})
