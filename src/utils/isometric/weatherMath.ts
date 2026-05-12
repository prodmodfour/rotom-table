import type { GridDimensions } from '~/types/pokemon'
import type { MapVoxelV2 } from '~/types/map'

export interface WeatherBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  centerX: number
  centerZ: number
  groundY: number
  topY: number
  width: number
  depth: number
  height: number
}

export interface WeatherEffectRendererInput {
  dimensions: GridDimensions
  voxels: ReadonlyArray<MapVoxelV2>
  groundLevelY: number
}

export const seededWeatherRandom = (seed: string) => {
  let state = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    state = Math.imul(state ^ seed.charCodeAt(i), 16777619) >>> 0
  }

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const randomRange = (rand: () => number, min: number, max: number) =>
  min + (max - min) * rand()

export const wrapRange = (value: number, min: number, max: number) => {
  const size = max - min
  if (size <= 0) return min
  return min + ((((value - min) % size) + size) % size)
}

export const getWeatherBounds = (
  input: WeatherEffectRendererInput,
): WeatherBounds => {
  const groundY = input.groundLevelY
  let highestY = groundY
  for (const voxel of input.voxels) {
    highestY = Math.max(highestY, voxel.y + 1)
  }

  const maxMapSide = Math.max(input.dimensions.x, input.dimensions.z)
  const margin = Math.max(1.4, Math.min(5, maxMapSide * 0.22))
  const topY = Math.max(
    highestY + 3.2,
    groundY + Math.max(4.5, input.dimensions.y + 1.5),
  )
  const minX = -margin
  const maxX = input.dimensions.x + margin
  const minZ = -margin
  const maxZ = input.dimensions.z + margin

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: input.dimensions.x / 2,
    centerZ: input.dimensions.z / 2,
    groundY,
    topY,
    width: maxX - minX,
    depth: maxZ - minZ,
    height: topY - groundY,
  }
}
