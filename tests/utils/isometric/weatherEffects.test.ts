import { describe, expect, it } from 'vitest'
import {
  getWeatherBounds,
  randomRange,
  seededWeatherRandom,
  wrapRange,
} from '~/utils/isometric/weatherEffects'

const round = (value: number) => Number(value.toFixed(6))

describe('weatherEffects', () => {
  it('creates deterministic seeded random sequences', () => {
    const first = seededWeatherRandom('rainy:8x4x8:0')
    const second = seededWeatherRandom('rainy:8x4x8:0')
    const other = seededWeatherRandom('sunny:8x4x8:0')

    const firstSequence = Array.from({ length: 4 }, () => round(first()))
    const secondSequence = Array.from({ length: 4 }, () => round(second()))
    const otherSequence = Array.from({ length: 4 }, () => round(other()))

    expect(firstSequence).toEqual(secondSequence)
    expect(firstSequence).not.toEqual(otherSequence)
    expect(firstSequence.every((value) => value >= 0 && value < 1)).toBe(true)
  })

  it('scales random ranges and wraps bounded values', () => {
    expect(randomRange(() => 0.25, 10, 18)).toBe(12)
    expect(wrapRange(12.5, 0, 10)).toBeCloseTo(2.5)
    expect(wrapRange(-2, 0, 10)).toBeCloseTo(8)
    expect(wrapRange(4, 3, 3)).toBe(3)
  })

  it('derives weather bounds from map dimensions, voxels, and ground level', () => {
    const bounds = getWeatherBounds({
      dimensions: { x: 10, y: 4, z: 6 },
      groundLevelY: 1,
      voxels: [
        { x: 0, y: 1, z: 0, materialId: 'grass' },
        { x: 4, y: 3, z: 2, materialId: 'stone' },
      ],
    })

    expect(bounds.minX).toBeCloseTo(-2.2)
    expect(bounds.maxX).toBeCloseTo(12.2)
    expect(bounds.minZ).toBeCloseTo(-2.2)
    expect(bounds.maxZ).toBeCloseTo(8.2)
    expect(bounds.centerX).toBe(5)
    expect(bounds.centerZ).toBe(3)
    expect(bounds.groundY).toBe(1)
    expect(bounds.topY).toBeCloseTo(7.2)
    expect(bounds.width).toBeCloseTo(14.4)
    expect(bounds.depth).toBeCloseTo(10.4)
    expect(bounds.height).toBeCloseTo(6.2)
  })

  it('uses minimum weather margins and map-height top bounds for small empty maps', () => {
    const bounds = getWeatherBounds({
      dimensions: { x: 2, y: 6, z: 2 },
      groundLevelY: -1,
      voxels: [],
    })

    expect(bounds.minX).toBeCloseTo(-1.4)
    expect(bounds.maxX).toBeCloseTo(3.4)
    expect(bounds.topY).toBeCloseTo(6.5)
    expect(bounds.height).toBeCloseTo(7.5)
  })
})
