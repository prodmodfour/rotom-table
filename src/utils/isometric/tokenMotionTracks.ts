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
  /** Runtime-only segment metadata for path-aware sampling; never persisted to map data. */
  readonly pathSegments?: readonly TokenMotionPathSegment[]
}

export interface CreateTokenMotionPathSegmentsOptions {
  readonly origin: TokenMotionCenter
  readonly destination: TokenMotionCenter
  readonly pathCenters?: readonly TokenMotionCenter[]
  readonly totalDurationMs: number
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
  readonly pathCenters?: readonly TokenMotionCenter[]
}

export interface ReplaceTokenMotionTrackOptions {
  readonly destination: TokenMotionCenter
  readonly replaceAtMs: number
  readonly reason?: TokenMotionTrackReason
  readonly durationMs?: number
  readonly durationOptions?: TokenMotionDurationOptions
  readonly pathSegments?: readonly TokenMotionPathSegment[]
  readonly pathCenters?: readonly TokenMotionCenter[]
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

interface TokenMotionPathPlan {
  readonly centers: readonly TokenMotionCenter[]
  readonly distances: readonly number[]
  readonly distance: number
}

const TOKEN_MOTION_PATH_CENTER_EPSILON = 1e-6

const finiteNumberOrZero = (value: number): number => (Number.isFinite(value) ? value : 0)

const nonNegativeFiniteNumberOrZero = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, value) : 0
)

const normalizeTokenMotionCenter = (center: TokenMotionCenter): TokenMotionCenter => ({
  x: finiteNumberOrZero(center.x),
  y: finiteNumberOrZero(center.y),
  z: finiteNumberOrZero(center.z),
})

const isFiniteTokenMotionCenter = (center: TokenMotionCenter): boolean => (
  Number.isFinite(center.x)
  && Number.isFinite(center.y)
  && Number.isFinite(center.z)
)

const tokenMotionCentersNearlyEqual = (
  left: TokenMotionCenter,
  right: TokenMotionCenter,
): boolean => tokenMotionDistanceBetweenCenters(left, right) <= TOKEN_MOTION_PATH_CENTER_EPSILON

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

const planTokenMotionPathCenters = (
  origin: TokenMotionCenter,
  destination: TokenMotionCenter,
  pathCenters: readonly TokenMotionCenter[] | undefined,
): TokenMotionPathPlan | null => {
  if (!pathCenters || pathCenters.length < 2) return null
  if (pathCenters.some((center) => !isFiniteTokenMotionCenter(center))) return null

  const plannedCenters: TokenMotionCenter[] = [normalizeTokenMotionCenter(origin)]
  for (const center of pathCenters) {
    const nextCenter = normalizeTokenMotionCenter(center)
    const previousCenter = plannedCenters[plannedCenters.length - 1]
    if (!previousCenter || !tokenMotionCentersNearlyEqual(previousCenter, nextCenter)) {
      plannedCenters.push(nextCenter)
    }
  }

  const normalizedDestination = normalizeTokenMotionCenter(destination)
  const finalPlannedCenter = plannedCenters[plannedCenters.length - 1]
  if (!finalPlannedCenter || !tokenMotionCentersNearlyEqual(finalPlannedCenter, normalizedDestination)) {
    plannedCenters.push(normalizedDestination)
  }

  const compactCenters: TokenMotionCenter[] = []
  for (const center of plannedCenters) {
    const previousCenter = compactCenters[compactCenters.length - 1]
    if (!previousCenter || !tokenMotionCentersNearlyEqual(previousCenter, center)) {
      compactCenters.push(center)
    }
  }

  if (compactCenters.length < 2) return null

  const distances: number[] = []
  let distance = 0
  for (let index = 1; index < compactCenters.length; index += 1) {
    const segmentDistance = tokenMotionDistanceBetweenCenters(
      compactCenters[index - 1]!,
      compactCenters[index]!,
    )
    distances.push(segmentDistance)
    distance += segmentDistance
  }

  if (distance <= TOKEN_MOTION_PATH_CENTER_EPSILON) return null

  return {
    centers: compactCenters,
    distances,
    distance,
  }
}

const pathSegmentsFromPlan = (
  plan: TokenMotionPathPlan,
  totalDurationMs: number,
): readonly TokenMotionPathSegment[] => {
  const durationMs = nonNegativeFiniteNumberOrZero(totalDurationMs)
  let assignedDurationMs = 0

  return Object.freeze(plan.distances.map((segmentDistance, index) => {
    const lastSegment = index === plan.distances.length - 1
    const proportionalDurationMs = plan.distance <= 0
      ? 0
      : durationMs * (segmentDistance / plan.distance)
    const segmentDurationMs = lastSegment
      ? Math.max(0, durationMs - assignedDurationMs)
      : nonNegativeFiniteNumberOrZero(proportionalDurationMs)
    assignedDurationMs += segmentDurationMs

    return Object.freeze({
      origin: freezeTokenMotionCenter(plan.centers[index]!),
      destination: freezeTokenMotionCenter(plan.centers[index + 1]!),
      durationMs: segmentDurationMs,
    })
  }))
}

export const createTokenMotionPathSegments = ({
  origin,
  destination,
  pathCenters,
  totalDurationMs,
}: CreateTokenMotionPathSegmentsOptions): readonly TokenMotionPathSegment[] | undefined => {
  const plan = planTokenMotionPathCenters(origin, destination, pathCenters)
  return plan ? pathSegmentsFromPlan(plan, totalDurationMs) : undefined
}

const tokenMotionPathDistanceForSegments = (
  pathSegments: readonly TokenMotionPathSegment[] | undefined,
): number | undefined => {
  if (!pathSegments || pathSegments.length === 0) return undefined

  const distance = pathSegments.reduce((total, segment) => (
    total + tokenMotionDistanceBetweenCenters(segment.origin, segment.destination)
  ), 0)

  return distance > TOKEN_MOTION_PATH_CENTER_EPSILON ? distance : undefined
}

const resolveTrackDurationMs = (
  origin: TokenMotionCenter,
  destination: TokenMotionCenter,
  durationMs: number | undefined,
  durationOptions: TokenMotionDurationOptions | undefined,
  pathDistance: number | undefined,
): number => {
  const explicitDurationMs = normalizeOptionalDurationMs(durationMs)
  if (explicitDurationMs !== undefined) return explicitDurationMs

  return pathDistance === undefined
    ? resolveTokenMotionDurationBetweenCentersMs(origin, destination, durationOptions)
    : resolveTokenMotionDurationMs(pathDistance, durationOptions)
}

const resolveReplacementTrackDurationMs = (
  track: TokenMotionTrack,
  origin: TokenMotionCenter,
  destination: TokenMotionCenter,
  options: Pick<ReplaceTokenMotionTrackOptions, 'durationMs' | 'durationOptions'>,
  pathDistance: number | undefined,
): number => {
  const explicitDurationMs = normalizeOptionalDurationMs(options.durationMs)
  if (explicitDurationMs !== undefined) return explicitDurationMs

  const replacementDistance = pathDistance ?? tokenMotionDistanceBetweenCenters(origin, destination)
  if (replacementDistance <= 0) return 0

  if (options.durationOptions) {
    return resolveTokenMotionDurationMs(replacementDistance, options.durationOptions)
  }

  const previousDistance = tokenMotionPathDistanceForSegments(track.pathSegments)
    ?? tokenMotionDistanceBetweenCenters(track.origin, track.destination)
  const previousDurationMs = nonNegativeFiniteNumberOrZero(track.durationMs)
  if (previousDistance <= 0 || previousDurationMs <= 0) {
    return resolveTokenMotionDurationMs(replacementDistance)
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

const sampleTokenMotionPathSegments = (
  pathSegments: readonly TokenMotionPathSegment[] | undefined,
  easedProgress: number,
): TokenMotionCenter | null => {
  if (!pathSegments || pathSegments.length === 0) return null

  const segmentDurationTotal = pathSegments.reduce((total, segment) => (
    total + nonNegativeFiniteNumberOrZero(segment.durationMs)
  ), 0)
  if (segmentDurationTotal <= 0) return null

  const pathOffsetMs = clampTokenMotionProgress(easedProgress) * segmentDurationTotal
  let segmentStartMs = 0

  for (let index = 0; index < pathSegments.length; index += 1) {
    const segment = pathSegments[index]!
    const segmentDurationMs = nonNegativeFiniteNumberOrZero(segment.durationMs)
    const segmentEndMs = segmentStartMs + segmentDurationMs
    const lastSegment = index === pathSegments.length - 1

    if (pathOffsetMs <= segmentEndMs || lastSegment) {
      const segmentProgress = segmentDurationMs <= 0
        ? 1
        : clampTokenMotionProgress((pathOffsetMs - segmentStartMs) / segmentDurationMs)
      return interpolateTokenMotionCenter(segment.origin, segment.destination, segmentProgress)
    }

    segmentStartMs = segmentEndMs
  }

  return normalizeTokenMotionCenter(pathSegments[pathSegments.length - 1]!.destination)
}

export const startTokenMotionTrack = (options: StartTokenMotionTrackOptions): TokenMotionTrack => {
  const origin = freezeTokenMotionCenter(options.origin)
  const destination = freezeTokenMotionCenter(options.destination)
  const explicitPathSegments = clonePathSegments(options.pathSegments)
  const pathCenterPlan = planTokenMotionPathCenters(origin, destination, options.pathCenters)
  const durationMs = resolveTrackDurationMs(
    origin,
    destination,
    options.durationMs,
    options.durationOptions,
    pathCenterPlan?.distance,
  )
  const resolvedPathSegments = explicitPathSegments
    ?? (pathCenterPlan ? pathSegmentsFromPlan(pathCenterPlan, durationMs) : undefined)

  return brandRuntimeTrack({
    tokenId: options.tokenId,
    origin,
    destination,
    startMs: finiteNumberOrZero(options.startMs),
    durationMs,
    reason: options.reason,
    ...(resolvedPathSegments ? { pathSegments: resolvedPathSegments } : {}),
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
    center: sampleTokenMotionPathSegments(track.pathSegments, easedProgress)
      ?? interpolateTokenMotionCenter(origin, destination, easedProgress),
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
  const explicitPathSegments = clonePathSegments(options.pathSegments)
  const pathCenterPlan = planTokenMotionPathCenters(origin, destination, options.pathCenters)
  const durationMs = resolveReplacementTrackDurationMs(
    track,
    origin,
    destination,
    options,
    pathCenterPlan?.distance,
  )
  const resolvedPathSegments = explicitPathSegments
    ?? (pathCenterPlan ? pathSegmentsFromPlan(pathCenterPlan, durationMs) : undefined)

  return startTokenMotionTrack({
    tokenId: track.tokenId,
    origin,
    destination,
    startMs: options.replaceAtMs,
    reason: options.reason ?? track.reason,
    durationMs,
    durationOptions: options.durationOptions,
    pathSegments: resolvedPathSegments,
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
