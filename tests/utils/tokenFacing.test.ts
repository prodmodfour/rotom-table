import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOKEN_FACING_DIRECTION,
  nextTokenFacingForPlacement,
  setTokenFacingOnPlacement,
  tokenFacingForPlacement,
  tokenFacingFromAreaDirection,
  tokenFacingStoresLegacyTurned,
  tokenFacingTowardPoint,
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

  it('derives facing from points and keeps cardinal directions on the existing side', () => {
    expect(tokenFacingTowardPoint({ x: 0, z: 0 }, { x: 2, z: -1 }, 'south-east')).toBe('north-east')
    expect(tokenFacingTowardPoint({ x: 0, z: 0 }, { x: 0, z: -1 }, 'south-west')).toBe('north-west')
    expect(tokenFacingTowardPoint({ x: 0, z: 0 }, { x: 0, z: 0 }, 'south-east')).toBeNull()
    expect(tokenFacingFromAreaDirection('west', 'north-east')).toBe('north-west')
  })

  it('keeps the legacy turned flag tied to the old north-west back view', () => {
    expect(tokenFacingStoresLegacyTurned('north-west')).toBe(true)
    expect(tokenFacingStoresLegacyTurned('north-east')).toBe(false)
    expect(tokenFacingVector('north-east')).toEqual({ x: 1, y: -1 })

    const placement = { facing: 'south-east' as const, turned: false }
    setTokenFacingOnPlacement(placement, 'north-west')
    expect(placement).toEqual({ facing: 'north-west', turned: true })
  })
})
