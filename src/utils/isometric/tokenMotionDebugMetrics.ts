import type {
  TokenMotionTrack,
  TokenMotionTrackReason,
} from '~/utils/isometric/tokenMotionTracks'

export const TOKEN_MOTION_DEBUG_REASONS: readonly TokenMotionTrackReason[] = Object.freeze([
  'local-prediction',
  'remote-accepted',
  'server-correction',
  'reconciliation',
  'setup-edit',
])

export interface TokenMotionDebugRenderObject {
  readonly motion?: {
    readonly track?: TokenMotionTrack
  }
}

export interface TokenMotionDebugSourceReasonCounts {
  readonly reason: TokenMotionTrackReason
  readonly activeCount: number
  readonly startedCount: number
  readonly completedCount: number
}

export interface TokenMotionDebugMetrics {
  readonly activeMovingTokenCount: number
  readonly longestActiveMotionAgeMs: number | null
  readonly completedMotionCount: number
  readonly sourceReasonCounts: readonly TokenMotionDebugSourceReasonCounts[]
}

export interface TokenMotionDebugMetricsSnapshotOptions {
  readonly renderObjects: Iterable<TokenMotionDebugRenderObject>
  readonly nowMs: number
}

export interface TokenMotionDebugMetricsSampler {
  readonly recordMotionStarted: (track: TokenMotionTrack) => void
  readonly recordMotionCompleted: (track: TokenMotionTrack) => void
  readonly snapshot: (options: TokenMotionDebugMetricsSnapshotOptions) => TokenMotionDebugMetrics
  readonly reset: () => void
}

type MutableReasonCountMap = Record<TokenMotionTrackReason, number>

const createEmptyReasonCountMap = (): MutableReasonCountMap => ({
  'local-prediction': 0,
  'remote-accepted': 0,
  'server-correction': 0,
  reconciliation: 0,
  'setup-edit': 0,
})

const finiteNonNegative = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, value) : 0
)

const incrementReasonCount = (
  counts: MutableReasonCountMap,
  reason: TokenMotionTrackReason,
): void => {
  counts[reason] = (counts[reason] ?? 0) + 1
}

const sourceReasonRows = (
  activeCounts: Readonly<MutableReasonCountMap>,
  startedCounts: Readonly<MutableReasonCountMap>,
  completedCounts: Readonly<MutableReasonCountMap>,
): readonly TokenMotionDebugSourceReasonCounts[] => Object.freeze(TOKEN_MOTION_DEBUG_REASONS.map((reason) => Object.freeze({
  reason,
  activeCount: finiteNonNegative(activeCounts[reason]),
  startedCount: finiteNonNegative(startedCounts[reason]),
  completedCount: finiteNonNegative(completedCounts[reason]),
})))

export const createEmptyTokenMotionDebugMetrics = (): TokenMotionDebugMetrics => ({
  activeMovingTokenCount: 0,
  longestActiveMotionAgeMs: null,
  completedMotionCount: 0,
  sourceReasonCounts: sourceReasonRows(
    createEmptyReasonCountMap(),
    createEmptyReasonCountMap(),
    createEmptyReasonCountMap(),
  ),
})

const snapshotActiveTracks = (
  options: TokenMotionDebugMetricsSnapshotOptions,
  startedCounts: Readonly<MutableReasonCountMap>,
  completedCounts: Readonly<MutableReasonCountMap>,
  completedMotionCount: number,
): TokenMotionDebugMetrics => {
  const activeCounts = createEmptyReasonCountMap()
  let activeMovingTokenCount = 0
  let longestActiveMotionAgeMs: number | null = null
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : 0

  for (const renderObject of options.renderObjects) {
    const track = renderObject.motion?.track
    if (!track) continue

    activeMovingTokenCount += 1
    incrementReasonCount(activeCounts, track.reason)
    const ageMs = finiteNonNegative(nowMs - track.startMs)
    longestActiveMotionAgeMs = Math.max(longestActiveMotionAgeMs ?? 0, ageMs)
  }

  return Object.freeze({
    activeMovingTokenCount,
    longestActiveMotionAgeMs,
    completedMotionCount: finiteNonNegative(completedMotionCount),
    sourceReasonCounts: sourceReasonRows(activeCounts, startedCounts, completedCounts),
  })
}

export const createTokenMotionDebugMetricsSampler = (): TokenMotionDebugMetricsSampler => {
  let startedCounts = createEmptyReasonCountMap()
  let completedCounts = createEmptyReasonCountMap()
  let completedMotionCount = 0

  return {
    recordMotionStarted: (track) => {
      incrementReasonCount(startedCounts, track.reason)
    },
    recordMotionCompleted: (track) => {
      completedMotionCount += 1
      incrementReasonCount(completedCounts, track.reason)
    },
    snapshot: (options) => snapshotActiveTracks(
      options,
      startedCounts,
      completedCounts,
      completedMotionCount,
    ),
    reset: () => {
      startedCounts = createEmptyReasonCountMap()
      completedCounts = createEmptyReasonCountMap()
      completedMotionCount = 0
    },
  }
}
