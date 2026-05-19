export type HpDisplayTier = 'critical' | 'wounded' | 'healthy'

export interface HpBarDisplayInput {
  currentHp: number
  /** Injury-adjusted Max HP / healing cap. */
  maxHp: number
  /** Formula Max HP before Injuries. Falls back to `maxHp` for legacy data. */
  fullMaxHp?: number | null
}

export interface HpBarDisplayMetrics {
  /** HP value represented by the full track width. */
  trackMaxHp: number
  /** HP value represented by the non-blocked portion of the track. */
  effectiveMaxHp: number
  /** Current HP over the full track. */
  currentRatio: number
  /** Non-blocked healing cap over the full track. */
  availableRatio: number
  /** Injury-blocked portion over the full track. */
  blockedRatio: number
}

const whole = (value: number | null | undefined): number => {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.floor(value)
}

const nonNegativeWhole = (value: number | null | undefined): number => Math.max(0, whole(value))

const clampRatio = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export const hpTierForRatio = (ratio: number): HpDisplayTier => {
  if (ratio <= 0.25) return 'critical'
  if (ratio <= 0.5) return 'wounded'
  return 'healthy'
}

export const hpBarPercentFromRatio = (ratio: number): string => `${clampRatio(ratio) * 100}%`

export const getHpBarDisplayMetrics = ({
  currentHp,
  maxHp,
  fullMaxHp,
}: HpBarDisplayInput): HpBarDisplayMetrics => {
  const effectiveMaxHp = nonNegativeWhole(maxHp)
  const formulaMaxHp = fullMaxHp == null ? effectiveMaxHp : nonNegativeWhole(fullMaxHp)
  const trackMaxHp = Math.max(formulaMaxHp, effectiveMaxHp)

  if (trackMaxHp <= 0) {
    return {
      trackMaxHp: 0,
      effectiveMaxHp,
      currentRatio: 0,
      availableRatio: 0,
      blockedRatio: 0,
    }
  }

  const availableHp = Math.min(effectiveMaxHp, trackMaxHp)
  const visibleCurrentHp = Math.min(nonNegativeWhole(currentHp), availableHp)
  const availableRatio = clampRatio(availableHp / trackMaxHp)

  return {
    trackMaxHp,
    effectiveMaxHp: availableHp,
    currentRatio: clampRatio(visibleCurrentHp / trackMaxHp),
    availableRatio,
    blockedRatio: clampRatio((trackMaxHp - availableHp) / trackMaxHp),
  }
}
