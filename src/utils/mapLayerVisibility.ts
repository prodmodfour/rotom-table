import type { LayerVisibility } from '~/types/map'

export const MAP_LAYER_OPTIONS = [
  'terrain',
  'shadows',
  'tokens',
  'grid',
  'hazards',
  'fieldEffects',
] as const satisfies readonly (keyof LayerVisibility)[]

export type MapLayerVisibilityKey = (typeof MAP_LAYER_OPTIONS)[number]

export const DEFAULT_MAP_LAYER_VISIBILITY = {
  terrain: true,
  shadows: true,
  tokens: true,
  grid: true,
  hazards: true,
  fieldEffects: true,
} as const satisfies LayerVisibility

export const createDefaultMapLayerVisibility = (): LayerVisibility => ({
  ...DEFAULT_MAP_LAYER_VISIBILITY,
})

export const resolveMapLayerVisibility = (
  visibility: Partial<LayerVisibility> | null | undefined,
): LayerVisibility => ({
  ...DEFAULT_MAP_LAYER_VISIBILITY,
  ...(visibility ?? {}),
})

export const formatLayerVisibilityLabel = (layer: string): string =>
  layer.replace(/([A-Z])/g, ' $1')
