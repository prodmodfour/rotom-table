export const HOME_PATH = '/'
export const LOGIN_PATH = '/login'
export const SESSION_LOBBY_PATH = '/sessions'

export const homePath = (): typeof HOME_PATH => HOME_PATH

export const loginPath = (): typeof LOGIN_PATH => LOGIN_PATH

export const sessionLobbyPath = (): typeof SESSION_LOBBY_PATH => SESSION_LOBBY_PATH

export const isHomePath = (path: string): boolean => path === HOME_PATH
