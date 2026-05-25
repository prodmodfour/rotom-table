import { describe, expect, it } from 'vitest'
import {
  CSS3D_RENDER_DIRTY_INVALIDATION_REASONS,
  createCss3DRenderDirtyTracker,
  isCss3DRenderDirtyAnimationSource,
  isCss3DRenderDirtyInvalidationReason,
} from '~/utils/isometric/css3DRenderDirtyTracker'
import { ISOMETRIC_ANIMATION_CONTINUATION_SOURCE } from '~/utils/isometric/renderLoop'
import type { RenderInvalidationReason } from '~/utils/isometric/renderInvalidation'

describe('CSS3D render dirty tracker', () => {
  it('starts dirty for the first CSS3D render and consumes dirty state once', () => {
    const tracker = createCss3DRenderDirtyTracker()

    expect(tracker.snapshot()).toEqual({ dirty: true, reasons: ['initial'] })
    expect(tracker.consumeDirty()).toBe(true)
    expect(tracker.snapshot()).toEqual({ dirty: false, reasons: [] })
    expect(tracker.consumeDirty()).toBe(false)
  })

  it('deduplicates dirty reasons while preserving first-seen order', () => {
    const tracker = createCss3DRenderDirtyTracker({ dirty: false })

    tracker.markDirty('camera')
    tracker.markDirty('token-style')
    tracker.markDirty('camera')

    expect(tracker.snapshot()).toEqual({ dirty: true, reasons: ['camera', 'token-style'] })
  })

  it('marks CSS3D dirty for render reasons that can affect HUD projection or CSS3D objects', () => {
    const tracker = createCss3DRenderDirtyTracker({ dirty: false })

    tracker.markDirtyForRenderReasons([
      'weather',
      'field-effect',
      'animation',
      'camera',
      'token-texture',
      'movement-preview',
    ])

    expect(tracker.snapshot()).toEqual({ dirty: true, reasons: ['camera', 'movement-preview'] })
  })

  it('only treats token motion as an animation source that dirties CSS3D transforms', () => {
    const tracker = createCss3DRenderDirtyTracker({ dirty: false })

    tracker.markDirtyForAnimationContinuation({
      sources: [
        ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation,
        ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.fieldEffectAnimation,
        ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion,
        ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.movementPreviewAnimation,
      ],
    })

    expect(tracker.snapshot()).toEqual({ dirty: true, reasons: ['token-motion'] })
  })

  it('documents the invalidation reasons that currently dirty CSS3D rendering', () => {
    const cssDirtyReasons: readonly RenderInvalidationReason[] = CSS3D_RENDER_DIRTY_INVALIDATION_REASONS

    expect(cssDirtyReasons).toContain('initial')
    expect(cssDirtyReasons).toContain('camera')
    expect(cssDirtyReasons).toContain('token-style')
    expect(cssDirtyReasons).toContain('movement-preview')
    expect(cssDirtyReasons).toContain('targeting')
    expect(cssDirtyReasons).toContain('pointer')
    expect(cssDirtyReasons).not.toContain('animation')
    expect(cssDirtyReasons).not.toContain('weather')
    expect(isCss3DRenderDirtyInvalidationReason('camera')).toBe(true)
    expect(isCss3DRenderDirtyInvalidationReason('weather')).toBe(false)
    expect(isCss3DRenderDirtyAnimationSource(ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion)).toBe(true)
    expect(isCss3DRenderDirtyAnimationSource(ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.spriteAnimation)).toBe(false)
  })
})
