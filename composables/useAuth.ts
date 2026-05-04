import { computed } from 'vue'

export const AUTH_ROLE_COOKIE = 'rotom-role'
export const AUTH_ROLES = ['gm', 'player'] as const

export type AuthRole = (typeof AUTH_ROLES)[number]

export const isAuthRole = (value: unknown): value is AuthRole =>
  value === 'gm' || value === 'player'

export const useAuth = () => {
  const rawRole = useCookie<AuthRole | null>(AUTH_ROLE_COOKIE, {
    default: () => null,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
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
  const roleLabel = computed(() => (role.value === 'gm' ? 'GM' : role.value === 'player' ? 'Player' : 'Guest'))

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
