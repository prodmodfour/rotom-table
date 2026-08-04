import type { LocationQueryRaw } from 'vue-router'
import { GROUP_INVENTORY_PATH, HOME_PATH, LOGIN_PATH, SESSION_LOBBY_PATH, SETTINGS_PATH } from '~/utils/appRoutes'
import {
  DEFAULT_LOGIN_REDIRECT,
  isPlayerBlockedRedirectPath,
  isSafeInternalRedirect,
} from '~/utils/loginRedirect'
import { MAP_LIBRARY_PATH } from '~/utils/mapRoutes'
import { ENCOUNTER_LIBRARY_PATH } from '#shared/encounterWorkspace/routes'
import { POKEDEX_PATH } from '~/utils/pokedex/routes'
import { PLAYER_TRAINER_PORTAL_PATH } from '~/utils/playerTrainerPortalRoutes'
import { REFERENCE_PATH_BY_KIND } from '~/utils/reference/routes'
import { SHEET_LIBRARY_PATH } from '~/utils/sheetRoutes'
import { SHOP_LIBRARY_PATH } from '~/utils/shopRoutes'

export const PLAYER_PROFILE_REQUIRED_QUERY_KEY = 'profileRequired' as const
export const PLAYER_PROFILE_REQUIRED_QUERY_VALUE = '1' as const

export const PLAYER_PROFILE_REQUIRED_LOGIN_NOTICE =
  'Choose a player profile before opening map token controls or editable character sheets.'

export const PLAYER_PROFILE_OPTIONAL_EXACT_PATHS = [
  HOME_PATH,
  LOGIN_PATH,
  MAP_LIBRARY_PATH,
  ENCOUNTER_LIBRARY_PATH,
  GROUP_INVENTORY_PATH,
  PLAYER_TRAINER_PORTAL_PATH,
  SHOP_LIBRARY_PATH,
  SESSION_LOBBY_PATH,
  SETTINGS_PATH,
] as const

export const PLAYER_PROFILE_OPTIONAL_PATH_PREFIXES = [
  SHOP_LIBRARY_PATH,
  POKEDEX_PATH,
  ...Object.values(REFERENCE_PATH_BY_KIND),
] as const

export const PLAYER_PROFILE_REQUIRED_PATH_PREFIXES = [
  MAP_LIBRARY_PATH,
  ENCOUNTER_LIBRARY_PATH,
  SHEET_LIBRARY_PATH,
] as const

export interface RouteGuardLocation {
  readonly path: string
  readonly query?: LocationQueryRaw
}

export type ProfileAwareRouteGuardDecision =
  | { readonly type: 'allow' }
  | { readonly type: 'login'; readonly location: RouteGuardLocation }
  | { readonly type: 'redirect'; readonly location: string }

export interface ProfileAwareRouteGuardInput {
  readonly path: string
  readonly fullPath?: string
  readonly hasRole: boolean
  readonly isPlayer: boolean
  /**
   * `null`/`undefined` means the browser-only profile selection is not known
   * yet, so the guard should avoid profile-based redirects.
   */
  readonly hasSelectedPlayerProfile?: boolean | null
}

const normalizePath = (path: string): string => {
  const withoutHash = path.split('#', 1)[0] ?? ''
  const withoutQuery = withoutHash.split('?', 1)[0]
  if (!withoutQuery) return HOME_PATH
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) return withoutQuery.replace(/\/+$/, '')
  return withoutQuery
}

const isSameOrNestedPath = (path: string, prefix: string): boolean => (
  path === prefix || path.startsWith(`${prefix}/`)
)

const isNestedPath = (path: string, prefix: string): boolean => path.startsWith(`${prefix}/`)

const safeRedirectTarget = (fullPath: string | undefined): string => {
  if (!fullPath || fullPath === HOME_PATH || !isSafeInternalRedirect(fullPath)) return DEFAULT_LOGIN_REDIRECT
  return fullPath
}

export const playerProfileRequiredLoginRoute = (
  redirectTo: string | undefined,
): RouteGuardLocation => ({
  path: LOGIN_PATH,
  query: {
    redirect: safeRedirectTarget(redirectTo),
    [PLAYER_PROFILE_REQUIRED_QUERY_KEY]: PLAYER_PROFILE_REQUIRED_QUERY_VALUE,
  },
})

export const authRequiredLoginRoute = (
  redirectTo: string | undefined,
): RouteGuardLocation => ({
  path: LOGIN_PATH,
  query: { redirect: safeRedirectTarget(redirectTo) },
})

export const isPlayerProfileOptionalPath = (pathInput: string): boolean => {
  const path = normalizePath(pathInput)
  return PLAYER_PROFILE_OPTIONAL_EXACT_PATHS.some((optionalPath) => path === optionalPath)
    || PLAYER_PROFILE_OPTIONAL_PATH_PREFIXES.some((optionalPrefix) => isSameOrNestedPath(path, optionalPrefix))
}

export const isPlayerProfileRequiredPath = (pathInput: string): boolean => {
  const path = normalizePath(pathInput)
  if (isPlayerProfileOptionalPath(path)) return false
  return PLAYER_PROFILE_REQUIRED_PATH_PREFIXES.some((requiredPrefix) => isNestedPath(path, requiredPrefix))
}

export const profileRequiredLoginNotice = (queryValue: unknown): string | null => {
  if (queryValue === PLAYER_PROFILE_REQUIRED_QUERY_VALUE) return PLAYER_PROFILE_REQUIRED_LOGIN_NOTICE
  if (Array.isArray(queryValue) && queryValue.includes(PLAYER_PROFILE_REQUIRED_QUERY_VALUE)) {
    return PLAYER_PROFILE_REQUIRED_LOGIN_NOTICE
  }
  return null
}

export const resolveProfileAwareRouteGuard = (
  input: ProfileAwareRouteGuardInput,
): ProfileAwareRouteGuardDecision => {
  const path = normalizePath(input.path)
  const fullPath = input.fullPath ?? path

  if (path === LOGIN_PATH) return { type: 'allow' }

  if (!input.hasRole) {
    return { type: 'login', location: authRequiredLoginRoute(fullPath) }
  }

  if (input.isPlayer && isPlayerBlockedRedirectPath(path)) {
    return { type: 'redirect', location: DEFAULT_LOGIN_REDIRECT }
  }

  if (input.isPlayer && path === SHEET_LIBRARY_PATH) {
    return { type: 'redirect', location: PLAYER_TRAINER_PORTAL_PATH }
  }

  if (
    input.isPlayer
    && input.hasSelectedPlayerProfile === false
    && isPlayerProfileRequiredPath(path)
  ) {
    return { type: 'login', location: playerProfileRequiredLoginRoute(fullPath) }
  }

  return { type: 'allow' }
}
