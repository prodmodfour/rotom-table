export const MOVE_VFX_DEFAULT_DURATIONS_MS = {
  /** Brief flashes, impact rings, miss puffs, and crit accents. */
  quick: 220,
  /** Default travel/pulse tier for projectiles, beams, self auras, and area pulses. */
  normal: 500,
  /** Longer combined or directional effects tuned to settle within a table-snappy second. */
  long: 840,
  /** Maximum default lifetime for rare effects that need a short visual afterglow. */
  linger: 1100,
} as const

export type MoveVfxDurationTier = keyof typeof MOVE_VFX_DEFAULT_DURATIONS_MS

export interface MoveVfxAnimationProgress {
  /** Non-negative wall-clock time since the effective animation start. */
  readonly elapsedMs: number
  /** Sanitized non-negative duration used to compute progress. */
  readonly durationMs: number
  /** Progress clamped to the inclusive [0, 1] range. */
  readonly progress: number
  /** True once the effective start time has elapsed through the full duration. */
  readonly complete: boolean
}

const DEFAULT_BACK_OVERSHOOT = 1.70158

const finiteNumberOrZero = (value: number): number => (Number.isFinite(value) ? value : 0)

const nonNegativeFiniteNumberOrZero = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, value) : 0
)

export const clamp01 = (value: number): number => {
  if (value === Number.POSITIVE_INFINITY) return 1
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value >= 1) return 1
  return value
}

export const linear = (progress: number): number => clamp01(progress)

export const easeOutCubic = (progress: number): number => {
  const t = clamp01(progress)
  return 1 - ((1 - t) ** 3)
}

export const easeInOutCubic = (progress: number): number => {
  const t = clamp01(progress)
  return t < 0.5
    ? 4 * (t ** 3)
    : 1 - (((-2 * t + 2) ** 3) / 2)
}

export const easeOutBack = (
  progress: number,
  overshoot = DEFAULT_BACK_OVERSHOOT,
): number => {
  const t = clamp01(progress) - 1
  const c1 = Number.isFinite(overshoot) ? overshoot : DEFAULT_BACK_OVERSHOOT
  const c3 = c1 + 1
  return 1 + (c3 * (t ** 3)) + (c1 * (t ** 2))
}

/** Returns a simple 0 -> 1 -> 0 pulse across normalized animation progress. */
export const pulse01 = (progress: number): number => {
  const t = clamp01(progress)
  if (t <= 0 || t >= 1) return 0
  return Math.sin(t * Math.PI)
}

/** Interpolates numbers with clamped animation progress so primitives do not extrapolate by accident. */
export const lerpNumber = (from: number, to: number, progress: number): number => {
  const start = finiteNumberOrZero(from)
  const end = finiteNumberOrZero(to)
  return start + ((end - start) * clamp01(progress))
}

/**
 * Computes deterministic animation progress from scheduler-provided frame time.
 *
 * Pass an already-offset `startMs` for delayed/staggered effects. This helper
 * intentionally schedules no timers and owns no state; renderers decide whether
 * the returned `complete` flag should dispose an effect instance.
 */
export const animationProgress = (
  nowMs: number,
  startMs: number,
  durationMs: number,
): MoveVfxAnimationProgress => {
  const now = finiteNumberOrZero(nowMs)
  const start = finiteNumberOrZero(startMs)
  const rawElapsedMs = now - start
  const elapsedMs = Math.max(0, rawElapsedMs)
  const safeDurationMs = nonNegativeFiniteNumberOrZero(durationMs)

  if (safeDurationMs <= 0) {
    const started = rawElapsedMs >= 0
    return {
      elapsedMs,
      durationMs: safeDurationMs,
      progress: started ? 1 : 0,
      complete: started,
    }
  }

  return {
    elapsedMs,
    durationMs: safeDurationMs,
    progress: clamp01(rawElapsedMs / safeDurationMs),
    complete: rawElapsedMs >= safeDurationMs,
  }
}
