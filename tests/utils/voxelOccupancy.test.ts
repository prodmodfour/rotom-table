import { describe, expect, it } from 'vitest'
import type { MapVoxelV2 } from '~/types/map'
import {
  buildAllVoxelOccupancy,
  buildVoxelOccupancy,
  cellInsidePokemonFootprint,
  filterVoxelsInBounds,
  footprintOverlapsVoxels,
  voxelKey,
  voxelKeyOf,
} from '~/utils/voxelOccupancy'

describe('voxel occupancy helpers', () => {
  it('builds stable voxel keys', () => {
    expect(voxelKey(1, 2, 3)).toBe('1,2,3')
    expect(voxelKeyOf({ x: -1, y: 0, z: 4, materialId: 'airship_floor_metal' })).toBe('-1,0,4')
  })

  it('builds movement occupancy from material defaults and voxel overrides', () => {
    const voxels: MapVoxelV2[] = [
      { x: 0, y: 0, z: 0, materialId: 'airship_wall_bulkhead' },
      { x: 1, y: 0, z: 0, materialId: 'shallow_water' },
      { x: 2, y: 0, z: 0, materialId: 'shallow_water', blocksMovement: true },
      { x: 3, y: 0, z: 0, materialId: 'airship_wall_bulkhead', blocksMovement: false },
    ]

    expect(buildVoxelOccupancy(voxels)).toEqual(new Set(['0,0,0', '2,0,0']))
    expect(buildAllVoxelOccupancy(voxels)).toEqual(new Set(['0,0,0', '1,0,0', '2,0,0', '3,0,0']))
  })

  it('detects footprint overlap against occupied voxel keys', () => {
    const occupied = new Set(['2,1,2'])

    expect(footprintOverlapsVoxels({ x: 1, y: 0, z: 1 }, 2, 2, occupied)).toBe(true)
    expect(footprintOverlapsVoxels({ x: 3, y: 0, z: 1 }, 2, 2, occupied)).toBe(false)
    expect(footprintOverlapsVoxels({ x: 1, y: 0, z: 1 }, 2, 2, new Set())).toBe(false)
  })

  it('detects whether a terrain cell is inside a token footprint', () => {
    const pokemons = [{ position: { x: 2, y: 1, z: 2 }, base: 2, clearance: 3 }]

    expect(cellInsidePokemonFootprint(3, 3, 3, pokemons)).toBe(true)
    expect(cellInsidePokemonFootprint(4, 3, 3, pokemons)).toBe(false)
    expect(cellInsidePokemonFootprint(3, 4, 3, pokemons)).toBe(false)
  })

  it('filters voxels to map dimensions', () => {
    const voxels: MapVoxelV2[] = [
      { x: 0, y: 0, z: 0, materialId: 'airship_floor_metal' },
      { x: 2, y: 0, z: 0, materialId: 'airship_floor_metal' },
      { x: 1, y: -1, z: 0, materialId: 'airship_floor_metal' },
      { x: 1, y: 1, z: 1, materialId: 'airship_floor_metal' },
    ]

    expect(filterVoxelsInBounds(voxels, { x: 2, y: 2, z: 2 })).toEqual([
      { x: 0, y: 0, z: 0, materialId: 'airship_floor_metal' },
      { x: 1, y: 1, z: 1, materialId: 'airship_floor_metal' },
    ])
  })
})
