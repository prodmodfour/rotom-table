import type { AuthRole } from '#shared/auth'
import { GM_ONLY_PATH_PREFIXES } from '~/utils/appRoutes'
import { ENCOUNTER_GM_ONLY_PATH_PREFIXES } from '~/utils/encounterRoutes'
import { MAP_LIBRARY_PATH } from '~/utils/mapRoutes'
import { PLAYER_PROFILE_GM_ONLY_PATH_PREFIXES } from '~/utils/playerProfileRoutes'

export const PLAYER_BLOCKED_REDIRECT_PREFIXES = [
  ...GM_ONLY_PATH_PREFIXES,
  ...ENCOUNTER_GM_ONLY_PATH_PREFIXES,
  ...PLAYER_PROFILE_GM_ONLY_PATH_PREFIXES,
] as const

export const DEFAULT_LOGIN_REDIRECT = MAP_LIBRARY_PATH

export const isSafeInternalRedirect = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')

export const isPlayerBlockedRedirectPath = (
  path: string,
  blockedPrefixes: readonly string[] = PLAYER_BLOCKED_REDIRECT_PREFIXES,
): boolean =>
  blockedPrefixes.some((blocked) => path === blocked || path.startsWith(`${blocked}/`))

export const resolveLoginRedirectTarget = (
  rawRedirect: unknown,
  nextRole: AuthRole,
  options: {
    defaultTarget?: string
    playerBlockedPrefixes?: readonly string[]
  } = {},
): string => {
  const defaultTarget = options.defaultTarget ?? DEFAULT_LOGIN_REDIRECT
  const target = isSafeInternalRedirect(rawRedirect) ? rawRedirect : defaultTarget
  if (nextRole === 'player' && isPlayerBlockedRedirectPath(target, options.playerBlockedPrefixes)) {
    return defaultTarget
  }
  return target
}
