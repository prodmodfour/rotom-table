import { computeMultiplier } from '~/utils/typeChart'
import {
  sheetHasCanonicalAbility,
  type SheetAbilityNameSource,
} from '~/utils/sheetAbilities'

export const LEVITATE_ABILITY_NAME = 'Levitate'
export const LEVITATE_GRANTED_SPEED = 4
export const LEVITATE_EXISTING_SPEED_BONUS = 2
export const LEVITATE_GROUND_RESISTANCE_MULTIPLIER = 0.5

export const hasLevitateAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, LEVITATE_ABILITY_NAME)

/**
 * Levitate grants a Levitate speed of 4 if none exists, otherwise +2 to the
 * existing Levitate speed. A value of 0 is treated as no existing speed.
 */
export const resolveLevitateAbilitySpeed = (
  baseLevitate: number | null | undefined,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): number | undefined => {
  if (!hasLevitateAbility(abilities)) return baseLevitate ?? undefined
  return typeof baseLevitate === 'number' && Number.isFinite(baseLevitate) && baseLevitate > 0
    ? baseLevitate + LEVITATE_EXISTING_SPEED_BONUS
    : LEVITATE_GRANTED_SPEED
}

/**
 * Sheet implementation for passive ability type effects. Levitate grants
 * Ground resistance rather than full immunity; an existing type immunity still
 * wins, and an already-stronger resistance is preserved.
 */
export const applySheetPassiveAbilityTypeEffectiveness = (
  attackingType: string,
  baseMultiplier: number,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): number => {
  if (attackingType !== 'Ground' || !hasLevitateAbility(abilities) || baseMultiplier === 0) {
    return baseMultiplier
  }
  return Math.min(baseMultiplier, LEVITATE_GROUND_RESISTANCE_MULTIPLIER)
}

export const computeSheetAbilityAwareMultiplier = (
  attackingType: string,
  defenders: ReadonlyArray<string | undefined>,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): number => applySheetPassiveAbilityTypeEffectiveness(
  attackingType,
  computeMultiplier(attackingType, defenders),
  abilities,
)
