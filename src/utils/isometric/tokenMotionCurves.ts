import { clamp01, easeInOutCubic, lerpNumber } from './moveVfxTiming'

/** Plain center-point shape used by token motion utilities without depending on three.js. */
export interface TokenMotionCenter {
  readonly x: number
  readonly y: number
  readonly z: number
}

export type TokenMotionReducedMotionPolicy = 'shorten' | 'snap'

export const TOKEN_MOTION_DURATION_DEFAULTS_MS = {
  /** Short enough to feel responsive for one-cell nudges, long enough to read as intentional. */
  min: 160,
  /** Keeps long remote moves from blocking the visual table for too long. */
  max: 520,
  /** Base duration scale before min/max caps are applied. */
  perGridUnit: 96,
  /** Accessible reduced-motion fallback when the caller wants a visible but brief state change. */
  reduced: 80,
} as const

export interface TokenMotionDurationOptions {
  readonly minDurationMs?: number
  readonly maxDurationMs?: number
  readonly msPerGridUnit?: number
  readonly reducedMotion?: boolean
  readonly reducedMotionPolicy?: TokenMotionReducedMotionPolicy
  readonly reducedMotionDurationMs?: number
}

const finiteNumberOrZero = (value: number): number => (Number.isFinite(value) ? value : 0)

const nonNegativeFiniteNumberOrDefault = (value: number | undefined, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback
)

const normalizeDurationBounds = (
  minDurationMs: number | undefined,
  maxDurationMs: number | undefined,
): { minDurationMs: number; maxDurationMs: number } => {
  const minMs = nonNegativeFiniteNumberOrDefault(
    minDurationMs,
    TOKEN_MOTION_DURATION_DEFAULTS_MS.min,
  )
  const rawMaxMs = nonNegativeFiniteNumberOrDefault(
    maxDurationMs,
    TOKEN_MOTION_DURATION_DEFAULTS_MS.max,
  )

  return {
    minDurationMs: minMs,
    maxDurationMs: Math.max(minMs, rawMaxMs),
  }
}

export const clampTokenMotionProgress = (progress: number): number => clamp01(progress)

/** Smooth start/stop curve for presentation-only token relocation. */
export const easeTokenMotionProgress = (progress: number): number => easeInOutCubic(progress)

export const normalizeTokenMotionDistance = (distance: number): number => (
  Number.isFinite(distance) ? Math.max(0, distance) : 0
)

export const tokenMotionDistanceBetweenCenters = (
  origin: TokenMotionCenter,
  destination: TokenMotionCenter,
): number => {
  const deltaX = finiteNumberOrZero(destination.x) - finiteNumberOrZero(origin.x)
  const deltaY = finiteNumberOrZero(destination.y) - finiteNumberOrZero(origin.y)
  const deltaZ = finiteNumberOrZero(destination.z) - finiteNumberOrZero(origin.z)

  return Math.hypot(deltaX, deltaY, deltaZ)
}

/**
 * Resolves a deterministic token-movement duration from grid/center distance.
 *
 * A zero or invalid distance snaps because there is no visible movement to bridge.
 * Non-zero distances are clamped to min/max caps. Reduced motion either snaps or
 * uses a short capped duration according to the explicit policy.
 */
export const resolveTokenMotionDurationMs = (
  gridDistance: number,
  options: TokenMotionDurationOptions = {},
): number => {
  const distance = normalizeTokenMotionDistance(gridDistance)
  if (distance <= 0) return 0

  const { minDurationMs, maxDurationMs } = normalizeDurationBounds(
    options.minDurationMs,
    options.maxDurationMs,
  )
  const msPerGridUnit = nonNegativeFiniteNumberOrDefault(
    options.msPerGridUnit,
    TOKEN_MOTION_DURATION_DEFAULTS_MS.perGridUnit,
  )
  const uncappedDurationMs = distance * msPerGridUnit
  const normalDurationMs = Math.min(
    maxDurationMs,
    Math.max(minDurationMs, uncappedDurationMs),
  )

  if (options.reducedMotion !== true) return normalDurationMs
  if ((options.reducedMotionPolicy ?? 'shorten') === 'snap') return 0

  const reducedDurationMs = nonNegativeFiniteNumberOrDefault(
    options.reducedMotionDurationMs,
    TOKEN_MOTION_DURATION_DEFAULTS_MS.reduced,
  )

  return Math.min(normalDurationMs, reducedDurationMs)
}

export const resolveTokenMotionDurationBetweenCentersMs = (
  origin: TokenMotionCenter,
  destination: TokenMotionCenter,
  options: TokenMotionDurationOptions = {},
): number => resolveTokenMotionDurationMs(
  tokenMotionDistanceBetweenCenters(origin, destination),
  options,
)

/** Interpolates a center point with clamped progress and without mutating inputs. */
export const interpolateTokenMotionCenter = (
  origin: TokenMotionCenter,
  destination: TokenMotionCenter,
  progress: number,
): TokenMotionCenter => ({
  x: lerpNumber(origin.x, destination.x, progress),
  y: lerpNumber(origin.y, destination.y, progress),
  z: lerpNumber(origin.z, destination.z, progress),
})
