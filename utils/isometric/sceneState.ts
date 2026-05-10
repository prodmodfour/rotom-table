import type { GridDimensions } from '~/types/pokemon'
import type { LayerVisibility, MapFieldEffects, MapHazardV2, MapVoxelV2 } from '~/types/map'
import { clampMapGroundLevelY } from '~/utils/mapGroundLevel'
import { voxelMaterialId } from '~/utils/voxels'

export const DEFAULT_ISOMETRIC_LAYER_VISIBILITY: LayerVisibility = {
  terrain: true,
  shadows: true,
  tokens: true,
  grid: true,
  hazards: true,
  fieldEffects: true,
}

export const resolveIsometricLayerVisibility = (
  visibility: Partial<LayerVisibility> | null | undefined,
): LayerVisibility => ({
  ...DEFAULT_ISOMETRIC_LAYER_VISIBILITY,
  ...(visibility ?? {}),
})

export const shouldShowMovementGrid = (options: {
  hasSelectedPokemon: boolean
  buildMode: boolean
  hazardMode?: boolean
}): boolean => options.hasSelectedPokemon || options.buildMode || Boolean(options.hazardMode)

export const clampIsometricGroundLevelY = (
  dimensions: Pick<GridDimensions, 'y'>,
  groundLevelY: unknown,
): number => clampMapGroundLevelY(dimensions, groundLevelY)

export const getFieldEffectsRevisionKey = (fieldEffects: MapFieldEffects): string =>
  JSON.stringify(fieldEffects)

export const getHazardsRevisionKey = (hazards: readonly MapHazardV2[]): string =>
  hazards
    .map((hazard) => [
      hazard.kind,
      hazard.x,
      hazard.y,
      hazard.z,
      hazard.layer ?? '',
      hazard.owner ?? '',
    ].join('\u001e'))
    .join('\u001d')

export const getTerrainVoxelsRevisionKey = (voxels: readonly MapVoxelV2[]): string =>
  voxels
    .map((voxel) => [
      voxel.x,
      voxel.y,
      voxel.z,
      voxelMaterialId(voxel),
      voxel.color ?? '',
      voxel.blocksMovement ?? '',
      voxel.blocksSight ?? '',
      (voxel.tags ?? []).join('\u001f'),
    ].join('\u001e'))
    .join('\u001d')
