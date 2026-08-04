import { describe, expect, it } from 'vitest'
import {
  createIsometricAnimationContinuation,
  ISOMETRIC_ANIMATION_CONTINUATION_SOURCE,
  ISOMETRIC_ANIMATION_CONTINUATION_SOURCES,
  isIsometricAnimationContinuationSource,
  resolveIsometricFieldEffectAnimationContinuationSources,
  resolveIsometricMoveVfxAnimationContinuationSources,
  resolveIsometricMovementPreviewAnimationContinuationSources,
  resolveIsometricSpriteAnimationContinuationSources,
  resolveIsometricTokenMotionContinuationSources,
  toIsometricRenderSchedulerFrameResult,
} from '~/utils/isometric/renderLoop'
import { startTokenMotionTrack } from '~/utils/isometric/tokenMotionTracks'

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
  textureLoading = false,
) => ({
  spriteState: {
    sprite: { visible },
    animationMeta,
    textureLoading,
  },
})

const movementPreviewRenderer = (
  previewVisible: boolean,
  spriteVisible: boolean,
  animationMeta: ReturnType<typeof spriteAnimation> | null = spriteAnimation(),
  textureLoading = false,
) => ({
  getAnimationState: () => ({
    visible: previewVisible,
    ghostSpriteState: {
      sprite: { visible: spriteVisible },
      animationMeta,
      textureLoading,
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

  it('lists and validates stable animation continuation sources including move VFX', () => {
    expect(ISOMETRIC_ANIMATION_CONTINUATION_SOURCES).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteTextureLoading,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.fieldEffectAnimation,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.movementPreviewAnimation,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.moveVfxAnimation,
    ])
    expect(ISOMETRIC_ANIMATION_CONTINUATION_SOURCES).toContain(
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.moveVfxAnimation,
    )

    for (const source of ISOMETRIC_ANIMATION_CONTINUATION_SOURCES) {
      expect(isIsometricAnimationContinuationSource(source)).toBe(true)
    }

    expect(isIsometricAnimationContinuationSource('moveVfxAnimation')).toBe(false)
    expect(isIsometricAnimationContinuationSource('move-vfx')).toBe(false)
  })

  it('deduplicates active animation sources in first-seen order', () => {
    const continuation = createIsometricAnimationContinuation([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.moveVfxAnimation,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteTextureLoading,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.moveVfxAnimation,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion,
    ])

    expect(continuation).toEqual({
      active: true,
      sources: [
        ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation,
        ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.moveVfxAnimation,
        ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteTextureLoading,
        ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion,
      ],
    })
    expect(toIsometricRenderSchedulerFrameResult(continuation)).toEqual({
      activeAnimation: true,
    })
  })

  it('exposes token motion as a continuation source while tracks, centers, or lift factors are settling', () => {
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
    const explicitTrackToken = {
      ...settledToken,
      motion: {
        track: startTokenMotionTrack({
          tokenId: 'token-a',
          origin: { x: 1, y: 2, z: 3 },
          destination: { x: 4, y: 2, z: 3 },
          startMs: 1000,
          durationMs: 250,
          reason: 'remote-accepted',
        }),
      },
    }

    expect(resolveIsometricTokenMotionContinuationSources([settledToken])).toEqual([])
    expect(resolveIsometricTokenMotionContinuationSources([settledToken, explicitTrackToken])).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion,
    ])
    expect(resolveIsometricTokenMotionContinuationSources([settledToken, movingToken])).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion,
    ])
    expect(resolveIsometricTokenMotionContinuationSources([liftingToken])).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion,
    ])
  })

  it('exposes visible animated sprites and loading sprite textures as continuation sources', () => {
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
    expect(resolveIsometricSpriteAnimationContinuationSources([
      spriteRenderState(true, null, true),
    ])).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteTextureLoading,
    ])
    const animatedAndLoading = [
      spriteRenderState(true),
      spriteRenderState(true, null, true),
    ]
    expect(resolveIsometricSpriteAnimationContinuationSources(animatedAndLoading)).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation,
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteTextureLoading,
    ])
    expect(resolveIsometricSpriteAnimationContinuationSources(animatedAndLoading, {
      reducedMotion: true,
    })).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteTextureLoading,
    ])
  })

  it('exposes active weather and field-effect animators as a continuation source', () => {
    expect(resolveIsometricFieldEffectAnimationContinuationSources(null)).toEqual([])
    expect(resolveIsometricFieldEffectAnimationContinuationSources({
      needsAnimationFrame: () => false,
    })).toEqual([])
    const animatedRenderer = { needsAnimationFrame: () => true }
    expect(resolveIsometricFieldEffectAnimationContinuationSources(animatedRenderer)).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.fieldEffectAnimation,
    ])
    expect(resolveIsometricFieldEffectAnimationContinuationSources(animatedRenderer, {
      reducedMotion: true,
    })).toEqual([])
  })

  it('exposes active move VFX instances as a continuation source only while needed', () => {
    expect(resolveIsometricMoveVfxAnimationContinuationSources(null)).toEqual([])
    expect(resolveIsometricMoveVfxAnimationContinuationSources(undefined)).toEqual([])
    expect(resolveIsometricMoveVfxAnimationContinuationSources({
      needsAnimationFrame: () => false,
    })).toEqual([])

    const inactiveContinuation = createIsometricAnimationContinuation(
      resolveIsometricMoveVfxAnimationContinuationSources({
        needsAnimationFrame: () => false,
      }),
    )
    expect(inactiveContinuation).toEqual({
      active: false,
      sources: [],
    })

    expect(resolveIsometricMoveVfxAnimationContinuationSources({
      needsAnimationFrame: () => true,
    })).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.moveVfxAnimation,
    ])
    expect(createIsometricAnimationContinuation(
      resolveIsometricMoveVfxAnimationContinuationSources({
        needsAnimationFrame: () => true,
      }),
    )).toEqual({
      active: true,
      sources: [ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.moveVfxAnimation],
    })
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
      movementPreviewRenderer(true, true, null, true),
    )).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.movementPreviewAnimation,
    ])
    expect(resolveIsometricMovementPreviewAnimationContinuationSources(
      movementPreviewRenderer(true, true),
    )).toEqual([
      ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.movementPreviewAnimation,
    ])
  })

  it('narrows known animation continuation source strings', () => {
    expect(isIsometricAnimationContinuationSource('token-motion')).toBe(true)
    expect(isIsometricAnimationContinuationSource('movement-preview-animation')).toBe(true)
    expect(isIsometricAnimationContinuationSource('move-vfx-animation')).toBe(true)
    expect(isIsometricAnimationContinuationSource('compatibility-continuous-loop')).toBe(false)
    expect(isIsometricAnimationContinuationSource('unknown-source')).toBe(false)
    expect(isIsometricAnimationContinuationSource(null)).toBe(false)
  })
})
