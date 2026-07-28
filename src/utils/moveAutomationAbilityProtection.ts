import { KEEN_EYE_ABILITY_NAME } from '~/utils/sheetAbilityCombatModifiers'
import { sheetHasCanonicalAbility, type SheetAbilityNameSource } from '~/utils/sheetAbilities'
import type { CombatStageKey } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export const SHIELD_DUST_ABILITY_NAME = 'Shield Dust'

export const tokenHasShieldDust = (
  token: Pick<SpawnedPokemon, 'abilityNames'>,
): boolean => sheetHasCanonicalAbility(token.abilityNames, SHIELD_DUST_ABILITY_NAME)

const hasAccuracyRollThreshold = (threshold: string | null | undefined): boolean =>
  Boolean(threshold?.trim())

export interface MoveAutomationSecondaryEffectBlockContext {
  script: Pick<MoveAutomationScript, 'damaging' | 'requiresAccuracy'>
  target: Pick<SpawnedPokemon, 'abilityNames'>
  threshold?: string | null
}

export const moveAutomationSecondaryEffectBlockSource = ({
  script,
  target,
  threshold,
}: MoveAutomationSecondaryEffectBlockContext): string | null => {
  if (!script.damaging || !script.requiresAccuracy) return null
  if (!hasAccuracyRollThreshold(threshold)) return null
  return tokenHasShieldDust(target) ? SHIELD_DUST_ABILITY_NAME : null
}

export interface MoveAutomationCombatStageBlockContext {
  target: Pick<SpawnedPokemon, 'abilityNames'>
  key: CombatStageKey
  delta: number
}

export const moveAutomationCombatStageBlockSource = ({
  target,
  key,
  delta,
}: MoveAutomationCombatStageBlockContext): string | null => {
  if (key === 'acc' && delta < 0 && sheetHasCanonicalAbility(target.abilityNames, KEEN_EYE_ABILITY_NAME)) {
    return KEEN_EYE_ABILITY_NAME
  }
  return null
}

export const hasShieldDustAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, SHIELD_DUST_ABILITY_NAME)
