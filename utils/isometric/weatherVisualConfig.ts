import type { GridDimensions } from '~/types/pokemon'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const horizontalArea = (dimensions: GridDimensions): number =>
  dimensions.x * dimensions.z

export const layeredSunRayOpacityScale = (totalWeatherLayers: number): number =>
  totalWeatherLayers > 1 ? 0.65 : 1

export const layeredSandRibbonOpacityScale = layeredSunRayOpacityScale

export const rainDensityScale = (totalWeatherLayers: number): number =>
  totalWeatherLayers > 1 ? 0.72 : 1

export const hailDensityScale = (totalWeatherLayers: number): number =>
  totalWeatherLayers > 1 ? 0.75 : 1

export const sandMoteDensityScale = hailDensityScale

export const SAND_RIBBON_COUNT = 4

export const sunRayCountForDimensions = (dimensions: GridDimensions): number =>
  Math.round(clamp(dimensions.x * 0.45 + 3, 5, 10))

export const rainDropCountForDimensions = (
  dimensions: GridDimensions,
  totalWeatherLayers: number,
): number =>
  Math.round(
    clamp(horizontalArea(dimensions) * 3.4, 100, 320) *
      rainDensityScale(totalWeatherLayers),
  )

export const hailParticleCountForDimensions = (
  dimensions: GridDimensions,
  totalWeatherLayers: number,
): number =>
  Math.round(
    clamp(horizontalArea(dimensions) * 1.55, 64, 180) *
      hailDensityScale(totalWeatherLayers),
  )

export const sandMoteCountForDimensions = (
  dimensions: GridDimensions,
  totalWeatherLayers: number,
): number =>
  Math.round(
    clamp(horizontalArea(dimensions) * 2.15, 90, 260) *
      sandMoteDensityScale(totalWeatherLayers),
  )
