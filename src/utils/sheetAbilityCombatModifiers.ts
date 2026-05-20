import {
  resolveCanonicalSheetAbilityName,
  sheetHasCanonicalAbility,
  type SheetAbilityNameSource,
} from '~/utils/sheetAbilities'

export const COMPOUND_EYES_ABILITY_NAME = 'Compound Eyes'
export const NO_GUARD_ABILITY_NAME = 'No Guard'
export const COMPOUND_EYES_ACCURACY_ROLL_BONUS = 3
export const NO_GUARD_ATTACK_ROLL_BONUS = 3

const SHEET_ABILITY_ACCURACY_ROLL_BONUSES = new Map<string, number>([
  [COMPOUND_EYES_ABILITY_NAME, COMPOUND_EYES_ACCURACY_ROLL_BONUS],
  [NO_GUARD_ABILITY_NAME, NO_GUARD_ATTACK_ROLL_BONUS],
])

export const hasCompoundEyesAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, COMPOUND_EYES_ABILITY_NAME)

export const hasNoGuardAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, NO_GUARD_ABILITY_NAME)

export const sheetAbilityAccuracyRollBonus = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): number => {
  let bonus = 0
  const countedAbilities = new Set<string>()
  for (const ability of abilities ?? []) {
    const canonicalName = resolveCanonicalSheetAbilityName(ability)
    if (!canonicalName || countedAbilities.has(canonicalName)) continue

    bonus += SHEET_ABILITY_ACCURACY_ROLL_BONUSES.get(canonicalName) ?? 0
    countedAbilities.add(canonicalName)
  }
  return bonus
}

/**
 * No Guard makes foes gain +3 to Attack Rolls against the user. Move automation
 * models that as an equivalent reduction to the target's effective Evasion.
 */
export const sheetAbilityIncomingAttackEvasionModifier = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): number => hasNoGuardAbility(abilities) ? -NO_GUARD_ATTACK_ROLL_BONUS : 0
