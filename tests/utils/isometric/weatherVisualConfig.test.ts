import { describe, expect, it } from 'vitest'
import {
  SAND_RIBBON_COUNT,
  hailDensityScale,
  hailParticleCountForDimensions,
  layeredSandRibbonOpacityScale,
  layeredSunRayOpacityScale,
  rainDensityScale,
  rainDropCountForDimensions,
  sandMoteCountForDimensions,
  sandMoteDensityScale,
  sunRayCountForDimensions,
} from '~/utils/isometric/weatherVisualConfig'

const dimensions = (x: number, z: number) => ({ x, y: 4, z })

describe('weather visual config', () => {
  it('derives sun ray counts and layered opacity without Three.js state', () => {
    expect(sunRayCountForDimensions(dimensions(1, 12))).toBe(5)
    expect(sunRayCountForDimensions(dimensions(8, 12))).toBe(7)
    expect(sunRayCountForDimensions(dimensions(30, 12))).toBe(10)
    expect(layeredSunRayOpacityScale(1)).toBe(1)
    expect(layeredSunRayOpacityScale(2)).toBe(0.65)
    expect(layeredSandRibbonOpacityScale(3)).toBe(0.65)
  })

  it('clamps precipitation particle counts before applying layered density scales', () => {
    expect(rainDensityScale(1)).toBe(1)
    expect(rainDensityScale(2)).toBe(0.72)
    expect(rainDropCountForDimensions(dimensions(2, 2), 1)).toBe(100)
    expect(rainDropCountForDimensions(dimensions(20, 20), 1)).toBe(320)
    expect(rainDropCountForDimensions(dimensions(20, 20), 2)).toBe(230)

    expect(hailDensityScale(1)).toBe(1)
    expect(hailDensityScale(2)).toBe(0.75)
    expect(hailParticleCountForDimensions(dimensions(2, 2), 1)).toBe(64)
    expect(hailParticleCountForDimensions(dimensions(20, 20), 2)).toBe(135)
  })

  it('keeps sandstorm ribbon and mote density rules explicit', () => {
    expect(SAND_RIBBON_COUNT).toBe(4)
    expect(sandMoteDensityScale(1)).toBe(1)
    expect(sandMoteDensityScale(2)).toBe(0.75)
    expect(sandMoteCountForDimensions(dimensions(2, 2), 1)).toBe(90)
    expect(sandMoteCountForDimensions(dimensions(20, 20), 1)).toBe(260)
    expect(sandMoteCountForDimensions(dimensions(20, 20), 2)).toBe(195)
  })
})
