import { clampCombatStage } from '~/utils/combatStages'
import { conditionAccuracyModifier } from '~/utils/sheetConditionEffects'
import { heldItemAccuracyRollBonus } from '~/utils/sheetHeldItemEffects'
import type { CombatStageKey } from '~/types/combatStages'

export interface SheetAccuracySummary {
  /** Full Accuracy Roll modifier: Accuracy stage + condition modifiers + item bonus. */
  total: number
  /** Sheet-authored Accuracy Combat Stage, clamped to PTU's -6..+6 stage bounds. */
  stage: number
  /** Flat Accuracy Roll modifier from conditions such as Blindness or Helping Hand. */
  conditionModifier: number
  /** Flat Accuracy Roll modifier from sheet equipment, currently Luck Incense for Pokémon. */
  itemBonus: number
}

export interface SheetAccuracySummaryInput {
  stage: unknown
  conditions?: readonly string[] | null
  heldItem?: string | null
  includeHeldItemBonus?: boolean
}

export type AccuracyStageSheet = {
  combatStages?: Partial<Record<CombatStageKey, number>>
}

export const buildSheetAccuracySummary = ({
  stage: rawStage,
  conditions,
  heldItem,
  includeHeldItemBonus = true,
}: SheetAccuracySummaryInput): SheetAccuracySummary => {
  const stage = clampCombatStage(rawStage)
  const conditionModifier = conditionAccuracyModifier(conditions)
  const itemBonus = includeHeldItemBonus ? heldItemAccuracyRollBonus(heldItem) : 0
  return {
    total: stage + conditionModifier + itemBonus,
    stage,
    conditionModifier,
    itemBonus,
  }
}

export const setSheetAccuracyStage = (
  sheet: AccuracyStageSheet,
  value: unknown,
): void => {
  sheet.combatStages ??= {}
  sheet.combatStages.acc = clampCombatStage(value)
}
