import { describe, expect, it } from 'vitest'
import { DeleteMapUseCaseError, normalizeDeleteMapSlug } from '../../server/useCases/deleteMap'

describe('delete map use case input normalization', () => {
  it('rejects invalid slugs with the compatible message', () => {
    expect(() => normalizeDeleteMapSlug('Bad Slug')).toThrow(DeleteMapUseCaseError)
    expect(() => normalizeDeleteMapSlug('Bad Slug')).toThrow('slug must match /^[a-z0-9-]+$/')
  })
})
