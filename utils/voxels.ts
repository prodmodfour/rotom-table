/**
 * Voxel terrain helpers.
 *
 * Voxels are 1×1×1 cubes stored sparsely as `MapVoxelV2` records.
 */
import type { GridAnchor } from '~/types/pokemon'
import type { MapVoxelV2, VoxelMaterial } from '~/types/map'
import {
  MAP_MATERIAL_PALETTE,
  getMaterialDefinition,
  getVoxelMaterialDefinition,
  materialColorNumber,
  materialIdForVoxel,
  normalizeMaterialId,
  type MaterialPaletteEntry,
} from '~/utils/mapMaterials'

export type VoxelMaterialDef = MaterialPaletteEntry

export const VOXEL_MATERIALS: readonly VoxelMaterialDef[] = MAP_MATERIAL_PALETTE

export const getMaterialDef = (material: VoxelMaterial): VoxelMaterialDef => {
  const definition = getMaterialDefinition(material)
  return {
    material: definition.id,
    label: definition.displayName,
    baseColor: materialColorNumber(definition),
    transparent: definition.transparent,
    opacity: definition.opacity,
    tags: definition.tags,
  }
}

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

export const voxelMaterialId = materialIdForVoxel
export const normalizeVoxelMaterialId = normalizeMaterialId
export const voxelMaterialDefinition = getVoxelMaterialDefinition

export const voxelBaseColor = (voxel: MapVoxelV2): number => {
  if (voxel.color) {
    const parsed = parseHexColor(voxel.color)
    if (parsed !== null) return parsed
  }
  return materialColorNumber(getVoxelMaterialDefinition(voxel))
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
