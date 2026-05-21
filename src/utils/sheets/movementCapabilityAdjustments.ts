import {
  movementCapabilityConditionAdjustment,
  type MovementCapabilityConditionAdjustment,
} from '~/utils/sheetConditionEffects'
import {
  movementCapabilitySpeedCombatStageAdjustment,
  type SpeedCombatStageMovementAdjustment,
} from '~/utils/combatStageMovement'
import {
  pokemonTrainingFeatureMovementCapabilityAdjustment,
  type PokemonTrainingFeatureMovementAdjustment,
} from '~/utils/sheets/pokemonTrainingFeatures'

export interface SheetMovementCapabilityAdjustments {
  speedStageAdjustment: SpeedCombatStageMovementAdjustment | null
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
  speedCombatStage?: unknown,
): SheetMovementCapabilityAdjustments => {
  const speedStageAdjustment = movementCapabilitySpeedCombatStageAdjustment(label, value, speedCombatStage)
  const valueAfterSpeedStage = speedStageAdjustment?.adjustedValue ?? value
  const conditionAdjustment = movementCapabilityConditionAdjustment(label, valueAfterSpeedStage, conditions)
  const valueBeforeTraining = conditionAdjustment?.adjustedValue ?? valueAfterSpeedStage
  const trainingAdjustment = pokemonTrainingFeatureMovementCapabilityAdjustment(
    label,
    valueBeforeTraining,
    trainingFeature,
  )

  return {
    speedStageAdjustment,
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
  speedCombatStage?: unknown,
): MovementCapabilityValue => {
  const adjustments = resolveSheetMovementCapabilityAdjustments(label, value, conditions, trainingFeature, speedCombatStage)
  return adjustments.conditionAdjustment?.adjustedValue
    ?? adjustments.trainingAdjustment?.adjustedValue
    ?? adjustments.speedStageAdjustment?.adjustedValue
    ?? value
}

export const formatSheetMovementCapabilityValue = (
  label: string,
  value: MovementCapabilityValue,
  conditions: readonly string[] | null | undefined,
  trainingFeature: unknown,
  speedCombatStage?: unknown,
): string => {
  const adjustedValue = adjustedSheetMovementCapabilityValue(label, value, conditions, trainingFeature, speedCombatStage)
  return adjustedValue === null || adjustedValue === undefined || adjustedValue === ''
    ? ''
    : String(adjustedValue)
}
