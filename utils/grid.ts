import type { GridAnchor, GridDimensions, SpawnedPokemon } from '~/types/pokemon'

interface PokemonFootprint {
  id?: string
  base: number
  clearance?: number
  position: GridAnchor
}

interface FootprintPokemon {
  id?: string
  base: number
  clearance?: number
}

export interface PreviewState {
  position: GridAnchor | null
  reachable: boolean
  pathLength: number
}

const DIRECTIONS: GridAnchor[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
]

export const DEFAULT_GRID_DIMENSIONS: GridDimensions = {
  x: 20,
  y: 12,
  z: 20,
}

const getClearanceValue = (pokemon: Pick<FootprintPokemon, 'clearance'>) => pokemon.clearance ?? 1

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
  pokemon: FootprintPokemon,
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

export const canPlacePokemon = (
  pokemon: FootprintPokemon,
  position: GridAnchor,
  pokemons: PokemonFootprint[],
  dimensions: GridDimensions,
  exceptId?: string | null,
) => {
  if (!isAnchorWithinBounds(position, pokemon, dimensions)) {
    return false
  }

  return pokemons.every((other) => {
    if (other.id && other.id === exceptId) {
      return true
    }

    return !footprintsOverlap(
      position,
      pokemon.base,
      getClearanceValue(pokemon),
      other.position,
      other.base,
      getClearanceValue(other),
    )
  })
}

const buildCenterWeightedAnchors = (pokemon: FootprintPokemon, dimensions: GridDimensions) => {
  const maxX = dimensions.x - pokemon.base
  const maxY = dimensions.y - getClearanceValue(pokemon)
  const maxZ = dimensions.z - pokemon.base

  if (maxX < 0 || maxY < 0 || maxZ < 0) {
    return []
  }

  const anchors: Array<{ x: number; y: number; z: number; distance: number }> = []
  const centerX = maxX / 2
  const centerZ = maxZ / 2

  for (let y = 0; y <= maxY; y += 1) {
    for (let z = 0; z <= maxZ; z += 1) {
      for (let x = 0; x <= maxX; x += 1) {
        anchors.push({
          x,
          y,
          z,
          distance: Math.abs(x - centerX) + Math.abs(z - centerZ),
        })
      }
    }
  }

  anchors.sort((left, right) => {
    if (left.y !== right.y) {
      return left.y - right.y
    }

    if (left.distance !== right.distance) {
      return left.distance - right.distance
    }

    if (left.z !== right.z) {
      return left.z - right.z
    }

    return left.x - right.x
  })

  return anchors
}

export const findFirstAvailablePosition = (
  pokemon: FootprintPokemon,
  pokemons: PokemonFootprint[],
  dimensions: GridDimensions,
  exceptId?: string | null,
) => {
  const anchors = buildCenterWeightedAnchors(pokemon, dimensions)

  for (const anchor of anchors) {
    const position = { x: anchor.x, y: anchor.y, z: anchor.z }

    if (canPlacePokemon(pokemon, position, pokemons, dimensions, exceptId)) {
      return position
    }
  }

  return null
}

export const findPathForPokemon = (
  pokemon: FootprintPokemon,
  start: GridAnchor,
  goal: GridAnchor,
  pokemons: PokemonFootprint[],
  dimensions: GridDimensions,
  exceptId?: string | null,
) => {
  if (!isAnchorWithinBounds(start, pokemon, dimensions)) {
    return null
  }

  if (!canPlacePokemon(pokemon, goal, pokemons, dimensions, exceptId)) {
    return null
  }

  const queue: GridAnchor[] = [start]
  const visited = new Set<string>([getAnchorKey(start)])
  const cameFrom = new Map<string, GridAnchor | null>([[getAnchorKey(start), null]])

  while (queue.length > 0) {
    const current = queue.shift()!

    if (current.x === goal.x && current.y === goal.y && current.z === goal.z) {
      break
    }

    for (const direction of DIRECTIONS) {
      const next = {
        x: current.x + direction.x,
        y: current.y + direction.y,
        z: current.z + direction.z,
      }
      const nextKey = getAnchorKey(next)

      if (visited.has(nextKey)) {
        continue
      }

      if (!canPlacePokemon(pokemon, next, pokemons, dimensions, exceptId)) {
        continue
      }

      visited.add(nextKey)
      cameFrom.set(nextKey, current)
      queue.push(next)
    }
  }

  if (!cameFrom.has(getAnchorKey(goal))) {
    return null
  }

  const path: GridAnchor[] = []
  let current: GridAnchor | null = goal

  while (current) {
    path.push(current)
    current = cameFrom.get(getAnchorKey(current)) ?? null
  }

  return path.reverse()
}

export const reconcilePokemonPositions = (
  pokemons: SpawnedPokemon[],
  dimensions: GridDimensions,
) => {
  const nextPokemons: SpawnedPokemon[] = []
  const removedIds: string[] = []

  for (const pokemon of pokemons) {
    const currentPosition = canPlacePokemon(pokemon, pokemon.position, nextPokemons, dimensions)
      ? pokemon.position
      : null

    const fallbackPosition =
      currentPosition ?? findFirstAvailablePosition(pokemon, nextPokemons, dimensions)

    if (!fallbackPosition) {
      removedIds.push(pokemon.id)
      continue
    }

    nextPokemons.push({
      ...pokemon,
      position: fallbackPosition,
    })
  }

  return {
    pokemons: nextPokemons,
    removedIds,
  }
}
