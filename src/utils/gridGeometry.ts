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

const cloneGridAnchor = (position: GridAnchor): GridAnchor => ({
  x: position.x,
  y: position.y,
  z: position.z,
})

/**
 * Enumerate the occupied cells for one validated footprint in stable
 * y/z/x order. Callers remain responsible for validating the anchor and
 * footprint before using this geometry as game authority.
 */
export const gridFootprintCells = (
  position: GridAnchor,
  footprint: GridFootprint,
): GridAnchor[] => {
  const cells: GridAnchor[] = []
  const base = Math.max(0, Math.trunc(footprint.base))
  const clearance = Math.max(0, Math.trunc(getClearanceValue(footprint)))

  for (let y = position.y; y < position.y + clearance; y += 1) {
    for (let z = position.z; z < position.z + base; z += 1) {
      for (let x = position.x; x < position.x + base; x += 1) {
        cells.push({ x, y, z })
      }
    }
  }

  return cells
}

export interface GridFootprintTransition {
  readonly fromCells: readonly GridAnchor[]
  readonly toCells: readonly GridAnchor[]
  readonly leftCells: readonly GridAnchor[]
  readonly enteredCells: readonly GridAnchor[]
}

/** Derive exact footprint occupancy changes for one movement step. */
export const gridFootprintTransition = (
  from: GridAnchor,
  to: GridAnchor,
  footprint: GridFootprint,
): GridFootprintTransition => {
  const fromCells = gridFootprintCells(from, footprint)
  const toCells = gridFootprintCells(to, footprint)
  const fromKeys = new Set(fromCells.map(getAnchorKey))
  const toKeys = new Set(toCells.map(getAnchorKey))

  return {
    fromCells: fromCells.map(cloneGridAnchor),
    toCells: toCells.map(cloneGridAnchor),
    leftCells: fromCells.filter(cell => !toKeys.has(getAnchorKey(cell))).map(cloneGridAnchor),
    enteredCells: toCells.filter(cell => !fromKeys.has(getAnchorKey(cell))).map(cloneGridAnchor),
  }
}

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
