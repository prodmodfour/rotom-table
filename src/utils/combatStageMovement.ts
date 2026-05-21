import { clampCombatStage } from '~/utils/combatStages'
import { isConditionAdjustedMovementCapability } from '~/utils/sheetConditionEffects'

export interface SpeedCombatStageMovementAdjustment {
  stage: number
  delta: number
  adjustedValue: number
  displayValue: string
  title: string
}

const finiteMovementValue = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null
}

const formatSigned = (value: number): string => value > 0 ? `+${value}` : String(value)

export const speedCombatStageMovementDelta = (stage: unknown): number =>
  Math.trunc(clampCombatStage(stage) / 2)

export const applySpeedCombatStageToMovement = (
  movement: number,
  speedCombatStage: unknown,
): number => {
  const base = Math.max(0, Math.trunc(movement))
  if (base <= 0) return base

  const delta = speedCombatStageMovementDelta(speedCombatStage)
  if (delta === 0) return base
  if (delta > 0) return base + delta

  const minimumAfterReduction = base < 2 ? base : 2
  return Math.max(minimumAfterReduction, base + delta)
}

export const movementCapabilitySpeedCombatStageAdjustment = (
  label: string,
  value: number | string | null | undefined,
  speedCombatStage: unknown,
): SpeedCombatStageMovementAdjustment | null => {
  if (!isConditionAdjustedMovementCapability(label)) return null

  const movement = finiteMovementValue(value)
  if (movement == null || movement <= 0) return null

  const stage = clampCombatStage(speedCombatStage)
  const delta = speedCombatStageMovementDelta(stage)
  if (delta === 0) return null

  const adjustedValue = applySpeedCombatStageToMovement(movement, stage)
  return {
    stage,
    delta,
    adjustedValue,
    displayValue: formatSigned(delta),
    title: `Speed Combat Stage ${formatSigned(stage)} modifies Movement Speeds by ${formatSigned(delta)}. Negative Speed CS cannot reduce a Movement Speed below 2.`,
  }
}
