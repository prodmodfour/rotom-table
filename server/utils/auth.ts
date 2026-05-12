import { createError, getCookie, type H3Event } from 'h3'
import { AUTH_ROLE_COOKIE, isAuthRole, type AuthRole } from '#shared/auth'

export { AUTH_ROLE_COOKIE, isAuthRole, type AuthRole } from '#shared/auth'

export const getAuthRole = (event: H3Event): AuthRole | null => {
  const role = getCookie(event, AUTH_ROLE_COOKIE)
  return isAuthRole(role) ? role : null
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
