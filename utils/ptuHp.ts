/**
 * PTU Hit Point helpers.
 *
 * Core references from the markdown books:
 * - Pokémon Max HP: Level + (HP × 3) + 10 (Core Pokémon p.198)
 * - Trainer Max HP: Level × 2 + (HP × 3) + 10 (Core Character Creation p.16)
 * - A Tick is 1/10th of maximum Hit Points (Core Combat p.237)
 * - Each Injury reduces the healing cap / effective Max HP by 1/10th, while
 *   fractional effects still use the real formula maximum (Core Combat p.250).
 *
 * PTU rounds decimals down unless a rule says otherwise.
 */

const whole = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.floor(value)
}

export const normalizeInjuryCount = (injuries: number | null | undefined): number => {
  if (injuries == null || !Number.isFinite(injuries)) return 0
  return Math.max(0, Math.floor(injuries))
}

export const computePokemonFormulaMaxHp = (level: number, hpStat: number): number =>
  Math.max(0, whole(level) + (whole(hpStat) * 3) + 10)

export const computeTrainerFormulaMaxHp = (level: number, hpStat: number): number =>
  Math.max(0, (whole(level) * 2) + (whole(hpStat) * 3) + 10)

/** Effective Max HP / healing cap after Injuries. */
export const computeInjuryAdjustedMaxHp = (
  formulaMaxHp: number,
  injuries: number | null | undefined,
): number => {
  const maxHp = Math.max(0, whole(formulaMaxHp))
  const remainingTenths = Math.max(0, 10 - normalizeInjuryCount(injuries))
  return Math.floor((maxHp * remainingTenths) / 10)
}

export const clampHpValue = (value: unknown, maxHp: number): number => {
  const cap = Math.max(0, whole(maxHp))
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return cap
  return Math.max(0, Math.min(cap, Math.floor(n)))
}

/** Tick value from the real formula maximum, not the injury-adjusted healing cap. */
export const computeTickValue = (formulaMaxHp: number): number => {
  const maxHp = Math.max(0, whole(formulaMaxHp))
  if (maxHp <= 0) return 0
  return Math.max(1, Math.floor(maxHp / 10))
}

/** Fractional HP markers/effects from the real formula maximum. */
export const computeHpThresholds = (formulaMaxHp: number) => {
  const maxHp = Math.max(0, whole(formulaMaxHp))
  return {
    half: Math.floor(maxHp / 2),
    third: Math.floor(maxHp / 3),
    quarter: Math.floor(maxHp / 4),
  }
}
