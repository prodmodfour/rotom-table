import { describe, expect, it } from 'vitest'
import {
  createIsometricAnimationContinuation,
  ISOMETRIC_ANIMATION_CONTINUATION_SOURCE,
  isIsometricAnimationContinuationSource,
  toIsometricRenderSchedulerFrameResult,
} from '~/utils/isometric/renderLoop'

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

  it('narrows known animation continuation source strings', () => {
    expect(isIsometricAnimationContinuationSource('token-motion')).toBe(true)
    expect(isIsometricAnimationContinuationSource('unknown-source')).toBe(false)
    expect(isIsometricAnimationContinuationSource(null)).toBe(false)
  })
})
