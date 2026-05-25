/**
 * Pure render invalidation reason model for the isometric scene scheduler.
 *
 * These reasons describe why a frame may be requested. They intentionally do
 * not schedule RAFs, sample browser state, or mutate renderer objects; future
 * scheduler integration can merge them while coalescing duplicate work.
 */
export const ISOMETRIC_RENDER_INVALIDATION_REASONS = [
  'initial',
  'manual',
  'resize',
  'camera',
  'scene-state',
  'terrain',
  'hazards',
  'tokens',
  'token-texture',
  'token-style',
  'movement-preview',
  'build-preview',
  'hazard-preview',
  'targeting',
  'field-effect',
  'weather',
  'layer-visibility',
  'pointer',
  'animation',
  'hidden-tab-resume',
  'debug',
] as const

export type RenderInvalidationReason = typeof ISOMETRIC_RENDER_INVALIDATION_REASONS[number]

export const ISOMETRIC_RENDER_INVALIDATION_REASON_LABELS: Record<RenderInvalidationReason, string> = {
  initial: 'Initial render',
  manual: 'Manual render request',
  resize: 'Renderer resize',
  camera: 'Camera or controls changed',
  'scene-state': 'Map scene state changed',
  terrain: 'Terrain changed',
  hazards: 'Hazards changed',
  tokens: 'Token objects changed',
  'token-texture': 'Token texture loaded',
  'token-style': 'Token style or HUD changed',
  'movement-preview': 'Movement preview changed',
  'build-preview': 'Build preview changed',
  'hazard-preview': 'Hazard preview changed',
  targeting: 'Targeting state changed',
  'field-effect': 'Field effect changed',
  weather: 'Weather changed',
  'layer-visibility': 'Layer visibility changed',
  pointer: 'Pointer interaction changed',
  animation: 'Active animation frame',
  'hidden-tab-resume': 'Hidden tab resumed',
  debug: 'Debug instrumentation',
}

export const ISOMETRIC_RENDER_DIRTY_LAYERS = [
  'webgl',
  'css3d',
] as const

export type IsometricRenderDirtyLayer = typeof ISOMETRIC_RENDER_DIRTY_LAYERS[number]

export const ISOMETRIC_RENDER_DIRTY_LAYER_LABELS: Record<IsometricRenderDirtyLayer, string> = {
  webgl: 'WebGL',
  css3d: 'CSS3D',
}

export const ISOMETRIC_WEBGL_RENDER_INVALIDATION_REASONS = [
  'initial',
  'manual',
  'resize',
  'camera',
  'scene-state',
  'terrain',
  'hazards',
  'tokens',
  'token-texture',
  'token-style',
  'movement-preview',
  'build-preview',
  'hazard-preview',
  'targeting',
  'field-effect',
  'weather',
  'layer-visibility',
  'pointer',
  'animation',
  'hidden-tab-resume',
  'debug',
] as const satisfies readonly RenderInvalidationReason[]

export const ISOMETRIC_CSS3D_RENDER_INVALIDATION_REASONS = [
  'initial',
  'manual',
  'resize',
  'camera',
  'scene-state',
  'tokens',
  'token-style',
  'movement-preview',
  'targeting',
  'layer-visibility',
  'pointer',
  'hidden-tab-resume',
] as const satisfies readonly RenderInvalidationReason[]

const ISOMETRIC_RENDER_INVALIDATION_REASON_SET = new Set<string>(
  ISOMETRIC_RENDER_INVALIDATION_REASONS,
)

const ISOMETRIC_RENDER_DIRTY_LAYER_SET = new Set<string>(
  ISOMETRIC_RENDER_DIRTY_LAYERS,
)

const ISOMETRIC_WEBGL_RENDER_INVALIDATION_REASON_SET = new Set<RenderInvalidationReason>(
  ISOMETRIC_WEBGL_RENDER_INVALIDATION_REASONS,
)

const ISOMETRIC_CSS3D_RENDER_INVALIDATION_REASON_SET = new Set<RenderInvalidationReason>(
  ISOMETRIC_CSS3D_RENDER_INVALIDATION_REASONS,
)

export const isRenderInvalidationReason = (value: unknown): value is RenderInvalidationReason => (
  typeof value === 'string' && ISOMETRIC_RENDER_INVALIDATION_REASON_SET.has(value)
)

export const isIsometricRenderDirtyLayer = (value: unknown): value is IsometricRenderDirtyLayer => (
  typeof value === 'string' && ISOMETRIC_RENDER_DIRTY_LAYER_SET.has(value)
)

export const renderInvalidationReasonAffectsWebGL = (
  reason: RenderInvalidationReason,
): boolean => ISOMETRIC_WEBGL_RENDER_INVALIDATION_REASON_SET.has(reason)

export const renderInvalidationReasonAffectsCss3D = (
  reason: RenderInvalidationReason,
): boolean => ISOMETRIC_CSS3D_RENDER_INVALIDATION_REASON_SET.has(reason)

const resolveRenderInvalidationReasonLayerList = (
  reason: RenderInvalidationReason,
): IsometricRenderDirtyLayer[] => {
  const layers: IsometricRenderDirtyLayer[] = []

  if (renderInvalidationReasonAffectsWebGL(reason)) layers.push('webgl')
  if (renderInvalidationReasonAffectsCss3D(reason)) layers.push('css3d')

  return layers
}

export const ISOMETRIC_RENDER_INVALIDATION_REASON_LAYERS = ISOMETRIC_RENDER_INVALIDATION_REASONS.reduce(
  (layersByReason, reason) => {
    layersByReason[reason] = resolveRenderInvalidationReasonLayerList(reason)
    return layersByReason
  },
  {} as Record<RenderInvalidationReason, readonly IsometricRenderDirtyLayer[]>,
)

const appendUniqueRenderInvalidationReason = (
  target: RenderInvalidationReason[],
  seen: Set<RenderInvalidationReason>,
  reason: RenderInvalidationReason,
): void => {
  if (seen.has(reason)) return

  seen.add(reason)
  target.push(reason)
}

const appendUniqueRenderDirtyLayer = (
  target: IsometricRenderDirtyLayer[],
  seen: Set<IsometricRenderDirtyLayer>,
  layer: IsometricRenderDirtyLayer,
): void => {
  if (seen.has(layer)) return

  seen.add(layer)
  target.push(layer)
}

export const mergeRenderInvalidationReasons = (
  ...reasonGroups: Array<Iterable<RenderInvalidationReason> | null | undefined>
): RenderInvalidationReason[] => {
  const merged: RenderInvalidationReason[] = []
  const seen = new Set<RenderInvalidationReason>()

  for (const reasons of reasonGroups) {
    if (!reasons) continue

    for (const reason of reasons) {
      appendUniqueRenderInvalidationReason(merged, seen, reason)
    }
  }

  return merged
}

export const mergeIsometricRenderDirtyLayers = (
  ...layerGroups: Array<Iterable<IsometricRenderDirtyLayer> | null | undefined>
): IsometricRenderDirtyLayer[] => {
  const merged: IsometricRenderDirtyLayer[] = []
  const seen = new Set<IsometricRenderDirtyLayer>()

  for (const layers of layerGroups) {
    if (!layers) continue

    for (const layer of layers) {
      appendUniqueRenderDirtyLayer(merged, seen, layer)
    }
  }

  return merged
}

export const createRenderInvalidationReasons = (
  reasons: Iterable<RenderInvalidationReason> = [],
): RenderInvalidationReason[] => mergeRenderInvalidationReasons(reasons)

export const appendRenderInvalidationReason = (
  reasons: Iterable<RenderInvalidationReason>,
  reason: RenderInvalidationReason,
): RenderInvalidationReason[] => mergeRenderInvalidationReasons(reasons, [reason])

export const hasRenderInvalidationReason = (
  reasons: Iterable<RenderInvalidationReason>,
  reason: RenderInvalidationReason,
): boolean => {
  for (const existingReason of reasons) {
    if (existingReason === reason) return true
  }

  return false
}

export const createIsometricRenderDirtyLayers = (
  layers: Iterable<IsometricRenderDirtyLayer> = [],
): IsometricRenderDirtyLayer[] => mergeIsometricRenderDirtyLayers(layers)

export const resolveRenderInvalidationReasonLayers = (
  reason: RenderInvalidationReason,
): IsometricRenderDirtyLayer[] => [...ISOMETRIC_RENDER_INVALIDATION_REASON_LAYERS[reason]]

export const resolveRenderInvalidationLayers = (
  reasons: Iterable<RenderInvalidationReason>,
): IsometricRenderDirtyLayer[] => {
  const layerGroups: IsometricRenderDirtyLayer[][] = []

  for (const reason of reasons) {
    layerGroups.push(resolveRenderInvalidationReasonLayers(reason))
  }

  return mergeIsometricRenderDirtyLayers(...layerGroups)
}

export const renderInvalidationLayersIncludeWebGL = (
  layers: Iterable<IsometricRenderDirtyLayer>,
): boolean => {
  for (const layer of layers) {
    if (layer === 'webgl') return true
  }

  return false
}

export const renderInvalidationLayersIncludeCss3D = (
  layers: Iterable<IsometricRenderDirtyLayer>,
): boolean => {
  for (const layer of layers) {
    if (layer === 'css3d') return true
  }

  return false
}
