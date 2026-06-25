import { describe, expect, it } from 'vitest'
import {
  CreateMapUseCaseError,
  DEFAULT_MAP_DIMENSIONS,
  normalizeCreateMapDimensions,
  normalizeCreateMapName,
} from '../../server/useCases/createMap'

describe('create map use case input normalization', () => {
  it('normalizes default map names and dimensions', () => {
    expect(normalizeCreateMapName('   ')).toBe('Untitled Map')
    expect(normalizeCreateMapDimensions({ x: 0, y: 1.6, z: 9999 })).toEqual({ x: 1, y: 2, z: 200 })
    expect(normalizeCreateMapDimensions(42)).toEqual(DEFAULT_MAP_DIMENSIONS)
  })

  it('rejects names longer than the persisted map-name limit', () => {
    expect(() => normalizeCreateMapName('x'.repeat(81))).toThrow(CreateMapUseCaseError)
    expect(() => normalizeCreateMapName('x'.repeat(81))).toThrow('name too long (max 80 chars)')
  })
})
