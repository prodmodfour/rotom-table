import type { GridAnchor, GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import type { MapVoxelV2 } from '~/types/map'
import { buildVoxelOccupancy, footprintOverlapsVoxels } from './voxelOccupancy'
import {
  footprintsOverlap,
  getClearanceValue,
  isAnchorWithinBounds,
  type GridFootprint,
  type PositionedGridFootprint,
} from './gridGeometry'

const EMPTY_VOXEL_KEYS: ReadonlySet<string> = new Set<string>()

export const canPlacePokemon = (
  pokemon: GridFootprint,
  position: GridAnchor,
  pokemons: PositionedGridFootprint[],
  dimensions: GridDimensions,
  exceptId?: string | null,
  occupiedKeys: ReadonlySet<string> = EMPTY_VOXEL_KEYS,
) => {
  if (!isAnchorWithinBounds(position, pokemon, dimensions)) {
    return false
  }

  if (
    occupiedKeys.size > 0 &&
    footprintOverlapsVoxels(position, pokemon.base, getClearanceValue(pokemon), occupiedKeys)
  ) {
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

const buildCenterWeightedAnchors = (
  pokemon: GridFootprint,
  dimensions: GridDimensions,
  preferredY?: number | null,
) => {
  const maxX = dimensions.x - pokemon.base
  const maxY = dimensions.y - getClearanceValue(pokemon)
  const maxZ = dimensions.z - pokemon.base

  if (maxX < 0 || maxY < 0 || maxZ < 0) {
    return []
  }

  const preferredLayer = preferredY == null
    ? null
    : Math.min(maxY, Math.max(0, Math.round(preferredY)))
  const anchors: Array<{ x: number; y: number; z: number; distance: number; yDistance: number }> = []
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
          yDistance: preferredLayer == null ? y : Math.abs(y - preferredLayer),
        })
      }
    }
  }

  anchors.sort((left, right) => {
    if (left.yDistance !== right.yDistance) {
      return left.yDistance - right.yDistance
    }

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
  pokemon: GridFootprint,
  pokemons: PositionedGridFootprint[],
  dimensions: GridDimensions,
  exceptId?: string | null,
  occupiedKeys: ReadonlySet<string> = EMPTY_VOXEL_KEYS,
  preferredY?: number | null,
) => {
  const anchors = buildCenterWeightedAnchors(pokemon, dimensions, preferredY)

  for (const anchor of anchors) {
    const position = { x: anchor.x, y: anchor.y, z: anchor.z }

    if (canPlacePokemon(pokemon, position, pokemons, dimensions, exceptId, occupiedKeys)) {
      return position
    }
  }

  return null
}

export const reconcilePokemonPositions = (
  pokemons: SpawnedPokemon[],
  dimensions: GridDimensions,
  voxels: ReadonlyArray<MapVoxelV2> = [],
  occupiedKeys: ReadonlySet<string> = buildVoxelOccupancy(voxels),
) => {
  const nextPokemons: SpawnedPokemon[] = []
  const removedIds: string[] = []

  for (const pokemon of pokemons) {
    const currentPosition = canPlacePokemon(
      pokemon,
      pokemon.position,
      nextPokemons,
      dimensions,
      undefined,
      occupiedKeys,
    )
      ? pokemon.position
      : null

    const fallbackPosition =
      currentPosition ??
      findFirstAvailablePosition(pokemon, nextPokemons, dimensions, null, occupiedKeys)

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
