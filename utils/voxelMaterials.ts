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

export const voxelMaterialId = materialIdForVoxel
export const normalizeVoxelMaterialId = normalizeMaterialId
export const voxelMaterialDefinition = getVoxelMaterialDefinition

export const voxelMaterialBaseColor = (voxel: Pick<MapVoxelV2, 'materialId'>): number =>
  materialColorNumber(getVoxelMaterialDefinition(voxel))
