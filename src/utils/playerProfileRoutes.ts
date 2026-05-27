export const PLAYER_PROFILE_MANAGEMENT_PATH = '/player-profiles' as const

export const PLAYER_PROFILE_GM_ONLY_PATH_PREFIXES = [
  PLAYER_PROFILE_MANAGEMENT_PATH,
] as const

export const playerProfileManagementPath = (): typeof PLAYER_PROFILE_MANAGEMENT_PATH =>
  PLAYER_PROFILE_MANAGEMENT_PATH

export const isPlayerProfileManagementPath = (path: string): boolean => (
  path === PLAYER_PROFILE_MANAGEMENT_PATH
  || path.startsWith(`${PLAYER_PROFILE_MANAGEMENT_PATH}/`)
)
