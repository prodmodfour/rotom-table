import { MAP_LIBRARY_PATH } from '~/utils/mapRoutes'
import type { AuthRole } from '~/shared/auth'

export const PLAYER_BLOCKED_REDIRECT_PREFIXES = ['/generate', '/encounter-tables'] as const

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
