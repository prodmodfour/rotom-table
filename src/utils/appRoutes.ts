export const HOME_PATH = '/'
export const LOGIN_PATH = '/login'
export const CAMPAIGN_PATH = '/campaign'
export const SETTINGS_PATH = '/settings'
export const USEFUL_CHARTS_PATH = '/useful-charts'
export const SESSION_LOBBY_PATH = '/sessions'
export const SESSION_LOBBY_GM_SECTION_ID = 'gm-lobby-title'
export const SESSION_LOBBY_PLAYER_SECTION_ID = 'player-lobby-title'
export const SESSION_LOBBY_REMEMBERED_SECTION_ID = 'remembered-session-title'

export type SessionLobbySection = 'gm' | 'player' | 'remembered'

const SESSION_LOBBY_SECTION_IDS: Record<SessionLobbySection, string> = {
  gm: SESSION_LOBBY_GM_SECTION_ID,
  player: SESSION_LOBBY_PLAYER_SECTION_ID,
  remembered: SESSION_LOBBY_REMEMBERED_SECTION_ID,
}

export const homePath = (): typeof HOME_PATH => HOME_PATH

export const loginPath = (): typeof LOGIN_PATH => LOGIN_PATH

export const campaignPath = (): typeof CAMPAIGN_PATH => CAMPAIGN_PATH

export const settingsPath = (): typeof SETTINGS_PATH => SETTINGS_PATH

export const usefulChartsPath = (): typeof USEFUL_CHARTS_PATH => USEFUL_CHARTS_PATH

export const sessionLobbyPath = (): typeof SESSION_LOBBY_PATH => SESSION_LOBBY_PATH

export const sessionLobbySectionPath = (section: SessionLobbySection): string =>
  `${SESSION_LOBBY_PATH}#${SESSION_LOBBY_SECTION_IDS[section]}`

export const sessionLobbyStartManagePath = (): string => sessionLobbySectionPath('gm')

export const sessionLobbyJoinPath = (): string => sessionLobbySectionPath('player')

export const sessionLobbyRememberedPath = (): string => sessionLobbySectionPath('remembered')

export const GM_ONLY_PATH_PREFIXES = [
  CAMPAIGN_PATH,
  SETTINGS_PATH,
] as const

export const isHomePath = (path: string): boolean => path === HOME_PATH

export const isSettingsPath = (path: string): boolean => (
  path === SETTINGS_PATH || path.startsWith(`${SETTINGS_PATH}/`)
)
