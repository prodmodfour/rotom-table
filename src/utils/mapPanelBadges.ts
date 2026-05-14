import type { GridDimensions } from '~/types/map'

export const pluralizeCount = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`

export const formatMapDimensionsBadge = (dimensions: GridDimensions): string =>
  `${dimensions.x} × ${dimensions.y} × ${dimensions.z}`

export const formatTerrainBuildBadge = (voxelCount: number): string =>
  pluralizeCount(voxelCount, 'block')

export const formatTerrainHazardBadge = (voxelCount: number, hazardCount: number): string =>
  `${formatTerrainBuildBadge(voxelCount)} · ${pluralizeCount(hazardCount, 'hazard')}`

export const formatActiveFieldEffectsBadge = (fieldEffectCount: number): string =>
  `${fieldEffectCount} active`

export const formatFieldEffectsHazardsBadge = (fieldEffectCount: number, hazardCount: number): string =>
  `${formatActiveFieldEffectsBadge(fieldEffectCount)} · ${pluralizeCount(hazardCount, 'hazard')}`
