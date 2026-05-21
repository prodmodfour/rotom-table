import { clampCombatStage } from '~/utils/combatStages'
import {
  resolveCanonicalSheetAbilityName,
  sheetHasCanonicalAbility,
  type SheetAbilityNameSource,
} from '~/utils/sheetAbilities'

export const COMPOUND_EYES_ABILITY_NAME = 'Compound Eyes'
export const ILLUMINATE_ABILITY_NAME = 'Illuminate'
export const KEEN_EYE_ABILITY_NAME = 'Keen Eye'
export const NO_GUARD_ABILITY_NAME = 'No Guard'
export const COMPOUND_EYES_ACCURACY_ROLL_BONUS = 3
export const ILLUMINATE_ATTACK_ROLL_PENALTY = 2
export const NO_GUARD_ATTACK_ROLL_BONUS = 3

const SHEET_ABILITY_ACCURACY_ROLL_BONUSES = new Map<string, number>([
  [COMPOUND_EYES_ABILITY_NAME, COMPOUND_EYES_ACCURACY_ROLL_BONUS],
  [NO_GUARD_ABILITY_NAME, NO_GUARD_ATTACK_ROLL_BONUS],
])

export const hasCompoundEyesAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, COMPOUND_EYES_ABILITY_NAME)

export const hasIlluminateAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, ILLUMINATE_ABILITY_NAME)

export const hasKeenEyeAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, KEEN_EYE_ABILITY_NAME)

export const hasNoGuardAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, NO_GUARD_ABILITY_NAME)

export const sheetAbilityAdjustedAccuracyStage = (
  stage: unknown,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): number => {
  const clampedStage = clampCombatStage(stage)
  return hasKeenEyeAbility(abilities) && clampedStage < 0 ? 0 : clampedStage
}

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

export interface SheetAbilityIncomingAttackEvasionModifierContext {
  attackerAbilities?: readonly SheetAbilityNameSource[] | null | undefined
}

export interface SheetAbilityIncomingAttackEvasionModifier {
  source: string
  modifier: number
}

/**
 * Incoming attack Accuracy Roll modifiers are modeled as equivalent changes to
 * the target's effective Evasion so existing AC + Evasion math stays unified.
 */
export const sheetAbilityIncomingAttackEvasionModifiers = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
  context: SheetAbilityIncomingAttackEvasionModifierContext = {},
): SheetAbilityIncomingAttackEvasionModifier[] => {
  const modifiers: SheetAbilityIncomingAttackEvasionModifier[] = []

  // No Guard makes foes gain +3 to Attack Rolls against the user.
  if (hasNoGuardAbility(abilities)) {
    modifiers.push({ source: NO_GUARD_ABILITY_NAME, modifier: -NO_GUARD_ATTACK_ROLL_BONUS })
  }

  // Illuminate applies a -2 Accuracy Penalty to attackers; Keen Eye ignores it.
  if (hasIlluminateAbility(abilities) && !hasKeenEyeAbility(context.attackerAbilities)) {
    modifiers.push({ source: ILLUMINATE_ABILITY_NAME, modifier: ILLUMINATE_ATTACK_ROLL_PENALTY })
  }

  return modifiers
}

export const sheetAbilityIncomingAttackEvasionModifier = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
  context: SheetAbilityIncomingAttackEvasionModifierContext = {},
): number => sheetAbilityIncomingAttackEvasionModifiers(abilities, context)
  .reduce((sum, entry) => sum + entry.modifier, 0)
