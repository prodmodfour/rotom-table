import type { GridAnchor, GridDimensions, SpawnedPokemon } from '~/types/pokemon'

export interface GridFootprint {
  id?: string
  base: number
  clearance?: number
}

export interface PositionedGridFootprint extends GridFootprint {
  position: GridAnchor
}

export const DEFAULT_GRID_DIMENSIONS: GridDimensions = {
  x: 20,
  y: 12,
  z: 20,
}

export const getClearanceValue = (pokemon: Pick<GridFootprint, 'clearance'>) => pokemon.clearance ?? 1

export const clampDimensionValue = (value: number, fallback = 1, max = 200) => {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.min(max, Math.max(1, Math.round(value)))
}

export const normalizeDimensions = (dimensions: GridDimensions): GridDimensions => ({
  x: clampDimensionValue(dimensions.x, DEFAULT_GRID_DIMENSIONS.x),
  y: clampDimensionValue(dimensions.y, DEFAULT_GRID_DIMENSIONS.y),
  z: clampDimensionValue(dimensions.z, DEFAULT_GRID_DIMENSIONS.z),
})

export const getAnchorKey = (position: GridAnchor) => `${position.x},${position.y},${position.z}`

export const isSameAnchor = (left: GridAnchor | null, right: GridAnchor | null) =>
  Boolean(
    left &&
      right &&
      left.x === right.x &&
      left.y === right.y &&
      left.z === right.z,
  )

export const getAnchorCenter = (position: GridAnchor, base: number) => ({
  x: position.x + base / 2,
  y: position.y,
  z: position.z + base / 2,
})

export const getPokemonCenter = (pokemon: Pick<SpawnedPokemon, 'base' | 'position'>) =>
  getAnchorCenter(pokemon.position, pokemon.base)

export const isAnchorWithinBounds = (
  position: GridAnchor,
  pokemon: GridFootprint,
  dimensions: GridDimensions,
) =>
  position.x >= 0 &&
  position.y >= 0 &&
  position.z >= 0 &&
  position.x + pokemon.base <= dimensions.x &&
  position.y + getClearanceValue(pokemon) <= dimensions.y &&
  position.z + pokemon.base <= dimensions.z

export const footprintsOverlap = (
  leftPosition: GridAnchor,
  leftBase: number,
  leftClearance: number,
  rightPosition: GridAnchor,
  rightBase: number,
  rightClearance: number,
) =>
  !(
    leftPosition.x + leftBase <= rightPosition.x ||
    rightPosition.x + rightBase <= leftPosition.x ||
    leftPosition.y + leftClearance <= rightPosition.y ||
    rightPosition.y + rightClearance <= leftPosition.y ||
    leftPosition.z + leftBase <= rightPosition.z ||
    rightPosition.z + rightBase <= leftPosition.z
  )
