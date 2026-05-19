import { sheetHasCanonicalAbility, type SheetAbilityNameSource } from '~/utils/sheetAbilities'

export const NO_GUARD_ABILITY_NAME = 'No Guard'
export const NO_GUARD_ATTACK_ROLL_BONUS = 3

export const hasNoGuardAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, NO_GUARD_ABILITY_NAME)

export const sheetAbilityAccuracyRollBonus = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): number => hasNoGuardAbility(abilities) ? NO_GUARD_ATTACK_ROLL_BONUS : 0

/**
 * No Guard makes foes gain +3 to Attack Rolls against the user. Move automation
 * models that as an equivalent reduction to the target's effective Evasion.
 */
export const sheetAbilityIncomingAttackEvasionModifier = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): number => hasNoGuardAbility(abilities) ? -NO_GUARD_ATTACK_ROLL_BONUS : 0
