import { LOGIN_PATH } from '~/utils/appRoutes'

export interface PlayerProfileSwitchRoute {
  readonly path: typeof LOGIN_PATH
  readonly query?: {
    readonly redirect: string
  }
}

export const NO_PLAYER_PROFILE_NAV_LABEL = 'No player profile selected'

export const playerProfileNavStatusText = (displayName: string | null | undefined): string => {
  const trimmedName = displayName?.trim()
  return trimmedName ? `Profile: ${trimmedName}` : NO_PLAYER_PROFILE_NAV_LABEL
}

export const playerProfileSwitchRoute = (
  currentFullPath: string | null | undefined,
): PlayerProfileSwitchRoute => {
  if (!currentFullPath || currentFullPath === LOGIN_PATH || currentFullPath.startsWith(`${LOGIN_PATH}?`)) {
    return { path: LOGIN_PATH }
  }

  return {
    path: LOGIN_PATH,
    query: { redirect: currentFullPath },
  }
}
