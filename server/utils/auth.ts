import { createError, getCookie, type H3Event } from 'h3'

export const AUTH_ROLE_COOKIE = 'rotom-role'
export type AuthRole = 'gm' | 'player'

export const getAuthRole = (event: H3Event): AuthRole | null => {
  const role = getCookie(event, AUTH_ROLE_COOKIE)
  return role === 'gm' || role === 'player' ? role : null
}

export const requireAuthRole = (event: H3Event): AuthRole => {
  const role = getAuthRole(event)
  if (!role) {
    throw createError({ statusCode: 401, statusMessage: 'Login required' })
  }
  return role
}

export const requireGm = (event: H3Event): AuthRole => {
  const role = requireAuthRole(event)
  if (role !== 'gm') {
    throw createError({ statusCode: 403, statusMessage: 'GM login required' })
  }
  return role
}
