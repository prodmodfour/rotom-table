import type { IsometricRenderSchedulerFrameResult } from './renderScheduler'
import {
  anyTokenRenderStateNeedsAnimation,
  type TokenRenderAnimationState,
} from './tokenRenderState'
import {
  worldSpriteStateNeedsAnimationFrame,
  type WorldSpriteAnimationState,
} from './worldSpriteAssets'

export const ISOMETRIC_ANIMATION_CONTINUATION_SOURCE = {
  compatibilityContinuousLoop: 'compatibility-continuous-loop',
  tokenMotion: 'token-motion',
  spriteAnimation: 'sprite-animation',
  fieldEffectAnimation: 'field-effect-animation',
  movementPreviewAnimation: 'movement-preview-animation',
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
  spriteState: WorldSpriteAnimationState
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
  for (const renderState of renderStates) {
    if (worldSpriteStateNeedsAnimationFrame(renderState.spriteState)) {
      return [ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation]
    }
  }

  return []
}

export const toIsometricRenderSchedulerFrameResult = (
  continuation: IsometricAnimationContinuation,
): IsometricRenderSchedulerFrameResult => ({
  activeAnimation: continuation.active,
})
