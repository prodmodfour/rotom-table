import type { MapVoxelV2, VoxelMaterial } from '~/types/map'
import type { VoxelRenderStyle } from '~/utils/isometric/blockTextures'
import {
  defaultBuilderVoxelColor,
  parseHexColor,
  withDefaultBuilderVoxelColor,
} from '~/utils/voxels'

export interface BuildVoxelStyleOptions {
  material: VoxelMaterial
  color: string | null | undefined
  cell?: Pick<MapVoxelV2, 'x' | 'y' | 'z'>
}

export const resolveBuildVoxelRenderStyle = ({
  material,
  color,
  cell,
}: BuildVoxelStyleOptions): VoxelRenderStyle => {
  const style: VoxelRenderStyle = { materialId: material }

  if (color && parseHexColor(color) !== null) {
    style.color = color
    return style
  }

  if (cell) {
    const defaultColor = defaultBuilderVoxelColor({
      ...cell,
      materialId: material,
    })
    if (defaultColor) style.color = defaultColor
  }

  return style
}

export interface BuildVoxelPlacementOptions {
  material: VoxelMaterial
  color: string | null | undefined
  cell: Pick<MapVoxelV2, 'x' | 'y' | 'z'>
}

export const createBuildVoxelPlacement = ({
  material,
  color,
  cell,
}: BuildVoxelPlacementOptions): MapVoxelV2 => withDefaultBuilderVoxelColor({
  x: cell.x,
  y: cell.y,
  z: cell.z,
  materialId: material,
  ...(color ? { color } : {}),
})
