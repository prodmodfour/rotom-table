import { clampCombatStage } from '~/utils/combatStages'
import { conditionAccuracyModifier } from '~/utils/sheetConditionEffects'
import { sheetAbilityAccuracyRollBonus } from '~/utils/sheetAbilityCombatModifiers'
import { heldItemAccuracyRollBonus } from '~/utils/sheetHeldItemEffects'
import type { CombatStageKey } from '~/types/combatStages'
import type { SheetAbilityNameSource } from '~/utils/sheetAbilities'

export interface SheetAccuracySummary {
  /** Full Accuracy Roll modifier: Accuracy stage + condition modifiers + item and ability bonuses. */
  total: number
  /** Sheet-authored Accuracy Combat Stage, clamped to PTU's -6..+6 stage bounds. */
  stage: number
  /** Flat Accuracy Roll modifier from conditions such as Blindness or Helping Hand. */
  conditionModifier: number
  /** Flat Accuracy Roll modifier from sheet equipment, currently Luck Incense for Pokémon. */
  itemBonus: number
  /** Flat Accuracy Roll modifier from passive abilities such as Compound Eyes and No Guard. */
  abilityBonus: number
  /** Optional flat Accuracy Roll modifier from active Training Features such as Focused Training. */
  trainingBonus?: number
}

export interface SheetAccuracySummaryInput {
  stage: unknown
  conditions?: readonly string[] | null
  heldItem?: string | null
  includeHeldItemBonus?: boolean
  abilities?: readonly SheetAbilityNameSource[] | null
}

export type AccuracyStageSheet = {
  combatStages?: Partial<Record<CombatStageKey, number>>
}

export const buildSheetAccuracySummary = ({
  stage: rawStage,
  conditions,
  heldItem,
  includeHeldItemBonus = true,
  abilities,
}: SheetAccuracySummaryInput): SheetAccuracySummary => {
  const stage = clampCombatStage(rawStage)
  const conditionModifier = conditionAccuracyModifier(conditions)
  const itemBonus = includeHeldItemBonus ? heldItemAccuracyRollBonus(heldItem) : 0
  const abilityBonus = sheetAbilityAccuracyRollBonus(abilities)
  return {
    total: stage + conditionModifier + itemBonus + abilityBonus,
    stage,
    conditionModifier,
    itemBonus,
    abilityBonus,
  }
}

export const setSheetAccuracyStage = (
  sheet: AccuracyStageSheet,
  value: unknown,
): void => {
  sheet.combatStages ??= {}
  sheet.combatStages.acc = clampCombatStage(value)
}
