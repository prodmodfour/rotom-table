import { describe, expect, it } from 'vitest'
import { authRoleLabel, isAuthRole } from '../../shared/auth'

describe('shared auth', () => {
  it('accepts only supported auth roles', () => {
    expect(isAuthRole('gm')).toBe(true)
    expect(isAuthRole('player')).toBe(true)
    expect(isAuthRole('guest')).toBe(false)
    expect(isAuthRole('')).toBe(false)
    expect(isAuthRole(null)).toBe(false)
    expect(isAuthRole({ role: 'gm' })).toBe(false)
  })

  it('returns stable role labels', () => {
    expect(authRoleLabel('gm')).toBe('GM')
    expect(authRoleLabel('player')).toBe('Player')
    expect(authRoleLabel(null)).toBe('Guest')
  })
})
