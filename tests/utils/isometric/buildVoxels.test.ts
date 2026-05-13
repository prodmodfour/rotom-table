import { describe, expect, it } from 'vitest'
import {
  createBuildVoxelPlacement,
  resolveBuildVoxelRenderStyle,
} from '~/utils/isometric/buildVoxels'

describe('isometric build voxel helpers', () => {
  it('uses explicit valid custom colors for preview styles and placements', () => {
    expect(resolveBuildVoxelRenderStyle({
      material: 'stone',
      color: '#aabbcc',
      cell: { x: 1, y: 2, z: 3 },
    })).toEqual({ materialId: 'stone', color: '#aabbcc' })

    expect(createBuildVoxelPlacement({
      material: 'stone',
      color: '#aabbcc',
      cell: { x: 1, y: 2, z: 3 },
    })).toEqual({ x: 1, y: 2, z: 3, materialId: 'stone', color: '#aabbcc' })
  })

  it('ignores invalid preview colors while preserving placement payload compatibility', () => {
    expect(resolveBuildVoxelRenderStyle({
      material: 'stone',
      color: 'not-a-color',
      cell: { x: 1, y: 2, z: 3 },
    })).toEqual({ materialId: 'stone' })

    expect(createBuildVoxelPlacement({
      material: 'stone',
      color: 'not-a-color',
      cell: { x: 1, y: 2, z: 3 },
    })).toEqual({ x: 1, y: 2, z: 3, materialId: 'stone', color: 'not-a-color' })
  })

  it('applies deterministic default builder colors for water voxels', () => {
    expect(resolveBuildVoxelRenderStyle({
      material: 'shallow_water',
      color: null,
      cell: { x: 0, y: 0, z: 0 },
    })).toEqual({ materialId: 'shallow_water', color: '#86d7ee' })

    expect(createBuildVoxelPlacement({
      material: 'shallow_water',
      color: null,
      cell: { x: 0, y: 0, z: 0 },
    })).toEqual({ x: 0, y: 0, z: 0, materialId: 'shallow_water', color: '#86d7ee' })
  })

  it('marks placements as ghost only when requested', () => {
    expect(createBuildVoxelPlacement({
      material: 'stone',
      color: null,
      cell: { x: 1, y: 0, z: 2 },
      ghost: true,
    })).toEqual({ x: 1, y: 0, z: 2, materialId: 'stone', ghost: true })

    expect(createBuildVoxelPlacement({
      material: 'stone',
      color: null,
      cell: { x: 1, y: 0, z: 2 },
      ghost: false,
    })).toEqual({ x: 1, y: 0, z: 2, materialId: 'stone' })
  })
})
