import { sheetHasCanonicalAbility } from '~/utils/sheetAbilities'
import { FLASH_FIRE_ABILITY_NAME } from '~/utils/sheetPassiveAbilityEffects'
import { normalizeConditionName } from '~/utils/statusConditions'
import type { SpawnedPokemon } from '~/types/pokemon'

const WATER_VEIL_ABILITY_NAME = 'Water Veil'

const hasType = (target: SpawnedPokemon, type: string): boolean =>
  target.defenderTypes.some((entry) => entry.toLowerCase() === type.toLowerCase())

const hasAbility = (target: SpawnedPokemon, ability: string): boolean =>
  sheetHasCanonicalAbility(target.abilityNames, ability)

export const moveAutomationConditionImmunitySource = (
  condition: string,
  target: SpawnedPokemon,
  sourceType?: string | null,
): string | null => {
  const canonical = normalizeConditionName(condition) ?? condition

  if (canonical === 'Burned') {
    if (hasType(target, 'Fire')) return 'Fire type'
    if (hasAbility(target, WATER_VEIL_ABILITY_NAME)) return WATER_VEIL_ABILITY_NAME
    if (sourceType === 'Fire' && hasAbility(target, FLASH_FIRE_ABILITY_NAME)) return FLASH_FIRE_ABILITY_NAME
  }

  if (canonical === 'Paralysis' && hasType(target, 'Electric')) return 'Electric type'
  if (canonical === 'Frozen' && hasType(target, 'Ice')) return 'Ice type'
  if ((canonical === 'Poisoned' || canonical === 'Badly Poisoned') && (hasType(target, 'Poison') || hasType(target, 'Steel'))) {
    return hasType(target, 'Poison') ? 'Poison type' : 'Steel type'
  }
  if (canonical === 'Stuck' && hasType(target, 'Ghost')) return 'Ghost type'

  return null
}

export const canApplyMoveAutomationCondition = (
  condition: string,
  target: SpawnedPokemon,
  sourceType?: string | null,
): boolean => moveAutomationConditionImmunitySource(condition, target, sourceType) == null
