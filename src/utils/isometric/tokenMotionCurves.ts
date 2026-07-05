import { clamp01, easeInOutCubic, lerpNumber } from './moveVfxTiming'

/** Plain center-point shape used by token motion utilities without depending on three.js. */
export interface TokenMotionCenter {
  readonly x: number
  readonly y: number
  readonly z: number
}

export type TokenMotionReducedMotionPolicy = 'shorten' | 'snap'
export type TokenMotionPerformanceMode = 'animate' | 'snap'

export const TOKEN_MOTION_HOP_DEFAULTS = {
  /** Subtle same-level cell hop available to callers that opt in. */
  sameElevationHeight: 0.06,
  /** Minimum readable affordance when a token changes elevation. */
  minElevationChangeHeight: 0.12,
  /** Adds a little more clearance for larger vertical deltas without becoming floaty. */
  perElevationUnit: 0.08,
  /** Keeps the hop tactical and below the scale of a full grid cell. */
  maxHeight: 0.32,
  /** Reduced-motion default removes the hop; callers may opt into a small scale. */
  reducedMotionHeightScale: 0,
} as const

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

export const TOKEN_MOTION_PERFORMANCE_DEFAULTS = {
  /** Upper bound for simultaneous token movement tracks before overflow changes snap. */
  maxSimultaneousTracks: 24,
} as const

export interface TokenMotionDurationOptions {
  readonly minDurationMs?: number
  readonly maxDurationMs?: number
  readonly msPerGridUnit?: number
  readonly reducedMotion?: boolean
  readonly reducedMotionPolicy?: TokenMotionReducedMotionPolicy
  readonly reducedMotionDurationMs?: number
}

export interface TokenMotionHopOptions {
  /** Explicit opt-out for callers that need purely flat interpolation. */
  readonly enabled?: boolean
  /** Shared reduced-motion flag; usually forwarded from duration options. */
  readonly reducedMotion?: boolean
  readonly reducedMotionPolicy?: TokenMotionReducedMotionPolicy
  /** Same-elevation horizontal moves only hop when this is explicitly enabled. */
  readonly includeHorizontalHop?: boolean
  readonly sameElevationHeight?: number
  readonly minElevationChangeHeight?: number
  readonly elevationHeightPerGridUnit?: number
  readonly maxHeight?: number
  readonly reducedMotionHeightScale?: number
}

export interface TokenMotionPerformanceOptions {
  /** Number of already-active token tracks before considering the current token. */
  readonly activeTrackCount?: number
  /** Maximum tracks allowed to animate at the same time; overflow snaps. */
  readonly maxSimultaneousTracks?: number
}

const TOKEN_MOTION_HOP_EPSILON = 1e-6

const finiteNumberOrZero = (value: number): number => (Number.isFinite(value) ? value : 0)

const nonNegativeFiniteNumberOrDefault = (value: number | undefined, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback
)

const nonNegativeIntegerOrDefault = (value: number | undefined, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback
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

export const normalizeTokenMotionTrackCount = (count: number | undefined): number => (
  nonNegativeIntegerOrDefault(count, 0)
)

export const resolveTokenMotionPerformanceMode = (
  options: TokenMotionPerformanceOptions = {},
): TokenMotionPerformanceMode => {
  const activeTrackCount = normalizeTokenMotionTrackCount(options.activeTrackCount)
  const maxSimultaneousTracks = nonNegativeIntegerOrDefault(
    options.maxSimultaneousTracks,
    TOKEN_MOTION_PERFORMANCE_DEFAULTS.maxSimultaneousTracks,
  )

  return activeTrackCount >= maxSimultaneousTracks ? 'snap' : 'animate'
}

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

export const sampleTokenMotionHopOffset = (
  progress: number,
  hopHeight: number,
): number => {
  const height = normalizeTokenMotionDistance(hopHeight)
  if (height <= 0) return 0

  const clampedProgress = clampTokenMotionProgress(progress)
  return 4 * clampedProgress * (1 - clampedProgress) * height
}

export const applyTokenMotionHopOffset = (
  center: TokenMotionCenter,
  progress: number,
  hopHeight: number | undefined,
): TokenMotionCenter => {
  const offsetY = sampleTokenMotionHopOffset(progress, hopHeight ?? 0)
  if (offsetY <= 0) return center

  return {
    x: center.x,
    y: center.y + offsetY,
    z: center.z,
  }
}

/**
 * Resolves the visual-only hop height used to make elevation steps readable.
 *
 * Elevation-changing moves receive a subtle default hop. Same-elevation
 * horizontal moves can opt in through `includeHorizontalHop`. Reduced motion
 * removes the hop by default unless a caller supplies a small scale.
 */
export const resolveTokenMotionHopHeight = (
  origin: TokenMotionCenter,
  destination: TokenMotionCenter,
  options: TokenMotionHopOptions = {},
): number => {
  if (options.enabled === false) return 0
  if (
    options.reducedMotion === true
    && (options.reducedMotionPolicy ?? 'shorten') === 'snap'
  ) return 0

  const horizontalDistance = Math.hypot(
    finiteNumberOrZero(destination.x) - finiteNumberOrZero(origin.x),
    finiteNumberOrZero(destination.z) - finiteNumberOrZero(origin.z),
  )
  const elevationDelta = Math.abs(
    finiteNumberOrZero(destination.y) - finiteNumberOrZero(origin.y),
  )

  let height = 0
  if (elevationDelta > TOKEN_MOTION_HOP_EPSILON) {
    const minHeight = nonNegativeFiniteNumberOrDefault(
      options.minElevationChangeHeight,
      TOKEN_MOTION_HOP_DEFAULTS.minElevationChangeHeight,
    )
    const perElevationUnit = nonNegativeFiniteNumberOrDefault(
      options.elevationHeightPerGridUnit,
      TOKEN_MOTION_HOP_DEFAULTS.perElevationUnit,
    )
    height = Math.max(minHeight, elevationDelta * perElevationUnit)
  } else if (
    options.includeHorizontalHop === true
    && horizontalDistance > TOKEN_MOTION_HOP_EPSILON
  ) {
    height = nonNegativeFiniteNumberOrDefault(
      options.sameElevationHeight,
      TOKEN_MOTION_HOP_DEFAULTS.sameElevationHeight,
    )
  }

  if (height <= 0) return 0

  const maxHeight = nonNegativeFiniteNumberOrDefault(
    options.maxHeight,
    TOKEN_MOTION_HOP_DEFAULTS.maxHeight,
  )
  const cappedHeight = Math.min(height, maxHeight)

  if (options.reducedMotion === true) {
    const reducedScale = nonNegativeFiniteNumberOrDefault(
      options.reducedMotionHeightScale,
      TOKEN_MOTION_HOP_DEFAULTS.reducedMotionHeightScale,
    )
    return cappedHeight * Math.min(1, reducedScale)
  }

  return cappedHeight
}
