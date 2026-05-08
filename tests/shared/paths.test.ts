import { describe, expect, it } from 'vitest'
import { sanitizeFolderPath, validateSlug } from '../../shared/paths'

describe('shared path validation', () => {
  it('validates slugs', () => {
    expect(validateSlug('route-1')).toBe('route-1')
    expect(() => validateSlug('Route-1')).toThrow('slug must match /^[a-z0-9-]+$/')
    expect(() => validateSlug('../route')).toThrow('slug must match /^[a-z0-9-]+$/')
  })

  it('sanitizes safe nested folders', () => {
    expect(sanitizeFolderPath('/team_alpha/session-01/')).toBe('team_alpha/session-01')
    expect(sanitizeFolderPath('', { allowEmpty: true })).toBe('')
  })

  it('rejects unsafe folders and path traversal', () => {
    for (const value of ['..', '../x', 'x/../y', 'bad folder', 'x//y', 'x/.hidden', 'x\\y', '']) {
      expect(() => sanitizeFolderPath(value)).toThrow()
    }
  })
})
