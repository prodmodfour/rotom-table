import { describe, expect, it } from 'vitest'
import { routeParamAsString, routeSlugParam } from '~/utils/routeParams'

describe('route params', () => {
  it('normalizes missing params to an empty string', () => {
    expect(routeParamAsString(undefined)).toBe('')
    expect(routeParamAsString(null)).toBe('')
    expect(routeSlugParam({})).toBe('')
  })

  it('preserves existing string coercion semantics for route params', () => {
    expect(routeParamAsString('thunderbolt')).toBe('thunderbolt')
    expect(routeParamAsString(42)).toBe('42')
    expect(routeParamAsString(['a', 'b'])).toBe('a,b')
    expect(routeSlugParam({ slug: 'pikachu' })).toBe('pikachu')
  })
})
