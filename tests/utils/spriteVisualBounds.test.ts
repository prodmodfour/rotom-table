import { describe, expect, it } from 'vitest'
import type { SpriteVisualBounds } from '~/types/pokemon'
import {
  SPRITE_VISUAL_BOUNDS_MAX_WORLD_OFFSET_FACTOR,
  getSpriteVisualBoundsBodyCenter,
  getSpriteVisualBoundsFrameDebugMetrics,
  getSpriteVisualBoundsFrameTranslation,
  getSpriteVisualBoundsWorldYOffset,
} from '~/utils/spriteVisualBounds'

const visualBounds = (overrides: Partial<SpriteVisualBounds> = {}): SpriteVisualBounds => ({
  canvasWidth: 96,
  canvasHeight: 96,
  left: 24,
  top: 12,
  width: 48,
  height: 72,
  floating: true,
  ...overrides,
})

const expectNeutralFrameTranslation = (bounds: SpriteVisualBounds | null | undefined) => {
  expect(getSpriteVisualBoundsFrameTranslation(bounds)).toEqual({
    xPercent: 0,
    yPercent: 0,
  })
}

describe('sprite visual bounds math', () => {
  it('computes the visible body centre as normalized canvas coordinates', () => {
    expect(getSpriteVisualBoundsBodyCenter(visualBounds())).toEqual({
      x: 0.5,
      y: 0.5,
    })
  })

  it('leaves centred floating sprites visually neutral', () => {
    const centered = visualBounds()

    expect(getSpriteVisualBoundsFrameTranslation(centered)).toEqual({
      xPercent: 0,
      yPercent: 0,
    })
    expect(getSpriteVisualBoundsWorldYOffset(centered, { height: 2, clearance: 2 })).toBe(0)
  })

  it('returns zero offsets for non-floating bottom-grounded sprites', () => {
    const bottomGrounded = visualBounds({
      top: 36,
      height: 60,
      floating: false,
    })

    expectNeutralFrameTranslation(bottomGrounded)
    expect(getSpriteVisualBoundsWorldYOffset(bottomGrounded, { height: 2, clearance: 2 })).toBe(0)
  })

  it('moves floating hover sprites downward when their body centre is above the cage centre', () => {
    const hoverSprite = visualBounds({
      left: 24,
      top: 8,
      width: 48,
      height: 48,
      floating: true,
    })

    const translation = getSpriteVisualBoundsFrameTranslation(hoverSprite)
    expect(translation.xPercent).toBe(0)
    expect(translation.yPercent).toBeCloseTo(100 / 6)

    expect(getSpriteVisualBoundsWorldYOffset(hoverSprite, { height: 2, clearance: 2 }))
      .toBeCloseTo(-1 / 3)
  })

  it('accounts for object-fit letterboxing inside square CSS frames', () => {
    const wideCanvasHoverSprite = visualBounds({
      canvasWidth: 100,
      canvasHeight: 50,
      left: 25,
      top: 0,
      width: 50,
      height: 10,
      floating: true,
    })

    expect(getSpriteVisualBoundsFrameTranslation(wideCanvasHoverSprite)).toEqual({
      xPercent: 0,
      yPercent: 20,
    })
  })

  it('returns debug overlay metrics for canvas, bounds, body centre, and cage centre', () => {
    const wideCanvasHoverSprite = visualBounds({
      canvasWidth: 100,
      canvasHeight: 50,
      left: 25,
      top: 0,
      width: 50,
      height: 10,
      floating: true,
    })

    expect(getSpriteVisualBoundsFrameDebugMetrics(wideCanvasHoverSprite)).toEqual({
      canvas: {
        leftPercent: 0,
        topPercent: 25,
        widthPercent: 100,
        heightPercent: 50,
      },
      bounds: {
        leftPercent: 25,
        topPercent: 0,
        widthPercent: 50,
        heightPercent: 20,
      },
      bodyCenter: {
        xPercent: 50,
        yPercent: 10,
      },
      canvasCenter: {
        xPercent: 50,
        yPercent: 50,
      },
      cageCenter: {
        xPercent: 50,
        yPercent: 50,
      },
      translation: {
        xPercent: 0,
        yPercent: 20,
      },
      floating: true,
    })
  })

  it('returns safe neutral debug metrics when metadata is missing', () => {
    expect(getSpriteVisualBoundsFrameDebugMetrics(undefined)).toEqual({
      canvas: {
        leftPercent: 0,
        topPercent: 0,
        widthPercent: 100,
        heightPercent: 100,
      },
      bounds: null,
      bodyCenter: null,
      canvasCenter: {
        xPercent: 50,
        yPercent: 50,
      },
      cageCenter: {
        xPercent: 50,
        yPercent: 50,
      },
      translation: {
        xPercent: 0,
        yPercent: 0,
      },
      floating: false,
    })
  })

  it('falls back to neutral centres and offsets for missing or malformed bounds', () => {
    expect(getSpriteVisualBoundsBodyCenter(undefined)).toEqual({ x: 0.5, y: 0.5 })
    expect(getSpriteVisualBoundsBodyCenter(visualBounds({ width: 0 }))).toEqual({ x: 0.5, y: 0.5 })
    expect(getSpriteVisualBoundsBodyCenter(visualBounds({ canvasHeight: Number.NaN }))).toEqual({
      x: 0.5,
      y: 0.5,
    })

    expectNeutralFrameTranslation(undefined)
    expectNeutralFrameTranslation(visualBounds({ width: 0 }))
    expectNeutralFrameTranslation(visualBounds({ canvasWidth: 0 }))
    expect(getSpriteVisualBoundsWorldYOffset(visualBounds({ height: 0 }), { height: 2, clearance: 2 })).toBe(0)
    expect(getSpriteVisualBoundsWorldYOffset(visualBounds(), { height: 0, clearance: 2 })).toBe(0)
    expect(getSpriteVisualBoundsWorldYOffset(visualBounds(), { height: 2, clearance: 0 })).toBe(0)
  })

  it('clamps extreme world offsets from suspicious metadata', () => {
    const suspiciousTopWeightedSprite = visualBounds({
      canvasWidth: 100,
      canvasHeight: 100,
      left: 0,
      top: 0,
      width: 100,
      height: 1,
      floating: true,
    })

    const height = 20
    const clearance = 2
    expect(getSpriteVisualBoundsWorldYOffset(suspiciousTopWeightedSprite, { height, clearance }))
      .toBeCloseTo(-height * SPRITE_VISUAL_BOUNDS_MAX_WORLD_OFFSET_FACTOR)
  })
})
