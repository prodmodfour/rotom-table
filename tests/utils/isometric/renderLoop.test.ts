import { describe, expect, it } from 'vitest'
import {
  createIsometricAnimationContinuation,
  ISOMETRIC_ANIMATION_CONTINUATION_SOURCE,
  isIsometricAnimationContinuationSource,
  resolveIsometricFieldEffectAnimationContinuationSources,
  resolveIsometricMovementPreviewAnimationContinuationSources,
  resolveIsometricSpriteAnimationContinuationSources,
  resolveIsometricTokenMotionContinuationSources,
  toIsometricRenderSchedulerFrameResult,
} from '~/utils/isometric/renderLoop'

const spriteAnimation = () => ({
  url: '/sprites/pikachu-animated.png',
  frameWidth: 16,
  frameHeight: 16,
  frames: 4,
  columns: 2,
  rows: 2,
  durationsMs: [100, 100, 100, 100],
  totalDurationMs: 400,
})

const spriteRenderState = (
  visible: boolean,
  animationMeta: ReturnType<typeof spriteAnimation> | null = spriteAnimation(),
) => ({
  spriteState: {
    sprite: { visible },
    animationMeta,
  },
})

const movementPreviewRenderer = (
  previewVisible: boolean,
  spriteVisible: boolean,
  animationMeta: ReturnType<typeof spriteAnimation> | null = spriteAnimation(),
) => ({
  getAnimationState: () => ({
    visible: previewVisible,
    ghostSpriteState: {
      sprite: { visible: spriteVisible },
      animationMeta,
    },
  }),
})

describe('isometric render loop helpers', () => {
  it('creates an inactive continuation for one-shot renders without animation sources', () => {
    const continuation = createIsometricAnimationContinuation()

    expect(continuation).toEqual({
      active: false,
      sources: [],
    })
    expect(toIsometricRenderSchedulerFrameResult(continuation)).toEqual({
      activeAnimation: false,
    })
  })

  it('deduplicates active animation sources in first-seen order', () => {
    const continuation = createIsometricAnimationContinuation([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.compatibilityContinuousLoop,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion,
    ])

    expect(continuation).toEqual({
      active: true,
      sources: [
        ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation,
        ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.compatibilityContinuousLoop,
        ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion,
      ],
    })
    expect(toIsometricRenderSchedulerFrameResult(continuation)).toEqual({
      activeAnimation: true,
    })
  })

  it('keeps the compatibility loop represented as an explicit animation source', () => {
    const continuation = createIsometricAnimationContinuation([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.compatibilityContinuousLoop,
    ])

    expect(continuation.active).toBe(true)
    expect(continuation.sources).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.compatibilityContinuousLoop,
    ])
  })

  it('exposes token motion as a continuation source while centers or lift factors are settling', () => {
    const settledToken = {
      currentCenter: { x: 1, y: 2, z: 3 },
      targetCenter: { x: 1, y: 2, z: 3 },
      liftFactor: 0,
      liftTarget: 0,
    }
    const movingToken = {
      ...settledToken,
      targetCenter: { x: 2, y: 2, z: 3 },
    }
    const liftingToken = {
      ...settledToken,
      liftTarget: 1,
    }

    expect(resolveIsometricTokenMotionContinuationSources([settledToken])).toEqual([])
    expect(resolveIsometricTokenMotionContinuationSources([settledToken, movingToken])).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion,
    ])
    expect(resolveIsometricTokenMotionContinuationSources([liftingToken])).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion,
    ])
  })

  it('exposes visible animated sprites as a continuation source', () => {
    expect(resolveIsometricSpriteAnimationContinuationSources([
      spriteRenderState(false),
      spriteRenderState(true, null),
    ])).toEqual([])
    expect(resolveIsometricSpriteAnimationContinuationSources([
      spriteRenderState(false),
      spriteRenderState(true),
    ])).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation,
    ])
  })

  it('exposes active weather and field-effect animators as a continuation source', () => {
    expect(resolveIsometricFieldEffectAnimationContinuationSources(null)).toEqual([])
    expect(resolveIsometricFieldEffectAnimationContinuationSources({
      needsAnimationFrame: () => false,
    })).toEqual([])
    expect(resolveIsometricFieldEffectAnimationContinuationSources({
      needsAnimationFrame: () => true,
    })).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.fieldEffectAnimation,
    ])
  })

  it('exposes visible animated movement-preview ghosts as a continuation source', () => {
    expect(resolveIsometricMovementPreviewAnimationContinuationSources(null)).toEqual([])
    expect(resolveIsometricMovementPreviewAnimationContinuationSources(
      movementPreviewRenderer(false, true),
    )).toEqual([])
    expect(resolveIsometricMovementPreviewAnimationContinuationSources(
      movementPreviewRenderer(true, false),
    )).toEqual([])
    expect(resolveIsometricMovementPreviewAnimationContinuationSources(
      movementPreviewRenderer(true, true, null),
    )).toEqual([])
    expect(resolveIsometricMovementPreviewAnimationContinuationSources(
      movementPreviewRenderer(true, true),
    )).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.movementPreviewAnimation,
    ])
  })

  it('narrows known animation continuation source strings', () => {
    expect(isIsometricAnimationContinuationSource('token-motion')).toBe(true)
    expect(isIsometricAnimationContinuationSource('movement-preview-animation')).toBe(true)
    expect(isIsometricAnimationContinuationSource('unknown-source')).toBe(false)
    expect(isIsometricAnimationContinuationSource(null)).toBe(false)
  })
})
