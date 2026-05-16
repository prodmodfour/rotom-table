import { SHIELD_DUST_ABILITY_NAME } from '~/utils/abilityAutomation'
import { sheetHasCanonicalAbility, type SheetAbilityNameSource } from '~/utils/sheetAbilities'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

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

export const hasShieldDustAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, SHIELD_DUST_ABILITY_NAME)
