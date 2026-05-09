import { describe, expect, it } from 'vitest'
import type { MapVoxelV2 } from '~/types/map'
import {
  buildVoxelColumnsByXZ,
  getVoxelShadowSurfaceY,
  voxelColumnKey,
} from '~/utils/isometric/shadows'

const voxel = (x: number, y: number, z: number): MapVoxelV2 => ({
  x,
  y,
  z,
  materialId: 'stone',
}) as MapVoxelV2

describe('isometric voxel shadow helpers', () => {
  it('groups voxel y-values by x/z column', () => {
    const columns = buildVoxelColumnsByXZ([
      voxel(1, 0, 2),
      voxel(1, 3, 2),
      voxel(2, 1, 2),
    ])

    expect(columns.get(voxelColumnKey(1, 2))).toEqual([0, 3])
    expect(columns.get(voxelColumnKey(2, 2))).toEqual([1])
  })

  it('uses the highest voxel top under a token footprint as the shadow surface', () => {
    const columns = buildVoxelColumnsByXZ([
      voxel(0, 0, 0), // top 1, under footprint
      voxel(1, 1, 1), // top 2, under footprint and below foot
      voxel(1, 3, 1), // top 4, under footprint but above foot
      voxel(3, 5, 3), // outside footprint
    ])

    expect(getVoxelShadowSurfaceY({
      columns,
      centerX: 1,
      centerZ: 1,
      base: 2,
      footY: 2,
    })).toBe(2)
  })

  it('falls back to ground when no voxel is below the foot', () => {
    const columns = buildVoxelColumnsByXZ([voxel(0, 4, 0)])

    expect(getVoxelShadowSurfaceY({
      columns,
      centerX: 0.5,
      centerZ: 0.5,
      base: 1,
      footY: 1,
      fallbackY: 0,
    })).toBe(0)
  })
})
