import { describe, expect, it } from 'vitest'
import { MoveMapUseCaseError, normalizeMoveMapFolder, normalizeMoveMapSlug } from '../../server/useCases/moveMap'

describe('move map use case input normalization', () => {
  it('rejects invalid slugs and propagates folder sanitizer errors', () => {
    expect(() => normalizeMoveMapSlug('Bad Slug')).toThrow(MoveMapUseCaseError)
    expect(() => normalizeMoveMapSlug('Bad Slug')).toThrow('slug must match /^[a-z0-9-]+$/')
    expect(() => normalizeMoveMapFolder('../bad', () => {
      throw new Error('Invalid folder path')
    })).toThrow('Invalid folder path')
  })
})
