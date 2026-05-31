import type { IsometricRenderSchedulerFrameResult } from './renderScheduler'
import {
  anyTokenRenderStateNeedsAnimation,
  type TokenRenderAnimationState,
} from './tokenRenderState'
import {
  movementPreviewAnimationStateNeedsFrame,
  type MovementPreviewAnimationState,
} from './movementPreviewAnimation'
import {
  worldSpriteStateNeedsAnimationFrame,
  worldSpriteStateNeedsTextureFrame,
  type WorldSpriteRenderActivityState,
} from './worldSpriteAssets'

export const ISOMETRIC_ANIMATION_CONTINUATION_SOURCE = {
  tokenMotion: 'token-motion',
  spriteAnimation: 'sprite-animation',
  spriteTextureLoading: 'sprite-texture-loading',
  fieldEffectAnimation: 'field-effect-animation',
  movementPreviewAnimation: 'movement-preview-animation',
  moveVfxAnimation: 'move-vfx-animation',
} as const

export const ISOMETRIC_ANIMATION_CONTINUATION_SOURCES = Object.values(
  ISOMETRIC_ANIMATION_CONTINUATION_SOURCE,
)

export type IsometricAnimationContinuationSource = typeof ISOMETRIC_ANIMATION_CONTINUATION_SOURCE[
  keyof typeof ISOMETRIC_ANIMATION_CONTINUATION_SOURCE
]

export interface IsometricAnimationContinuation {
  /** Whether at least one animation source needs another frame after a one-shot render. */
  active: boolean
  /** Stable, deduplicated sources that are keeping the scheduler alive. */
  sources: IsometricAnimationContinuationSource[]
}

const ISOMETRIC_ANIMATION_CONTINUATION_SOURCE_SET = new Set<string>(
  ISOMETRIC_ANIMATION_CONTINUATION_SOURCES,
)

export const isIsometricAnimationContinuationSource = (
  value: unknown,
): value is IsometricAnimationContinuationSource => (
  typeof value === 'string' && ISOMETRIC_ANIMATION_CONTINUATION_SOURCE_SET.has(value)
)

export const createIsometricAnimationContinuation = (
  sources: Iterable<IsometricAnimationContinuationSource> = [],
): IsometricAnimationContinuation => {
  const dedupedSources: IsometricAnimationContinuationSource[] = []
  const seenSources = new Set<IsometricAnimationContinuationSource>()

  for (const source of sources) {
    if (seenSources.has(source)) continue

    seenSources.add(source)
    dedupedSources.push(source)
  }

  return {
    active: dedupedSources.length > 0,
    sources: dedupedSources,
  }
}

export interface IsometricSpriteAnimationRenderState {
  spriteState: WorldSpriteRenderActivityState
}

export interface IsometricFieldEffectAnimationRenderer {
  needsAnimationFrame(): boolean
}

export interface IsometricMoveVfxAnimationRenderer {
  needsAnimationFrame(): boolean
}

export interface IsometricMovementPreviewAnimationRenderer {
  getAnimationState(): MovementPreviewAnimationState
}

export const resolveIsometricTokenMotionContinuationSources = (
  tokens: Iterable<TokenRenderAnimationState>,
): IsometricAnimationContinuationSource[] => (
  anyTokenRenderStateNeedsAnimation(tokens)
    ? [ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion]
    : []
)

export const resolveIsometricSpriteAnimationContinuationSources = (
  renderStates: Iterable<IsometricSpriteAnimationRenderState>,
): IsometricAnimationContinuationSource[] => {
  const sources: IsometricAnimationContinuationSource[] = []

  for (const renderState of renderStates) {
    if (
      worldSpriteStateNeedsAnimationFrame(renderState.spriteState)
      && !sources.includes(ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation)
    ) {
      sources.push(ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation)
    }

    if (
      worldSpriteStateNeedsTextureFrame(renderState.spriteState)
      && !sources.includes(ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteTextureLoading)
    ) {
      sources.push(ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteTextureLoading)
    }

    if (sources.length === 2) break
  }

  return sources
}

export const resolveIsometricFieldEffectAnimationContinuationSources = (
  renderer: IsometricFieldEffectAnimationRenderer | null | undefined,
): IsometricAnimationContinuationSource[] => (
  renderer?.needsAnimationFrame()
    ? [ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.fieldEffectAnimation]
    : []
)

export const resolveIsometricMovementPreviewAnimationContinuationSources = (
  renderer: IsometricMovementPreviewAnimationRenderer | null | undefined,
): IsometricAnimationContinuationSource[] => (
  renderer && movementPreviewAnimationStateNeedsFrame(renderer.getAnimationState())
    ? [ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.movementPreviewAnimation]
    : []
)

export const resolveIsometricMoveVfxAnimationContinuationSources = (
  renderer: IsometricMoveVfxAnimationRenderer | null | undefined,
): IsometricAnimationContinuationSource[] => (
  renderer?.needsAnimationFrame()
    ? [ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.moveVfxAnimation]
    : []
)

export const toIsometricRenderSchedulerFrameResult = (
  continuation: IsometricAnimationContinuation,
): IsometricRenderSchedulerFrameResult => ({
  activeAnimation: continuation.active,
})
