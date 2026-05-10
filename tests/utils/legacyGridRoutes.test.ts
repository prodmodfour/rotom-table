import { describe, expect, it } from 'vitest'
import {
  LEGACY_GRID_PATH,
  isLegacyGridPath,
  legacyGridDetailRedirectPath,
  legacyGridIndexRedirectPath,
} from '~/utils/legacyGridRoutes'

describe('legacy grid routes', () => {
  it('exposes the canonical legacy grid path predicate', () => {
    expect(LEGACY_GRID_PATH).toBe('/grids')
    expect(isLegacyGridPath('/grids')).toBe(true)
    expect(isLegacyGridPath('/grids/airship')).toBe(true)
    expect(isLegacyGridPath('/maps/grids')).toBe(false)
  })

  it('redirects the grid index to the map library', () => {
    expect(legacyGridIndexRedirectPath()).toBe('/maps')
  })

  it('redirects grid detail slugs to map detail routes with existing coercion semantics', () => {
    expect(legacyGridDetailRedirectPath('airship')).toBe('/maps/airship')
    expect(legacyGridDetailRedirectPath(undefined)).toBe('/maps/')
    expect(legacyGridDetailRedirectPath(['one', 'two'])).toBe('/maps/one,two')
  })
})
