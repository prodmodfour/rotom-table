import {
  createEmptyPointerInteractionMetrics,
  incrementPointerRaycastKindCount,
  type IsometricPointerRaycastKind,
  type PointerInteractionMetrics,
} from './renderMetrics'

export interface PointerMoveFrameMetricsSample {
  coalescedEventCount?: number | null
}

export interface PointerInteractionMetricsSampler {
  recordPointerMoveEvent(count?: number | null): PointerInteractionMetrics
  recordPointerMoveFrame(sample?: PointerMoveFrameMetricsSample): PointerInteractionMetrics
  recordRaycast(kind: IsometricPointerRaycastKind, count?: number | null): PointerInteractionMetrics
  recordPathfindingRequest(count?: number | null): PointerInteractionMetrics
  snapshot(): PointerInteractionMetrics
  reset(): PointerInteractionMetrics
}

const sanitizeMetricIncrement = (value: number | null | undefined): number => {
  if (value == null) return 1
  if (!Number.isFinite(value) || value <= 0) return 0

  return Math.trunc(value)
}

const copyPointerInteractionMetrics = (
  metrics: PointerInteractionMetrics,
): PointerInteractionMetrics => ({
  ...metrics,
  raycastCounts: { ...metrics.raycastCounts },
})

export const createPointerInteractionMetricsSampler = (): PointerInteractionMetricsSampler => {
  let metrics = createEmptyPointerInteractionMetrics()

  const snapshot = () => copyPointerInteractionMetrics(metrics)

  return {
    recordPointerMoveEvent(count) {
      metrics = {
        ...metrics,
        pointerMoveEventCount: metrics.pointerMoveEventCount + sanitizeMetricIncrement(count),
      }

      return snapshot()
    },
    recordPointerMoveFrame(sample = {}) {
      const coalescedEventCount = sanitizeMetricIncrement(sample.coalescedEventCount)

      metrics = {
        ...metrics,
        pointerMoveFrameCount: metrics.pointerMoveFrameCount + 1,
        coalescedPointerMoveEventCount: metrics.coalescedPointerMoveEventCount + coalescedEventCount,
        lastPointerMoveFrameCoalescedEventCount: coalescedEventCount,
      }

      return snapshot()
    },
    recordRaycast(kind, count) {
      const increment = sanitizeMetricIncrement(count)

      metrics = {
        ...metrics,
        raycastCount: metrics.raycastCount + increment,
        raycastCounts: incrementPointerRaycastKindCount(metrics.raycastCounts, kind, increment),
      }

      return snapshot()
    },
    recordPathfindingRequest(count) {
      metrics = {
        ...metrics,
        pathfindingRequestCount: metrics.pathfindingRequestCount + sanitizeMetricIncrement(count),
      }

      return snapshot()
    },
    snapshot,
    reset() {
      metrics = createEmptyPointerInteractionMetrics()
      return snapshot()
    },
  }
}
