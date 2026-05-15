import { findItem } from '~~/data/ptuReference'
import { computeSheetAbilityEvasionBonus } from '~/utils/sheetAbilityActivation'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SpawnedPokemonEvasionModifiers } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const BRIGHT_POWDER_SPEED_EVASION_BONUS = 2

export const heldItemSpeedEvasionBonus = (heldItem: string | null | undefined): number => {
  if (!heldItem?.trim()) return 0
  return findItem(heldItem)?.name === 'Bright Powder'
    ? BRIGHT_POWDER_SPEED_EVASION_BONUS
    : 0
}

export const pokemonEvasionModifiers = (
  sheet: CharacterSheet,
): SpawnedPokemonEvasionModifiers => {
  const evasion = sheet.combat?.evasion
  const abilityBonus = computeSheetAbilityEvasionBonus(sheet.abilities)
  return {
    physical: (evasion?.vsAtkBonus ?? 0) + abilityBonus,
    special: (evasion?.vsSatkBonus ?? 0) + abilityBonus,
    speed: (evasion?.vsAnyBonus ?? 0) + abilityBonus + heldItemSpeedEvasionBonus(sheet.items?.held),
  }
}

export const trainerEvasionModifiers = (
  sheet: TrainerSheet,
): SpawnedPokemonEvasionModifiers => ({
  physical: sheet.evasion?.physicalBonus ?? 0,
  special: sheet.evasion?.specialBonus ?? 0,
  speed: sheet.evasion?.speedBonus ?? 0,
})
