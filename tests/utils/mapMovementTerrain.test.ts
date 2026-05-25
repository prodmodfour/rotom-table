import { describe, expect, it, vi } from 'vitest'
import type { MapVoxelV2 } from '~/types/map'
import {
  buildMapMovementTerrainIndex,
  createMapMovementTerrainIndexCache,
} from '~/utils/mapMovementTerrain'

const voxel = (overrides: Partial<MapVoxelV2> = {}): MapVoxelV2 => ({
  x: 0,
  y: 0,
  z: 0,
  materialId: 'stone',
  ...overrides,
})

describe('map movement terrain index cache', () => {
  it('reuses the built terrain index while the revision is unchanged', () => {
    const buildIndex = vi.fn(buildMapMovementTerrainIndex)
    const cache = createMapMovementTerrainIndexCache({ buildIndex })
    const voxels = [voxel()]

    const first = cache.get(voxels, 'terrain-revision-a')
    const second = cache.get(voxels, 'terrain-revision-a')

    expect(second).toBe(first)
    expect(first.voxelAt(0, 0, 0)).toBe(voxels[0])
    expect(buildIndex).toHaveBeenCalledOnce()
    expect(cache.snapshot()).toEqual({ revision: 'terrain-revision-a', hasIndex: true })
  })

  it('rebuilds only when the terrain revision changes', () => {
    const buildIndex = vi.fn(buildMapMovementTerrainIndex)
    const cache = createMapMovementTerrainIndexCache({ buildIndex })

    const emptyRevisionIndex = cache.get([], '')
    expect(cache.get([], '')).toBe(emptyRevisionIndex)
    expect(buildIndex).toHaveBeenCalledOnce()

    const changedRevisionIndex = cache.get([voxel({ x: 1 })], 'terrain-revision-b')

    expect(changedRevisionIndex).not.toBe(emptyRevisionIndex)
    expect(changedRevisionIndex.voxelAt(1, 0, 0)).toEqual(voxel({ x: 1 }))
    expect(buildIndex).toHaveBeenCalledTimes(2)
    expect(cache.snapshot()).toEqual({ revision: 'terrain-revision-b', hasIndex: true })
  })

  it('does not cache unversioned terrain inputs', () => {
    const buildIndex = vi.fn(buildMapMovementTerrainIndex)
    const cache = createMapMovementTerrainIndexCache({ buildIndex })
    const voxels = [voxel()]

    const first = cache.get(voxels, null)
    const second = cache.get(voxels, undefined)

    expect(second).not.toBe(first)
    expect(buildIndex).toHaveBeenCalledTimes(2)
    expect(cache.snapshot()).toEqual({ revision: null, hasIndex: false })
  })

  it('clears the cached terrain index explicitly', () => {
    const buildIndex = vi.fn(buildMapMovementTerrainIndex)
    const cache = createMapMovementTerrainIndexCache({ buildIndex })

    const first = cache.get([voxel()], 'terrain-revision-a')
    cache.clear()
    const rebuilt = cache.get([voxel()], 'terrain-revision-a')

    expect(rebuilt).not.toBe(first)
    expect(buildIndex).toHaveBeenCalledTimes(2)
  })
})
