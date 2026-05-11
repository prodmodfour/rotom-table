import type { MapVoxelV2 } from '~/types/map'
import { materialIdForVoxel, normalizeMaterialId } from '~/utils/mapMaterials'
import { voxelMaterialBaseColor } from '~/utils/voxelMaterials'

export interface VoxelFacePalette {
  top: number
  side: number
  shadow: number
  bottom: number
}

const scaleColorChannel = (channel: number, factor: number) =>
  Math.min(255, Math.max(0, Math.round(channel * factor)))

const scaleColor = (hex: number, factor: number) =>
  (scaleColorChannel((hex >> 16) & 0xff, factor) << 16) |
  (scaleColorChannel((hex >> 8) & 0xff, factor) << 8) |
  scaleColorChannel(hex & 0xff, factor)

export const buildFacePalette = (baseColor: number): VoxelFacePalette => ({
  top:    baseColor,
  side:   scaleColor(baseColor, 0.8),
  shadow: scaleColor(baseColor, 0.62),
  bottom: scaleColor(baseColor, 0.42),
})

export const parseHexColor = (input: string): number | null => {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(input.trim())
  if (!match) return null
  return parseInt(match[1], 16)
}

export const hexColorString = (hex: number): string =>
  `#${hex.toString(16).padStart(6, '0')}`

export const voxelBaseColor = (voxel: MapVoxelV2): number => {
  if (voxel.color) {
    const parsed = parseHexColor(voxel.color)
    if (parsed !== null) return parsed
  }
  return voxelMaterialBaseColor(voxel)
}

export const voxelFacePalette = (voxel: MapVoxelV2): VoxelFacePalette =>
  buildFacePalette(voxelBaseColor(voxel))

const CLEAN_WATER_BUILD_PALETTES: Record<string, readonly string[]> = {
  shallow_water: ['#48a9d6', '#3f98c8', '#58b7df', '#86d7ee'],
  deep_water: ['#2376a8', '#1d6594', '#17527c'],
}

const waterBuildPaletteIndex = (
  materialId: string,
  x: number,
  y: number,
  z: number,
): number => {
  const h = (x * 37 + y * 17 + z * 53 + x * z * 3) % 100
  if (materialId === 'shallow_water') {
    if (h < 2) return 3
    if (h < 38) return 0
    if (h < 70) return 1
    return 2
  }
  if (h < 36) return 0
  if (h < 70) return 1
  return 2
}

/**
 * Default terrain-builder color overrides for materials whose placed block
 * style should differ from their registry color. Water uses the clean-blue,
 * greywater-style custom block texture while keeping the material opacity.
 */
export const defaultBuilderVoxelColor = (voxel: Pick<MapVoxelV2, 'x' | 'y' | 'z' | 'materialId'>): string | null => {
  const materialId = normalizeMaterialId(voxel.materialId)
  const palette = CLEAN_WATER_BUILD_PALETTES[materialId]
  if (!palette) return null
  return palette[waterBuildPaletteIndex(materialId, voxel.x, voxel.y, voxel.z)] ?? palette[0] ?? null
}

export const withDefaultBuilderVoxelColor = (voxel: MapVoxelV2): MapVoxelV2 => {
  if (voxel.color && parseHexColor(voxel.color) !== null) return voxel
  const color = defaultBuilderVoxelColor(voxel)
  return color ? { ...voxel, color } : voxel
}

/**
 * Bucket key for sharing an `InstancedMesh` across visually identical voxels.
 * Custom-colored voxels group by color; preset voxels group by material id.
 */
export const voxelGroupKey = (voxel: MapVoxelV2): string => {
  if (voxel.color) {
    const parsed = parseHexColor(voxel.color)
    if (parsed !== null) return `c:${parsed.toString(16).padStart(6, '0')}`
  }
  return `m:${materialIdForVoxel(voxel)}`
}
