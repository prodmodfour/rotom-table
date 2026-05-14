import type { CharacterSheetAbility } from '~/types/characterSheet'
import { resolveCanonicalSheetAbilityName } from '~/utils/sheetAbilities'

export const SAND_VEIL_ABILITY_NAME = 'Sand Veil'

const SAND_VEIL_INACTIVE_EVASION_BONUS = 1
const SAND_VEIL_ACTIVE_EVASION_BONUS = 2

export interface SheetActivatableAbilityConfig {
  readonly name: string
  readonly inactiveEvasionBonus: number
  readonly activeEvasionBonus: number
}

type SheetAbilityActivationState = Pick<CharacterSheetAbility, 'name'> & {
  activated?: boolean
}

const SHEET_ACTIVATABLE_ABILITIES = new Map<string, SheetActivatableAbilityConfig>([
  [
    SAND_VEIL_ABILITY_NAME,
    {
      name: SAND_VEIL_ABILITY_NAME,
      inactiveEvasionBonus: SAND_VEIL_INACTIVE_EVASION_BONUS,
      activeEvasionBonus: SAND_VEIL_ACTIVE_EVASION_BONUS,
    },
  ],
])

export const getSheetAbilityActivationConfig = (
  ability: Pick<CharacterSheetAbility, 'name'>,
): SheetActivatableAbilityConfig | null => {
  const canonicalName = resolveCanonicalSheetAbilityName(ability)
  return canonicalName ? SHEET_ACTIVATABLE_ABILITIES.get(canonicalName) ?? null : null
}

export const isSheetActivatableAbility = (ability: Pick<CharacterSheetAbility, 'name'>): boolean =>
  getSheetAbilityActivationConfig(ability) != null

export const isSheetAbilityActivated = (ability: SheetAbilityActivationState): boolean =>
  isSheetActivatableAbility(ability) && ability.activated === true

export const clearSheetAbilityActivation = (ability: SheetAbilityActivationState): void => {
  delete ability.activated
}

export const toggleSheetAbilityActivation = (ability: CharacterSheetAbility): void => {
  if (!isSheetActivatableAbility(ability)) {
    clearSheetAbilityActivation(ability)
    return
  }
  ability.activated = !isSheetAbilityActivated(ability)
}

export const computeSheetAbilityEvasionBonus = (
  abilities: readonly CharacterSheetAbility[] | null | undefined,
): number => {
  let bonus = 0
  for (const ability of abilities ?? []) {
    const config = getSheetAbilityActivationConfig(ability)
    if (!config) continue
    const abilityBonus = ability.activated === true
      ? config.activeEvasionBonus
      : config.inactiveEvasionBonus
    bonus = Math.max(bonus, abilityBonus)
  }
  return bonus
}
