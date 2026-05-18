import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOKEN_FACING_DIRECTION,
  nextTokenFacingForPlacement,
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
  tokenFacingVector,
} from '~/utils/tokenFacing'

describe('token facing helpers', () => {
  it('normalizes explicit and legacy placement facing values', () => {
    expect(tokenFacingForPlacement({ facing: 'south-west', turned: true })).toBe('south-west')
    expect(tokenFacingForPlacement({ turned: true })).toBe('north-west')
    expect(tokenFacingForPlacement({ turned: false })).toBe(DEFAULT_TOKEN_FACING_DIRECTION)
    expect(tokenFacingForPlacement({ facing: 'sideways' })).toBe(DEFAULT_TOKEN_FACING_DIRECTION)
  })

  it('cycles through the four isometric facing directions', () => {
    expect(nextTokenFacingForPlacement({ facing: 'south-east' })).toBe('north-east')
    expect(nextTokenFacingForPlacement({ facing: 'north-east' })).toBe('north-west')
    expect(nextTokenFacingForPlacement({ facing: 'north-west' })).toBe('south-west')
    expect(nextTokenFacingForPlacement({ facing: 'south-west' })).toBe('south-east')
  })

  it('keeps the legacy turned flag tied to the old north-west back view', () => {
    expect(tokenFacingStoresLegacyTurned('north-west')).toBe(true)
    expect(tokenFacingStoresLegacyTurned('north-east')).toBe(false)
    expect(tokenFacingVector('north-east')).toEqual({ x: 1, y: -1 })
  })
})
