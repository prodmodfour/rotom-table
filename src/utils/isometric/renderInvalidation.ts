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

const ISOMETRIC_RENDER_INVALIDATION_REASON_SET = new Set<string>(
  ISOMETRIC_RENDER_INVALIDATION_REASONS,
)

export const isRenderInvalidationReason = (value: unknown): value is RenderInvalidationReason => (
  typeof value === 'string' && ISOMETRIC_RENDER_INVALIDATION_REASON_SET.has(value)
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
