/**
 * PTU evasion helpers.
 *
 * Core rulebook (Character Creation / Combat): divide the related Combat Stat
 * by 5 and round down. Stat-derived evasion is capped at +6, then temporary
 * evasion bonuses/penalties stack on top. Total evasion applied to an Accuracy
 * Check is clamped from 0 to +9.
 */
export const STAT_EVASION_CAP = 6
export const TOTAL_EVASION_CAP = 9
export const EVASION_BONUS_MIN = -6
export const EVASION_BONUS_MAX = 6

const finiteNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Evasion from a related total stat: floor(total / 5), capped at +6. */
export const computeStatEvasion = (statTotal: number | null | undefined): number => {
  const total = finiteNumber(statTotal)
  return Math.min(STAT_EVASION_CAP, Math.max(0, Math.floor(total / 5)))
}

/** Final display value after the editable bonus/penalty is applied. */
export const computeEvasionTotal = (
  statEvasion: number | null | undefined,
  bonus: number | null | undefined = 0,
): number => Math.min(
  TOTAL_EVASION_CAP,
  Math.max(0, finiteNumber(statEvasion) + finiteNumber(bonus)),
)

/** Keep sheet-authored evasion modifiers within PTU's +/-6 bonus range. */
export const coerceEvasionBonus = (value: number | null | undefined): number => {
  if (value == null) return 0
  const n = finiteNumber(value)
  return Math.min(EVASION_BONUS_MAX, Math.max(EVASION_BONUS_MIN, Math.trunc(n)))
}

export const formatSignedModifier = (value: unknown): string => {
  const n = finiteNumber(value)
  if (n > 0) return `+${n}`
  return String(n)
}
