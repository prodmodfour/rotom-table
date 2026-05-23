import { findMoveDamageBase, type MoveDamageBaseDef } from '~/utils/moveDamageBase'

export type MoveDamageDisplayMode = 'average' | 'roll'

export interface MoveDamageDisplayValues {
  damageAverage: number | null
  damageFormula: string | null
}

export const DEFAULT_MOVE_DAMAGE_DISPLAY_MODE: MoveDamageDisplayMode = 'average'

export const isMoveDamageDisplayMode = (value: unknown): value is MoveDamageDisplayMode =>
  value === 'average' || value === 'roll'

export const nextMoveDamageDisplayMode = (mode: MoveDamageDisplayMode): MoveDamageDisplayMode =>
  mode === 'average' ? 'roll' : 'average'

export const moveDamageDisplayModeLabel = (mode: MoveDamageDisplayMode): string =>
  mode === 'average' ? 'Avg Damage' : 'Damage Roll'

export const moveDamageDisplayModeTitle = (mode: MoveDamageDisplayMode): string =>
  mode === 'average'
    ? 'Showing average damage. Click to show the damage roll formula.'
    : 'Showing the damage roll formula. Click to show average damage.'

export const averageMoveDamageBase = (def: MoveDamageBaseDef, attackBonus = 0): number =>
  (def.count * (def.sides + 1) / 2) + def.mod + attackBonus

export const averageMoveDamageForDb = (
  damageBase: number | null | undefined,
  attackBonus = 0,
): number | null => {
  if (damageBase == null) return null
  const def = findMoveDamageBase(damageBase)
  return def ? averageMoveDamageBase(def, attackBonus) : null
}

export const formatMoveDamageAverage = (average: number | null | undefined): string | null => {
  if (average == null || !Number.isFinite(average)) return null
  return Number.isInteger(average) ? String(average) : average.toFixed(1)
}

export const formatMoveDamageDisplay = (
  values: MoveDamageDisplayValues,
  mode: MoveDamageDisplayMode = DEFAULT_MOVE_DAMAGE_DISPLAY_MODE,
): string | null => {
  if (mode === 'roll') return values.damageFormula
  return formatMoveDamageAverage(values.damageAverage) ?? values.damageFormula
}
