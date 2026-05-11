import type { MapVoxelV2 } from '~/types/map'
import type { GridAnchor } from '~/types/pokemon'
import { getVoxelMaterialDefinition } from '~/utils/mapMaterials'

export const voxelKey = (x: number, y: number, z: number): string => `${x},${y},${z}`

export const voxelKeyOf = (voxel: MapVoxelV2): string => voxelKey(voxel.x, voxel.y, voxel.z)

export const buildVoxelOccupancy = (voxels: ReadonlyArray<MapVoxelV2>): Set<string> => {
  const set = new Set<string>()
  for (const v of voxels) {
    const material = getVoxelMaterialDefinition(v)
    const blocks = v.blocksMovement ?? material.blocksMovementDefault ?? true
    if (blocks) set.add(voxelKey(v.x, v.y, v.z))
  }
  return set
}

export const buildAllVoxelOccupancy = (voxels: ReadonlyArray<MapVoxelV2>): Set<string> => {
  const set = new Set<string>()
  for (const v of voxels) set.add(voxelKey(v.x, v.y, v.z))
  return set
}

export const footprintOverlapsVoxels = (
  position: GridAnchor,
  base: number,
  clearance: number,
  voxelKeys: ReadonlySet<string>,
): boolean => {
  if (voxelKeys.size === 0) return false
  for (let dx = 0; dx < base; dx += 1) {
    for (let dy = 0; dy < clearance; dy += 1) {
      for (let dz = 0; dz < base; dz += 1) {
        if (voxelKeys.has(voxelKey(position.x + dx, position.y + dy, position.z + dz))) {
          return true
        }
      }
    }
  }
  return false
}

export interface PokemonFootprintCell {
  position: GridAnchor
  base: number
  clearance: number
}

export const cellInsidePokemonFootprint = (
  x: number,
  y: number,
  z: number,
  pokemons: ReadonlyArray<PokemonFootprintCell>,
): boolean => {
  for (const p of pokemons) {
    if (
      x >= p.position.x &&
      x < p.position.x + p.base &&
      y >= p.position.y &&
      y < p.position.y + p.clearance &&
      z >= p.position.z &&
      z < p.position.z + p.base
    ) {
      return true
    }
  }
  return false
}

export const filterVoxelsInBounds = (
  voxels: ReadonlyArray<MapVoxelV2>,
  dimensions: { x: number; y: number; z: number },
): MapVoxelV2[] =>
  voxels.filter(
    (v) =>
      v.x >= 0 &&
      v.x < dimensions.x &&
      v.y >= 0 &&
      v.y < dimensions.y &&
      v.z >= 0 &&
      v.z < dimensions.z,
  )
