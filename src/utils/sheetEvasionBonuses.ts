import { computeSheetAbilityEvasionBonus } from '~/utils/sheetAbilityActivation'
import { heldItemSpeedEvasionBonus } from '~/utils/sheetHeldItemEffects'
import { pokemonTrainingFeatureEvasionBonus } from '~/utils/sheets/pokemonTrainingFeatures'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SpawnedPokemonEvasionModifiers } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

export const pokemonEvasionModifiers = (
  sheet: CharacterSheet,
): SpawnedPokemonEvasionModifiers => {
  const evasion = sheet.combat?.evasion
  const abilityBonus = computeSheetAbilityEvasionBonus(sheet.abilities)
  const trainingBonus = pokemonTrainingFeatureEvasionBonus(sheet.activeTrainingFeature)
  return {
    physical: (evasion?.vsAtkBonus ?? 0) + abilityBonus + trainingBonus,
    special: (evasion?.vsSatkBonus ?? 0) + abilityBonus + trainingBonus,
    speed: (evasion?.vsAnyBonus ?? 0) + abilityBonus + trainingBonus + heldItemSpeedEvasionBonus(sheet.items?.held),
  }
}

export const trainerEvasionModifiers = (
  sheet: TrainerSheet,
): SpawnedPokemonEvasionModifiers => ({
  physical: sheet.evasion?.physicalBonus ?? 0,
  special: sheet.evasion?.specialBonus ?? 0,
  speed: sheet.evasion?.speedBonus ?? 0,
})
