import type { MapVoxelV2 } from '~/types/map'
import { getVoxelMaterialDefinition } from './mapMaterials'
import { voxelKey } from './voxelOccupancy'

export interface BuildMapOccupancyOptions {
  voxels?: ReadonlyArray<MapVoxelV2>
  /**
   * Movement should normally include transparent blockers: glass walls,
   * ice, water, etc. Set false only for tooling that wants an opaque-only
   * occupancy pass.
   */
  includeTransparent?: boolean
}

/**
 * Build movement occupancy for map terrain voxels.
 *
 * The returned Set uses the same `"x,y,z"` cell keys as voxel helpers so
 * token placement and BFS pathfinding can consume it directly.
 */
export const buildMapOccupancy = ({
  voxels = [],
  includeTransparent = true,
}: BuildMapOccupancyOptions): Set<string> => {
  const occupied = new Set<string>()

  for (const voxel of voxels) {
    const material = getVoxelMaterialDefinition(voxel)
    if (!includeTransparent && material.transparent) continue
    const blocks = voxel.blocksMovement ?? material.blocksMovementDefault ?? true
    if (blocks) occupied.add(voxelKey(voxel.x, voxel.y, voxel.z))
  }

  return occupied
}
