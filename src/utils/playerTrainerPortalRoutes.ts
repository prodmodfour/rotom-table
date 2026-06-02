export const PLAYER_TRAINER_PORTAL_PATH = '/trainers' as const

export const playerTrainerPortalPath = (): typeof PLAYER_TRAINER_PORTAL_PATH =>
  PLAYER_TRAINER_PORTAL_PATH

export const isPlayerTrainerPortalPath = (path: string): boolean => (
  path === PLAYER_TRAINER_PORTAL_PATH
  || path.startsWith(`${PLAYER_TRAINER_PORTAL_PATH}/`)
)
