import {
  movementCapabilityConditionAdjustment,
  type MovementCapabilityConditionAdjustment,
} from '~/utils/sheetConditionEffects'
import {
  pokemonTrainingFeatureMovementCapabilityAdjustment,
  type PokemonTrainingFeatureMovementAdjustment,
} from '~/utils/sheets/pokemonTrainingFeatures'

export interface SheetMovementCapabilityAdjustments {
  conditionAdjustment: MovementCapabilityConditionAdjustment | null
  trainingAdjustment: PokemonTrainingFeatureMovementAdjustment | null
}

const applyTrainingAdjustmentToConditionAdjustment = (
  conditionAdjustment: MovementCapabilityConditionAdjustment,
  trainingAdjustment: PokemonTrainingFeatureMovementAdjustment,
): MovementCapabilityConditionAdjustment => ({
  ...conditionAdjustment,
  adjustedValue: trainingAdjustment.adjustedValue,
  displayValue: String(trainingAdjustment.adjustedValue),
  title: `${conditionAdjustment.title} ${trainingAdjustment.title}`,
})

type MovementCapabilityValue = number | string | null | undefined

export const resolveSheetMovementCapabilityAdjustments = (
  label: string,
  value: MovementCapabilityValue,
  conditions: readonly string[] | null | undefined,
  trainingFeature: unknown,
): SheetMovementCapabilityAdjustments => {
  const conditionAdjustment = movementCapabilityConditionAdjustment(label, value, conditions)
  const valueBeforeTraining = conditionAdjustment?.adjustedValue ?? value
  const trainingAdjustment = pokemonTrainingFeatureMovementCapabilityAdjustment(
    label,
    valueBeforeTraining,
    trainingFeature,
  )

  return {
    conditionAdjustment: conditionAdjustment && trainingAdjustment
      ? applyTrainingAdjustmentToConditionAdjustment(conditionAdjustment, trainingAdjustment)
      : conditionAdjustment,
    trainingAdjustment,
  }
}

export const adjustedSheetMovementCapabilityValue = (
  label: string,
  value: MovementCapabilityValue,
  conditions: readonly string[] | null | undefined,
  trainingFeature: unknown,
): MovementCapabilityValue => {
  const adjustments = resolveSheetMovementCapabilityAdjustments(label, value, conditions, trainingFeature)
  return adjustments.conditionAdjustment?.adjustedValue
    ?? adjustments.trainingAdjustment?.adjustedValue
    ?? value
}

export const formatSheetMovementCapabilityValue = (
  label: string,
  value: MovementCapabilityValue,
  conditions: readonly string[] | null | undefined,
  trainingFeature: unknown,
): string => {
  const adjustedValue = adjustedSheetMovementCapabilityValue(label, value, conditions, trainingFeature)
  return adjustedValue === null || adjustedValue === undefined || adjustedValue === ''
    ? ''
    : String(adjustedValue)
}
