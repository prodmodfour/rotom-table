import { pokemonTrainingFeatureEvasionBonus } from '~/utils/sheets/pokemonTrainingFeatures'
import { projectedEquipmentContributionDelta } from '~/utils/equipmentContributionProjection'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SpawnedPokemonEvasionModifiers } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

export const pokemonEvasionModifiers = (
  sheet: CharacterSheet,
): SpawnedPokemonEvasionModifiers => {
  const evasion = sheet.combat?.evasion
  const trainingBonus = pokemonTrainingFeatureEvasionBonus(sheet.activeTrainingFeature)
  return {
    physical: (evasion?.vsAtkBonus ?? 0) + trainingBonus + projectedEquipmentContributionDelta({
      sheet, metric: 'evasion', targetId: 'physical',
    }),
    special: (evasion?.vsSatkBonus ?? 0) + trainingBonus + projectedEquipmentContributionDelta({
      sheet, metric: 'evasion', targetId: 'special',
    }),
    speed: (evasion?.vsAnyBonus ?? 0) + trainingBonus + projectedEquipmentContributionDelta({
      sheet, metric: 'evasion', targetId: 'speed',
    }),
  }
}

export const trainerEvasionModifiers = (
  sheet: TrainerSheet,
): SpawnedPokemonEvasionModifiers => ({
  physical: (sheet.evasion?.physicalBonus ?? 0) + projectedEquipmentContributionDelta({
    sheet, metric: 'evasion', targetId: 'physical',
  }),
  special: (sheet.evasion?.specialBonus ?? 0) + projectedEquipmentContributionDelta({
    sheet, metric: 'evasion', targetId: 'special',
  }),
  speed: (sheet.evasion?.speedBonus ?? 0) + projectedEquipmentContributionDelta({
    sheet, metric: 'evasion', targetId: 'speed',
  }),
})
