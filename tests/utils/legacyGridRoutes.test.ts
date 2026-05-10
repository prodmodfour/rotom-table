import { describe, expect, it } from 'vitest'
import { legacyGridDetailRedirectPath, legacyGridIndexRedirectPath } from '~/utils/legacyGridRoutes'

describe('legacy grid routes', () => {
  it('redirects the grid index to the map library', () => {
    expect(legacyGridIndexRedirectPath()).toBe('/maps')
  })

  it('redirects grid detail slugs to map detail routes with existing coercion semantics', () => {
    expect(legacyGridDetailRedirectPath('airship')).toBe('/maps/airship')
    expect(legacyGridDetailRedirectPath(undefined)).toBe('/maps/')
    expect(legacyGridDetailRedirectPath(['one', 'two'])).toBe('/maps/one,two')
  })
})
