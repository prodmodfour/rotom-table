import { describe, expect, it } from 'vitest'
import { clampMapGroundLevelY, mapSpecificYBounds, maxGroundLevelY } from '~/utils/mapGroundLevel'

describe('map ground-level helpers', () => {
  it('derives the maximum absolute ground layer from map height', () => {
    expect(maxGroundLevelY(4)).toBe(3)
    expect(maxGroundLevelY(4.9)).toBe(3)
    expect(maxGroundLevelY(1)).toBe(0)
    expect(maxGroundLevelY(0)).toBe(0)
    expect(maxGroundLevelY('bad')).toBe(0)
  })

  it('clamps ground level to finite integer map bounds', () => {
    expect(clampMapGroundLevelY({ y: 4 }, 2.6)).toBe(3)
    expect(clampMapGroundLevelY({ y: 4 }, -2)).toBe(0)
    expect(clampMapGroundLevelY({ y: 4 }, 99)).toBe(3)
    expect(clampMapGroundLevelY({ y: Number.NaN }, 2)).toBe(0)
    expect(clampMapGroundLevelY({ y: 4 }, 'bad')).toBe(0)
  })

  it('reports the map-specific Y range around the ground level', () => {
    expect(mapSpecificYBounds({ y: 5 }, 2)).toEqual({ groundLevelY: 2, min: -2, max: 2 })
    expect(mapSpecificYBounds({ y: 3 }, 99)).toEqual({ groundLevelY: 2, min: -2, max: 0 })
    expect(mapSpecificYBounds({ y: 0 }, 4)).toEqual({ groundLevelY: 0, min: 0, max: 0 })
  })
})
