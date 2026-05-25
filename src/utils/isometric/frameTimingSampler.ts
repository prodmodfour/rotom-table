import type {
  RenderFrameReason,
  RenderFrameTimingMetrics,
} from './renderMetrics'
import {
  createEmptyRenderFrameTimingMetrics,
  incrementRenderFrameReasonCount,
} from './renderMetrics'

export interface RenderFrameTimingSample {
  /** Explicit measured frame duration. Takes precedence over started/ended timestamps. */
  durationMs?: number
  /** Frame start timestamp, normally from performance.now() or RAF timing. */
  startedAtMs?: number
  /** Frame end timestamp. Defaults to the sampler clock when startedAtMs is provided. */
  endedAtMs?: number
  /** Whether this sampled frame performed a renderer call. Defaults to true for render-loop samples. */
  rendered?: boolean
  /** Whether any animation source still required continuing frames at this sample. */
  activeAnimation?: boolean
  /** Render reasons associated with this sampled frame. */
  reasons?: Iterable<RenderFrameReason>
}

export interface RenderFrameTimingSamplerOptions {
  /** Injectable clock for deterministic tests and browser frame integrations. */
  now?: () => number
}

export interface RenderFrameTimingSampler {
  recordFrame: (sample?: RenderFrameTimingSample) => RenderFrameTimingMetrics
  snapshot: () => RenderFrameTimingMetrics
  reset: () => RenderFrameTimingMetrics
}

const browserSafeNowMs = (): number => {
  const performanceNow = globalThis.performance?.now

  if (typeof performanceNow === 'function') {
    return performanceNow.call(globalThis.performance)
  }

  return Date.now()
}

const readFiniteNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
)

const readNonNegativeFiniteNumber = (value: unknown): number | null => {
  const number = readFiniteNumber(value)

  return number !== null && number >= 0 ? number : null
}

const readClockNow = (now: () => number): number => readFiniteNumber(now()) ?? 0

const resolveDurationMs = (
  sample: RenderFrameTimingSample,
  now: () => number,
): number => {
  const explicitDurationMs = readNonNegativeFiniteNumber(sample.durationMs)

  if (explicitDurationMs !== null) {
    return explicitDurationMs
  }

  const startedAtMs = readFiniteNumber(sample.startedAtMs)

  if (startedAtMs === null) {
    return 0
  }

  const endedAtMs = readFiniteNumber(sample.endedAtMs) ?? readClockNow(now)

  return Math.max(0, endedAtMs - startedAtMs)
}

const copyMetrics = (metrics: RenderFrameTimingMetrics): RenderFrameTimingMetrics => ({
  ...metrics,
  lastFrameReasons: [...metrics.lastFrameReasons],
  reasonCounts: { ...metrics.reasonCounts },
})

/**
 * Lightweight frame timing accumulator for explicit debug instrumentation.
 *
 * It avoids direct window access so it can be imported by SSR/typecheck paths;
 * callers opt in by recording frame samples from browser render code.
 */
export const createRenderFrameTimingSampler = (
  { now = browserSafeNowMs }: RenderFrameTimingSamplerOptions = {},
): RenderFrameTimingSampler => {
  let metrics = createEmptyRenderFrameTimingMetrics()

  const snapshot = () => copyMetrics(metrics)

  const recordFrame = (sample: RenderFrameTimingSample = {}) => {
    const durationMs = resolveDurationMs(sample, now)
    const reasons = [...(sample.reasons ?? [])]
    const frameCount = metrics.frameCount + 1
    const renderCount = metrics.renderCount + ((sample.rendered ?? true) ? 1 : 0)
    const activeAnimation = sample.activeAnimation ?? false
    const activeAnimationFrameCount = metrics.activeAnimationFrameCount + (activeAnimation ? 1 : 0)
    const totalFrameDurationMs = metrics.totalFrameDurationMs + durationMs
    let reasonCounts = metrics.reasonCounts

    for (const reason of reasons) {
      reasonCounts = incrementRenderFrameReasonCount(reasonCounts, reason)
    }

    metrics = {
      frameCount,
      renderCount,
      activeAnimationFrameCount,
      totalFrameDurationMs,
      averageFrameDurationMs: totalFrameDurationMs / frameCount,
      maxFrameDurationMs: Math.max(metrics.maxFrameDurationMs, durationMs),
      lastFrameDurationMs: durationMs,
      lastFrameHadActiveAnimation: activeAnimation,
      lastFrameReasons: reasons,
      reasonCounts,
    }

    return snapshot()
  }

  const reset = () => {
    metrics = createEmptyRenderFrameTimingMetrics()

    return snapshot()
  }

  return {
    recordFrame,
    snapshot,
    reset,
  }
}
