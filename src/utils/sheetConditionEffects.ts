import { applyCombatStageToStat } from '~/utils/combatStageStats'
import { clampCombatStage } from '~/utils/combatStages'
import { computeEvasionTotal, computeStatEvasion } from '~/utils/evasion'
import {
  conditionBaseName,
  conditionStackCount,
  disabledConditionMove,
  infatuationCrushName,
  normalizeConditionNames,
} from '~/utils/statusConditions'
import type { CombatStageKey, CombatStageMap, CombatStatStageKey } from '~/types/combatStages'

const EVASION_SUPPRESSING_CONDITIONS = [
  'Vulnerable',
  'Sleep',
  'Bad Sleep',
  'Frozen',
  'Fainted',
  'Blindness',
  'Total Blindness',
  'Tripped',
] as const

const SPEED_EVASION_SUPPRESSING_CONDITIONS = ['Stuck'] as const

type EvasionKind = 'physical' | 'special' | 'speed'

export interface ConditionAdjustedEvasionOptions {
  statTotal: number | null | undefined
  combatStage?: number | null | undefined
  bonus?: number | null | undefined
  conditions?: readonly string[] | null | undefined
  statStageKey: CombatStatStageKey
  kind: EvasionKind
  /**
   * Whether Combat Stages should alter the stat before deriving evasion.
   * Sheet displays keep stat totals/evasion based on the sheet Total column;
   * automation can opt into staged combat math.
   */
  applyCombatStages?: boolean
}

export interface ConditionAdjustedEvasion {
  total: number
  /** Stat-derived evasion after combat-stage and condition-stage effects. */
  base: number
  bonus: number
  /** The sheet-authored Combat Stage before condition effects. */
  manualStage: number
  /** Condition-supplied Combat Stage delta, such as Burned's Defense -2. */
  conditionStageModifier: number
  /** Final Combat Stage used for the stat-derived evasion calculation. */
  effectiveStage: number
  /** Base stat total before Combat Stages. */
  statTotal: number
  /** Stat total after Combat Stages and condition stage modifiers. */
  effectiveStat: number
  /** Condition that reduces this evasion to 0, if any. */
  suppressedByCondition: string | null
}

export interface ConditionEffectSummary {
  id: string
  label: string
  description: string
}

const finiteNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const conditionSet = (conditions: readonly string[] | null | undefined): Set<string> =>
  new Set(normalizeConditionNames(conditions).map((condition) => conditionBaseName(condition) ?? condition))

const hasAnyCondition = (conditions: Set<string>, names: readonly string[]): boolean =>
  names.some((name) => conditions.has(name))

const firstPresentCondition = (conditions: Set<string>, names: readonly string[]): string | null =>
  names.find((name) => conditions.has(name)) ?? null

export const conditionCombatStageModifier = (
  conditions: readonly string[] | null | undefined,
  key: CombatStatStageKey,
): number => {
  const set = conditionSet(conditions)
  if (key === 'def' && set.has('Burned')) return -2
  if (key === 'sdef' && (set.has('Poisoned') || set.has('Badly Poisoned'))) return -2
  return 0
}

export const conditionAdjustedCombatStage = (
  combatStage: unknown,
  conditions: readonly string[] | null | undefined,
  key: CombatStatStageKey,
): number => clampCombatStage(clampCombatStage(combatStage) + conditionCombatStageModifier(conditions, key))

export const conditionAdjustedCombatStages = (
  stages: Partial<Record<CombatStageKey, unknown>> | null | undefined,
  conditions: readonly string[] | null | undefined,
): CombatStageMap => ({
  atk: conditionAdjustedCombatStage(stages?.atk, conditions, 'atk'),
  def: conditionAdjustedCombatStage(stages?.def, conditions, 'def'),
  satk: conditionAdjustedCombatStage(stages?.satk, conditions, 'satk'),
  sdef: conditionAdjustedCombatStage(stages?.sdef, conditions, 'sdef'),
  spd: conditionAdjustedCombatStage(stages?.spd, conditions, 'spd'),
  acc: clampCombatStage(stages?.acc),
})

export const conditionAccuracyModifier = (
  conditions: readonly string[] | null | undefined,
): number => {
  const set = conditionSet(conditions)
  if (set.has('Total Blindness')) return -10
  if (set.has('Blindness')) return -6
  return 0
}

/** Accuracy penalties from conditions are flat roll modifiers, not clamped Combat Stages. */
export const conditionAdjustedAccuracy = (
  accuracyStage: unknown,
  conditions: readonly string[] | null | undefined,
): number => clampCombatStage(accuracyStage) + conditionAccuracyModifier(conditions)

export const evasionSuppressedByCondition = (
  conditions: readonly string[] | null | undefined,
): string | null => firstPresentCondition(conditionSet(conditions), EVASION_SUPPRESSING_CONDITIONS)

export const speedEvasionSuppressedByCondition = (
  conditions: readonly string[] | null | undefined,
): string | null => firstPresentCondition(conditionSet(conditions), SPEED_EVASION_SUPPRESSING_CONDITIONS)

export const conditionAdjustedEvasion = ({
  statTotal,
  combatStage,
  bonus,
  conditions,
  statStageKey,
  kind,
  applyCombatStages = true,
}: ConditionAdjustedEvasionOptions): ConditionAdjustedEvasion => {
  const manualStage = clampCombatStage(combatStage)
  const conditionStageModifier = conditionCombatStageModifier(conditions, statStageKey)
  const effectiveStage = clampCombatStage(manualStage + conditionStageModifier)
  const baseStatTotal = Math.max(0, finiteNumber(statTotal))
  const effectiveStat = applyCombatStages
    ? applyCombatStageToStat(baseStatTotal, effectiveStage)
    : baseStatTotal
  const base = computeStatEvasion(effectiveStat)
  const evasionBonus = finiteNumber(bonus)
  const allSuppressedBy = evasionSuppressedByCondition(conditions)
  const speedSuppressedBy = kind === 'speed' ? speedEvasionSuppressedByCondition(conditions) : null
  const suppressedByCondition = allSuppressedBy ?? speedSuppressedBy

  return {
    total: suppressedByCondition ? 0 : computeEvasionTotal(base, evasionBonus),
    base,
    bonus: evasionBonus,
    manualStage,
    conditionStageModifier,
    effectiveStage,
    statTotal: baseStatTotal,
    effectiveStat,
    suppressedByCondition,
  }
}

export const conditionAdjustedInitiative = (
  baseSpeed: number | null | undefined,
  conditions: readonly string[] | null | undefined,
): number => {
  const set = conditionSet(conditions)
  let initiative = Math.trunc(finiteNumber(baseSpeed))
  if (set.has('Paralysis')) initiative = Math.floor(initiative / 2)
  const flinchStacks = conditionStackCount(conditions, 'Flinch')
  if (flinchStacks > 0) initiative -= 5 * flinchStacks
  return initiative
}

const tickText = (tickValue: number | null | undefined, ticks = 1): string => {
  const tick = finiteNumber(tickValue)
  const label = ticks === 1 ? '1 Tick' : `${ticks} Ticks`
  if (tick <= 0) return label
  return `${label} (${tick * ticks} HP)`
}

export const describeSheetConditionEffects = (
  conditions: readonly string[] | null | undefined,
  options: { tickValue?: number | null | undefined } = {},
): ConditionEffectSummary[] => {
  const set = conditionSet(conditions)
  const effects: ConditionEffectSummary[] = []

  if (set.has('Burned')) {
    effects.push({
      id: 'burned-defense',
      label: 'Burned',
      description: `Defense Combat Stage -2; after taking or being denied a Standard Action, lose ${tickText(options.tickValue)}.`,
    })
  }

  if (set.has('Poisoned')) {
    effects.push({
      id: 'poisoned-special-defense',
      label: 'Poisoned',
      description: `Special Defense Combat Stage -2; after taking or being denied a Standard Action, lose ${tickText(options.tickValue)}.`,
    })
  }

  if (set.has('Badly Poisoned')) {
    effects.push({
      id: 'badly-poisoned-loss',
      label: 'Badly Poisoned',
      description: 'Special Defense Combat Stage -2; end-of-turn loss starts at 5 HP and doubles each consecutive round.',
    })
  }

  if (set.has('Paralysis')) {
    effects.push({
      id: 'paralysis-initiative',
      label: 'Paralysis',
      description: 'Initiative is halved. On a failed 11+ start-of-turn save: Standard or Shift only, Vulnerable, and no attacks of opportunity for 1 full round.',
    })
  }

  if (set.has('Frozen')) {
    effects.push({
      id: 'frozen-actions-evasion',
      label: 'Frozen',
      description: 'Cannot act and applies no Evasion. End-of-turn save DC 16; Fire types use DC 11.',
    })
  }

  if (set.has('Sleep')) {
    effects.push({
      id: 'sleep-actions-evasion',
      label: 'Sleep',
      description: 'Applies no Evasion and cannot act except Free/Swift actions that cure Sleep. End-of-turn save DC 16.',
    })
  }

  if (set.has('Bad Sleep')) {
    effects.push({
      id: 'bad-sleep-ticks',
      label: 'Bad Sleep',
      description: `Applies no Evasion. Whenever a save against Sleep is made, lose ${tickText(options.tickValue, 2)}. Ends when Sleep ends.`,
    })
  }

  if (set.has('Cursed')) {
    effects.push({
      id: 'cursed-ticks',
      label: 'Cursed',
      description: `After taking a Standard Action, lose ${tickText(options.tickValue, 2)}.`,
    })
  }

  const flinchStacks = conditionStackCount(conditions, 'Flinch')
  if (flinchStacks > 0) {
    const initiativePenalty = 5 * flinchStacks
    effects.push({
      id: 'flinch-initiative',
      label: flinchStacks === 1 ? 'Flinch' : `Flinch ×${flinchStacks}`,
      description: `Initiative is lowered by ${initiativePenalty} for the Scene; each applied stack also makes the target Vulnerable for 1 full round.`,
    })
  }

  if (set.has('Infatuation')) {
    const entry = normalizeConditionNames(conditions)
      .find((condition) => conditionBaseName(condition) === 'Infatuation')
    const crushName = infatuationCrushName(entry)
    effects.push({
      id: 'infatuation-damage',
      label: crushName ? `Infatuation: ${crushName}` : 'Infatuation',
      description: crushName
        ? `Crush: ${crushName}. Damage Rolls that do not include the crush take -5. Attacks including the crush halve Attack and Special Attack for the roll.`
        : 'Damage Rolls that do not include the crush take -5. Attacks including the crush halve Attack and Special Attack for the roll.',
    })
  }

  if (set.has('Confused')) {
    effects.push({
      id: 'confused-attacks',
      label: 'Confused',
      description: 'Cannot make attacks of opportunity. Attacks risk self-damage on 1 on 1d2; end-of-turn save DC 16.',
    })
  }

  if (set.has('Suppressed')) {
    effects.push({
      id: 'suppressed-frequency',
      label: 'Suppressed',
      description: 'Cannot use Moves with any Frequency other than At-Will for 1 full round.',
    })
  }

  if (set.has('Rage')) {
    effects.push({
      id: 'rage-actions',
      label: 'Rage',
      description: 'Must use a damaging Physical or Special Move or Struggle Attack. End-of-turn save DC 15.',
    })
  }

  if (set.has('Vulnerable')) {
    effects.push({
      id: 'vulnerable-evasion',
      label: 'Vulnerable',
      description: 'Cannot apply Evasion of any sort against attacks.',
    })
  }

  if (set.has('Blindness')) {
    effects.push({
      id: 'blindness-accuracy',
      label: 'Blindness',
      description: 'Accuracy Rolls take -6 and the target is treated as Vulnerable. Rough or Slow Terrain may cause Tripping.',
    })
  }

  if (set.has('Total Blindness')) {
    effects.push({
      id: 'total-blindness-accuracy',
      label: 'Total Blindness',
      description: 'Accuracy Rolls take -10, the target is treated as Vulnerable, and Priority/Interrupt Moves cannot be used.',
    })
  }

  if (set.has('Slowed')) {
    effects.push({
      id: 'slowed-movement',
      label: 'Slowed',
      description: 'Movement is halved, minimum 1.',
    })
  }

  if (set.has('Stuck')) {
    effects.push({
      id: 'stuck-movement-evasion',
      label: 'Stuck',
      description: 'Cannot Shift to move and cannot apply Speed Evasion.',
    })
  }

  if (set.has('Trapped')) {
    effects.push({
      id: 'trapped-recall',
      label: 'Trapped',
      description: 'Cannot be recalled.',
    })
  }

  if (set.has('Tripped')) {
    effects.push({
      id: 'tripped-shift-evasion',
      label: 'Tripped',
      description: 'Must spend a Shift Action to stand before taking further actions and is treated as Vulnerable.',
    })
  }

  if (set.has('Fainted')) {
    effects.push({
      id: 'fainted-actions-evasion',
      label: 'Fainted',
      description: 'Cannot use actions, abilities, or features unless specifically allowed; treated as Vulnerable.',
    })
  }

  const disabledEntries = normalizeConditionNames(conditions)
    .filter((condition) => conditionBaseName(condition) === 'Disabled')
  for (const entry of disabledEntries) {
    const moveName = disabledConditionMove(entry)
    effects.push({
      id: moveName ? `disabled-move-${moveName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : 'disabled-move',
      label: moveName ? `Disabled: ${moveName}` : 'Disabled',
      description: moveName
        ? `${moveName} cannot be used while Disabled.`
        : 'Choose the disabled Move; that Move cannot be used while Disabled.',
    })
  }

  return effects
}
