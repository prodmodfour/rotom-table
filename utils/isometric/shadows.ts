import type { MapVoxelV2 } from '~/types/map'

export type VoxelColumnMap = Map<string, number[]>

export const voxelColumnKey = (x: number, z: number): string => `${x},${z}`

export const buildVoxelColumnsByXZ = (voxels: readonly MapVoxelV2[]): VoxelColumnMap => {
  const columns: VoxelColumnMap = new Map()
  for (const voxel of voxels) {
    const key = voxelColumnKey(voxel.x, voxel.z)
    const list = columns.get(key)
    if (list) list.push(voxel.y)
    else columns.set(key, [voxel.y])
  }
  return columns
}

export const getVoxelShadowSurfaceY = (options: {
  columns: VoxelColumnMap
  centerX: number
  centerZ: number
  base: number
  footY: number
  fallbackY?: number
}): number => {
  if (options.columns.size === 0) return options.fallbackY ?? 0

  const minX = Math.floor(options.centerX - options.base / 2)
  const minZ = Math.floor(options.centerZ - options.base / 2)
  // Tiny epsilon: treat a voxel top exactly at footY as "below" so a
  // mon standing flush on a voxel still gets a shadow on that voxel.
  const ceiling = options.footY + 0.001

  let surface = options.fallbackY ?? 0
  for (let dx = 0; dx < options.base; dx += 1) {
    for (let dz = 0; dz < options.base; dz += 1) {
      const column = options.columns.get(voxelColumnKey(minX + dx, minZ + dz))
      if (!column) continue
      for (const y of column) {
        const top = y + 1
        if (top <= ceiling && top > surface) surface = top
      }
    }
  }
  return surface
}
