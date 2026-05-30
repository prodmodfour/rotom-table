import { describe, expect, it } from 'vitest'
import {
  MOVE_VFX_DEFAULT_DURATIONS_MS,
  animationProgress,
  clamp01,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  lerpNumber,
  linear,
  pulse01,
} from '~/utils/isometric/moveVfxTiming'

describe('move VFX timing helpers', () => {
  it('exports documented default duration tiers', () => {
    expect(MOVE_VFX_DEFAULT_DURATIONS_MS).toEqual({
      quick: 220,
      normal: 500,
      long: 840,
      linger: 1100,
    })

    expect(MOVE_VFX_DEFAULT_DURATIONS_MS.quick).toBeGreaterThanOrEqual(180)
    expect(MOVE_VFX_DEFAULT_DURATIONS_MS.quick).toBeLessThanOrEqual(280)
    expect(MOVE_VFX_DEFAULT_DURATIONS_MS.normal).toBeGreaterThanOrEqual(420)
    expect(MOVE_VFX_DEFAULT_DURATIONS_MS.normal).toBeLessThanOrEqual(620)
    expect(MOVE_VFX_DEFAULT_DURATIONS_MS.long).toBeGreaterThanOrEqual(720)
    expect(MOVE_VFX_DEFAULT_DURATIONS_MS.long).toBeLessThanOrEqual(1000)
    expect(MOVE_VFX_DEFAULT_DURATIONS_MS.linger).toBeLessThanOrEqual(1100)
  })

  it('clamps normalized progress safely', () => {
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(0)).toBe(0)
    expect(clamp01(0.375)).toBe(0.375)
    expect(clamp01(1)).toBe(1)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0)
    expect(clamp01(Number.NaN)).toBe(0)
  })

  it('provides deterministic easing curves over clamped progress', () => {
    expect(linear(-1)).toBe(0)
    expect(linear(0.35)).toBe(0.35)
    expect(linear(2)).toBe(1)

    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(0.5)).toBe(0.875)
    expect(easeOutCubic(1)).toBe(1)

    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(0.25)).toBe(0.0625)
    expect(easeInOutCubic(0.5)).toBe(0.5)
    expect(easeInOutCubic(0.75)).toBe(0.9375)
    expect(easeInOutCubic(1)).toBe(1)
  })

  it('supports overshooting back ease without extrapolating input progress', () => {
    expect(easeOutBack(0)).toBeCloseTo(0)
    expect(easeOutBack(0.5)).toBeGreaterThan(1)
    expect(easeOutBack(1)).toBeCloseTo(1)
    expect(easeOutBack(2)).toBeCloseTo(1)
  })

  it('creates a simple midpoint pulse', () => {
    expect(pulse01(-1)).toBe(0)
    expect(pulse01(0)).toBe(0)
    expect(pulse01(0.25)).toBeCloseTo(Math.SQRT1_2)
    expect(pulse01(0.5)).toBe(1)
    expect(pulse01(0.75)).toBeCloseTo(Math.SQRT1_2)
    expect(pulse01(1)).toBe(0)
    expect(pulse01(2)).toBe(0)
  })

  it('interpolates numbers with clamped animation progress', () => {
    expect(lerpNumber(10, 20, -1)).toBe(10)
    expect(lerpNumber(10, 20, 0)).toBe(10)
    expect(lerpNumber(10, 20, 0.25)).toBe(12.5)
    expect(lerpNumber(10, 20, 1)).toBe(20)
    expect(lerpNumber(10, 20, 2)).toBe(20)
    expect(lerpNumber(20, 10, 0.5)).toBe(15)
  })

  it('computes clamped progress before, during, and after an animation', () => {
    expect(animationProgress(900, 1000, 500)).toEqual({
      elapsedMs: 0,
      durationMs: 500,
      progress: 0,
      complete: false,
    })

    expect(animationProgress(1250, 1000, 500)).toEqual({
      elapsedMs: 250,
      durationMs: 500,
      progress: 0.5,
      complete: false,
    })

    expect(animationProgress(1700, 1000, 500)).toEqual({
      elapsedMs: 700,
      durationMs: 500,
      progress: 1,
      complete: true,
    })
  })

  it('handles zero, negative, and invalid durations without division edge cases', () => {
    expect(animationProgress(900, 1000, 0)).toEqual({
      elapsedMs: 0,
      durationMs: 0,
      progress: 0,
      complete: false,
    })

    expect(animationProgress(1000, 1000, 0)).toEqual({
      elapsedMs: 0,
      durationMs: 0,
      progress: 1,
      complete: true,
    })

    expect(animationProgress(1200, 1000, -200)).toEqual({
      elapsedMs: 200,
      durationMs: 0,
      progress: 1,
      complete: true,
    })

    expect(animationProgress(1200, 1000, Number.POSITIVE_INFINITY)).toEqual({
      elapsedMs: 200,
      durationMs: 0,
      progress: 1,
      complete: true,
    })
  })
})
