import { describe, expect, it } from 'vitest'
import {
  TOKEN_MOTION_DURATION_DEFAULTS_MS,
  TOKEN_MOTION_HOP_DEFAULTS,
  applyTokenMotionHopOffset,
  clampTokenMotionProgress,
  easeTokenMotionProgress,
  interpolateTokenMotionCenter,
  normalizeTokenMotionDistance,
  resolveTokenMotionDurationBetweenCentersMs,
  resolveTokenMotionDurationMs,
  resolveTokenMotionHopHeight,
  sampleTokenMotionHopOffset,
  tokenMotionDistanceBetweenCenters,
} from '~/utils/isometric/tokenMotionCurves'

describe('token motion curve utilities', () => {
  it('clamps raw progress before easing', () => {
    expect(clampTokenMotionProgress(-0.25)).toBe(0)
    expect(clampTokenMotionProgress(0)).toBe(0)
    expect(clampTokenMotionProgress(0.5)).toBe(0.5)
    expect(clampTokenMotionProgress(1)).toBe(1)
    expect(clampTokenMotionProgress(1.25)).toBe(1)
  })

  it('eases token motion with deterministic smooth start and stop values', () => {
    expect(easeTokenMotionProgress(0)).toBe(0)
    expect(easeTokenMotionProgress(0.25)).toBe(0.0625)
    expect(easeTokenMotionProgress(0.5)).toBe(0.5)
    expect(easeTokenMotionProgress(0.75)).toBe(0.9375)
    expect(easeTokenMotionProgress(1)).toBe(1)

    expect(easeTokenMotionProgress(-1)).toBe(0)
    expect(easeTokenMotionProgress(2)).toBe(1)
  })

  it('measures center distance without depending on three.js vectors', () => {
    expect(tokenMotionDistanceBetweenCenters(
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 4, z: 12 },
    )).toBe(13)

    expect(tokenMotionDistanceBetweenCenters(
      { x: Number.NaN, y: 0, z: 0 },
      { x: 3, y: Number.POSITIVE_INFINITY, z: 4 },
    )).toBe(5)
  })

  it('normalizes movement distances for deterministic duration planning', () => {
    expect(normalizeTokenMotionDistance(-4)).toBe(0)
    expect(normalizeTokenMotionDistance(0)).toBe(0)
    expect(normalizeTokenMotionDistance(2.5)).toBe(2.5)
    expect(normalizeTokenMotionDistance(Number.NaN)).toBe(0)
    expect(normalizeTokenMotionDistance(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('resolves distance-based durations with min and max caps', () => {
    expect(resolveTokenMotionDurationMs(0)).toBe(0)
    expect(resolveTokenMotionDurationMs(0.25)).toBe(TOKEN_MOTION_DURATION_DEFAULTS_MS.min)
    expect(resolveTokenMotionDurationMs(3)).toBe(288)
    expect(resolveTokenMotionDurationMs(100)).toBe(TOKEN_MOTION_DURATION_DEFAULTS_MS.max)

    expect(resolveTokenMotionDurationMs(3, {
      minDurationMs: 50,
      maxDurationMs: 500,
      msPerGridUnit: 100,
    })).toBe(300)
  })

  it('keeps duration bounds deterministic when options are invalid or inverted', () => {
    expect(resolveTokenMotionDurationMs(2, {
      minDurationMs: 300,
      maxDurationMs: 100,
      msPerGridUnit: 80,
    })).toBe(300)

    expect(resolveTokenMotionDurationMs(2, {
      minDurationMs: Number.NaN,
      maxDurationMs: Number.POSITIVE_INFINITY,
      msPerGridUnit: Number.NaN,
    })).toBe(192)
  })

  it('applies reduced-motion policies as a short duration or snap', () => {
    expect(resolveTokenMotionDurationMs(4)).toBe(384)
    expect(resolveTokenMotionDurationMs(4, { reducedMotion: true })).toBe(
      TOKEN_MOTION_DURATION_DEFAULTS_MS.reduced,
    )
    expect(resolveTokenMotionDurationMs(4, {
      reducedMotion: true,
      reducedMotionDurationMs: 40,
    })).toBe(40)
    expect(resolveTokenMotionDurationMs(4, {
      reducedMotion: true,
      reducedMotionPolicy: 'snap',
    })).toBe(0)
    expect(resolveTokenMotionDurationMs(0, {
      reducedMotion: true,
      reducedMotionDurationMs: 40,
    })).toBe(0)
  })

  it('resolves durations directly between centers', () => {
    expect(resolveTokenMotionDurationBetweenCentersMs(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
    )).toBe(192)
  })

  it('interpolates 3D center points with clamped progress without mutating inputs', () => {
    const origin = { x: 1, y: 2, z: 3 }
    const destination = { x: 5, y: 10, z: 11 }

    expect(interpolateTokenMotionCenter(origin, destination, -1)).toEqual(origin)
    expect(interpolateTokenMotionCenter(origin, destination, 0)).toEqual(origin)
    expect(interpolateTokenMotionCenter(origin, destination, 0.5)).toEqual({
      x: 3,
      y: 6,
      z: 7,
    })
    expect(interpolateTokenMotionCenter(origin, destination, 1)).toEqual(destination)
    expect(interpolateTokenMotionCenter(origin, destination, 2)).toEqual(destination)

    expect(origin).toEqual({ x: 1, y: 2, z: 3 })
    expect(destination).toEqual({ x: 5, y: 10, z: 11 })
  })

  it('samples a deterministic hop offset that starts and ends grounded', () => {
    expect(sampleTokenMotionHopOffset(0, 0.12)).toBe(0)
    expect(sampleTokenMotionHopOffset(0.25, 0.12)).toBeCloseTo(0.09)
    expect(sampleTokenMotionHopOffset(0.5, 0.12)).toBeCloseTo(0.12)
    expect(sampleTokenMotionHopOffset(0.75, 0.12)).toBeCloseTo(0.09)
    expect(sampleTokenMotionHopOffset(1, 0.12)).toBe(0)

    expect(sampleTokenMotionHopOffset(-1, 0.12)).toBe(0)
    expect(sampleTokenMotionHopOffset(2, 0.12)).toBe(0)
    expect(sampleTokenMotionHopOffset(0.5, Number.NaN)).toBe(0)
  })

  it('applies a visual-only hop to center y without mutating the source center', () => {
    const center = { x: 2, y: 1, z: 4 }

    expect(applyTokenMotionHopOffset(center, 0.5, 0.12)).toEqual({ x: 2, y: 1.12, z: 4 })
    expect(applyTokenMotionHopOffset(center, 0.5, 0)).toBe(center)
    expect(center).toEqual({ x: 2, y: 1, z: 4 })
  })

  it('resolves subtle elevation-hop heights with reduced-motion controls', () => {
    const origin = { x: 0, y: 0, z: 0 }

    expect(resolveTokenMotionHopHeight(origin, { x: 0, y: 0, z: 0 })).toBe(0)
    expect(resolveTokenMotionHopHeight(origin, { x: 3, y: 0, z: 0 })).toBe(0)
    expect(resolveTokenMotionHopHeight(origin, { x: 3, y: 0, z: 0 }, {
      includeHorizontalHop: true,
    })).toBe(TOKEN_MOTION_HOP_DEFAULTS.sameElevationHeight)
    expect(resolveTokenMotionHopHeight(origin, { x: 0, y: 1, z: 0 })).toBe(
      TOKEN_MOTION_HOP_DEFAULTS.minElevationChangeHeight,
    )
    expect(resolveTokenMotionHopHeight(origin, { x: 0, y: 10, z: 0 })).toBe(
      TOKEN_MOTION_HOP_DEFAULTS.maxHeight,
    )
    expect(resolveTokenMotionHopHeight(origin, { x: 0, y: 1, z: 0 }, {
      reducedMotion: true,
    })).toBe(0)
    expect(resolveTokenMotionHopHeight(origin, { x: 0, y: 2, z: 0 }, {
      reducedMotion: true,
      reducedMotionHeightScale: 0.25,
    })).toBeCloseTo(0.04)
    expect(resolveTokenMotionHopHeight(origin, { x: 0, y: 2, z: 0 }, {
      enabled: false,
    })).toBe(0)
  })
})
