import {
  clampTokenMotionProgress,
  easeTokenMotionProgress,
  interpolateTokenMotionCenter,
  resolveTokenMotionDurationBetweenCentersMs,
  resolveTokenMotionDurationMs,
  tokenMotionDistanceBetweenCenters,
  type TokenMotionCenter,
  type TokenMotionDurationOptions,
} from './tokenMotionCurves'

export const TOKEN_MOTION_TRACK_RUNTIME_BRAND: unique symbol = Symbol('tokenMotionTrackRuntimeBrand')

export type TokenMotionTrackReason =
  | 'local-prediction'
  | 'remote-accepted'
  | 'server-correction'
  | 'reconciliation'
  | 'setup-edit'

export type TokenMotionCancelMode = 'sample-current' | 'snap-to-destination' | 'snap-to-origin'

export interface TokenMotionPathSegment {
  readonly origin: TokenMotionCenter
  readonly destination: TokenMotionCenter
  readonly durationMs: number
}

export interface TokenMotionTrack {
  readonly [TOKEN_MOTION_TRACK_RUNTIME_BRAND]: true
  readonly tokenId: string
  readonly origin: TokenMotionCenter
  readonly destination: TokenMotionCenter
  readonly startMs: number
  readonly durationMs: number
  readonly reason: TokenMotionTrackReason
  /** Runtime-only segment metadata for later path-aware sampling; never persisted to map data. */
  readonly pathSegments?: readonly TokenMotionPathSegment[]
}

export interface StartTokenMotionTrackOptions {
  readonly tokenId: string
  readonly origin: TokenMotionCenter
  readonly destination: TokenMotionCenter
  readonly startMs: number
  readonly reason: TokenMotionTrackReason
  readonly durationMs?: number
  readonly durationOptions?: TokenMotionDurationOptions
  readonly pathSegments?: readonly TokenMotionPathSegment[]
}

export interface ReplaceTokenMotionTrackOptions {
  readonly destination: TokenMotionCenter
  readonly replaceAtMs: number
  readonly reason?: TokenMotionTrackReason
  readonly durationMs?: number
  readonly durationOptions?: TokenMotionDurationOptions
  readonly pathSegments?: readonly TokenMotionPathSegment[]
}

export interface TokenMotionSample {
  readonly center: TokenMotionCenter
  readonly elapsedMs: number
  readonly progress: number
  readonly easedProgress: number
  readonly complete: boolean
}

export interface TokenMotionCompletion {
  readonly center: TokenMotionCenter
  readonly completedAtMs: number
}

export interface CancelTokenMotionTrackOptions {
  readonly cancelAtMs: number
  readonly mode?: TokenMotionCancelMode
}

export interface TokenMotionCancellation {
  readonly center: TokenMotionCenter
  readonly cancelledAtMs: number
  readonly mode: TokenMotionCancelMode
}

const finiteNumberOrZero = (value: number): number => (Number.isFinite(value) ? value : 0)

const nonNegativeFiniteNumberOrZero = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, value) : 0
)

const normalizeTokenMotionCenter = (center: TokenMotionCenter): TokenMotionCenter => ({
  x: finiteNumberOrZero(center.x),
  y: finiteNumberOrZero(center.y),
  z: finiteNumberOrZero(center.z),
})

const freezeTokenMotionCenter = (center: TokenMotionCenter): TokenMotionCenter => Object.freeze(
  normalizeTokenMotionCenter(center),
)

const clonePathSegments = (
  pathSegments: readonly TokenMotionPathSegment[] | undefined,
): readonly TokenMotionPathSegment[] | undefined => {
  if (!pathSegments || pathSegments.length === 0) return undefined

  return Object.freeze(pathSegments.map((segment) => Object.freeze({
    origin: freezeTokenMotionCenter(segment.origin),
    destination: freezeTokenMotionCenter(segment.destination),
    durationMs: nonNegativeFiniteNumberOrZero(segment.durationMs),
  })))
}

const normalizeOptionalDurationMs = (durationMs: number | undefined): number | undefined => (
  typeof durationMs === 'number' && Number.isFinite(durationMs)
    ? Math.max(0, durationMs)
    : undefined
)

const resolveTrackDurationMs = (
  origin: TokenMotionCenter,
  destination: TokenMotionCenter,
  durationMs: number | undefined,
  durationOptions: TokenMotionDurationOptions | undefined,
): number => normalizeOptionalDurationMs(durationMs)
  ?? resolveTokenMotionDurationBetweenCentersMs(origin, destination, durationOptions)

const resolveReplacementTrackDurationMs = (
  track: TokenMotionTrack,
  origin: TokenMotionCenter,
  destination: TokenMotionCenter,
  options: Pick<ReplaceTokenMotionTrackOptions, 'durationMs' | 'durationOptions'>,
): number => {
  const explicitDurationMs = normalizeOptionalDurationMs(options.durationMs)
  if (explicitDurationMs !== undefined) return explicitDurationMs
  if (options.durationOptions) {
    return resolveTokenMotionDurationBetweenCentersMs(origin, destination, options.durationOptions)
  }

  const replacementDistance = tokenMotionDistanceBetweenCenters(origin, destination)
  if (replacementDistance <= 0) return 0

  const previousDistance = tokenMotionDistanceBetweenCenters(track.origin, track.destination)
  const previousDurationMs = nonNegativeFiniteNumberOrZero(track.durationMs)
  if (previousDistance <= 0 || previousDurationMs <= 0) {
    return resolveTokenMotionDurationBetweenCentersMs(origin, destination)
  }

  return resolveTokenMotionDurationMs(replacementDistance, {
    msPerGridUnit: previousDurationMs / previousDistance,
  })
}

const brandRuntimeTrack = (
  track: Omit<TokenMotionTrack, typeof TOKEN_MOTION_TRACK_RUNTIME_BRAND>,
): TokenMotionTrack => {
  Object.defineProperty(track, TOKEN_MOTION_TRACK_RUNTIME_BRAND, {
    enumerable: false,
    value: true,
  })

  return Object.freeze(track) as TokenMotionTrack
}

export const startTokenMotionTrack = (options: StartTokenMotionTrackOptions): TokenMotionTrack => {
  const origin = freezeTokenMotionCenter(options.origin)
  const destination = freezeTokenMotionCenter(options.destination)
  const pathSegments = clonePathSegments(options.pathSegments)

  return brandRuntimeTrack({
    tokenId: options.tokenId,
    origin,
    destination,
    startMs: finiteNumberOrZero(options.startMs),
    durationMs: resolveTrackDurationMs(
      origin,
      destination,
      options.durationMs,
      options.durationOptions,
    ),
    reason: options.reason,
    ...(pathSegments ? { pathSegments } : {}),
  })
}

export const sampleTokenMotionTrack = (
  track: TokenMotionTrack,
  frameNowMs: number,
): TokenMotionSample => {
  const origin = normalizeTokenMotionCenter(track.origin)
  const destination = normalizeTokenMotionCenter(track.destination)
  const startMs = finiteNumberOrZero(track.startMs)
  const durationMs = nonNegativeFiniteNumberOrZero(track.durationMs)
  const rawElapsedMs = finiteNumberOrZero(frameNowMs) - startMs
  const elapsedMs = Math.max(0, rawElapsedMs)

  if (durationMs <= 0) {
    const complete = rawElapsedMs >= 0
    const progress = complete ? 1 : 0
    return {
      center: complete ? destination : origin,
      elapsedMs,
      progress,
      easedProgress: progress,
      complete,
    }
  }

  const progress = clampTokenMotionProgress(rawElapsedMs / durationMs)
  const easedProgress = easeTokenMotionProgress(progress)
  const complete = rawElapsedMs >= durationMs

  if (progress <= 0) {
    return {
      center: origin,
      elapsedMs,
      progress,
      easedProgress,
      complete: false,
    }
  }

  if (complete) {
    return {
      center: destination,
      elapsedMs,
      progress: 1,
      easedProgress: 1,
      complete: true,
    }
  }

  return {
    center: interpolateTokenMotionCenter(origin, destination, easedProgress),
    elapsedMs,
    progress,
    easedProgress,
    complete,
  }
}

export const replaceTokenMotionTrack = (
  track: TokenMotionTrack,
  options: ReplaceTokenMotionTrackOptions,
): TokenMotionTrack => {
  const origin = sampleTokenMotionTrack(track, options.replaceAtMs).center
  const destination = normalizeTokenMotionCenter(options.destination)

  return startTokenMotionTrack({
    tokenId: track.tokenId,
    origin,
    destination,
    startMs: options.replaceAtMs,
    reason: options.reason ?? track.reason,
    durationMs: resolveReplacementTrackDurationMs(track, origin, destination, options),
    durationOptions: options.durationOptions,
    pathSegments: options.pathSegments,
  })
}

export const finishTokenMotionTrack = (
  track: TokenMotionTrack,
  completedAtMs = track.startMs + track.durationMs,
): TokenMotionCompletion => ({
  center: normalizeTokenMotionCenter(track.destination),
  completedAtMs: finiteNumberOrZero(completedAtMs),
})

export const cancelTokenMotionTrack = (
  track: TokenMotionTrack,
  options: CancelTokenMotionTrackOptions,
): TokenMotionCancellation => {
  const mode = options.mode ?? 'sample-current'
  const cancelledAtMs = finiteNumberOrZero(options.cancelAtMs)

  if (mode === 'snap-to-destination') {
    return {
      center: normalizeTokenMotionCenter(track.destination),
      cancelledAtMs,
      mode,
    }
  }

  if (mode === 'snap-to-origin') {
    return {
      center: normalizeTokenMotionCenter(track.origin),
      cancelledAtMs,
      mode,
    }
  }

  return {
    center: sampleTokenMotionTrack(track, cancelledAtMs).center,
    cancelledAtMs,
    mode,
  }
}
