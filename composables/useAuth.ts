import { computed } from 'vue'
import { HOME_PATH } from '~/utils/appRoutes'
import {
  AUTH_ROLE_COOKIE,
  AUTH_ROLES,
  authRoleLabel,
  isAuthRole,
  type AuthRole,
} from '~/shared/auth'

export { AUTH_ROLE_COOKIE, AUTH_ROLES, authRoleLabel, isAuthRole, type AuthRole } from '~/shared/auth'

export const useAuth = () => {
  const rawRole = useCookie<AuthRole | null>(AUTH_ROLE_COOKIE, {
    default: () => null,
    maxAge: 60 * 60 * 24 * 30,
    path: HOME_PATH,
    sameSite: 'lax',
  })

  if (rawRole.value !== null && !isAuthRole(rawRole.value)) rawRole.value = null

  const role = computed<AuthRole | null>({
    get: () => (isAuthRole(rawRole.value) ? rawRole.value : null),
    set: (next) => {
      rawRole.value = isAuthRole(next) ? next : null
    },
  })

  const isLoggedIn = computed(() => role.value !== null)
  const isGm = computed(() => role.value === 'gm')
  const isPlayer = computed(() => role.value === 'player')
  const roleLabel = computed(() => authRoleLabel(role.value))

  const loginAs = (next: AuthRole) => {
    role.value = next
  }

  const logout = () => {
    role.value = null
  }

  return {
    role,
    isLoggedIn,
    isGm,
    isPlayer,
    roleLabel,
    loginAs,
    logout,
  }
}
