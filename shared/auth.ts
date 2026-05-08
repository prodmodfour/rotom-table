export const AUTH_ROLE_COOKIE = 'rotom-role'
export const AUTH_ROLES = ['gm', 'player'] as const

export type AuthRole = (typeof AUTH_ROLES)[number]

const AUTH_ROLE_SET = new Set<unknown>(AUTH_ROLES)

export const isAuthRole = (value: unknown): value is AuthRole => AUTH_ROLE_SET.has(value)

export const authRoleLabel = (role: AuthRole | null): 'GM' | 'Player' | 'Guest' => {
  if (role === 'gm') return 'GM'
  if (role === 'player') return 'Player'
  return 'Guest'
}
