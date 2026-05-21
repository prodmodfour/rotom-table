import { applyCombatStageToStat } from '~/utils/combatStageStats'
import { clampCombatStage } from '~/utils/combatStages'
import { computeEvasionTotal, computeStatEvasion } from '~/utils/evasion'
import {
  hasKeenEyeAbility,
  sheetAbilityAdjustedAccuracyStage,
} from '~/utils/sheetAbilityCombatModifiers'
import { sheetHasCanonicalAbility, type SheetAbilityNameSource } from '~/utils/sheetAbilities'
import {
  conditionBaseName,
  conditionDisplayName,
  conditionStackCount,
  disabledConditionMove,
  infatuationCrushName,
  normalizeConditionNames,
} from '~/utils/statusConditions'
import {
  ELECTRIC_RESISTANT_COAT_CONDITION,
  HELPING_HAND_CONDITION,
  SUPERSONIC_ACCURACY_PENALTY_CONDITION,
  SWEET_SCENT_EVASION_PENALTY_CONDITION,
} from '~/utils/moveAutomationSpecialConditions'
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
const SHIFT_MOVEMENT_BLOCKING_CONDITIONS = ['Stuck', 'Tripped'] as const

export const QUICK_FEET_ABILITY_NAME = 'Quick Feet'

const QUICK_FEET_TRIGGERING_CONDITIONS = [
  'Burned',
  'Paralysis',
  'Frozen',
  'Poisoned',
  'Badly Poisoned',
  'Sleep',
] as const

const MOVEMENT_CAPABILITY_LABELS = [
  'Overland',
  'Sky',
  'Swim',
  'Levitate',
  'Burrow',
  'Teleporter',
] as const

const movementCapabilityLabels = new Set<string>(
  MOVEMENT_CAPABILITY_LABELS.map((label) => label.toLowerCase()),
)

const normalizedCapabilityLabel = (label: string): string => label.trim().replace(/\s+/g, ' ').toLowerCase()

type EvasionKind = 'physical' | 'special' | 'speed'

export interface SheetConditionAbilityOptions {
  abilities?: readonly SheetAbilityNameSource[] | null | undefined
}

export interface ConditionAdjustedEvasionOptions extends SheetConditionAbilityOptions {
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

export interface MovementCapabilityConditionAdjustment {
  condition: 'Slowed' | 'Stuck' | 'Tripped'
  adjustedValue: number
  displayValue: string
  title: string
}

const finiteNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const conditionSet = (conditions: readonly string[] | null | undefined): Set<string> =>
  new Set(normalizeConditionNames(conditions).map((condition) => conditionBaseName(condition) ?? condition))

const hasAnyCondition = (conditions: Set<string>, names: readonly string[]): boolean =>
  names.some((name) => conditions.has(name))

export const hasQuickFeetAbility = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => sheetHasCanonicalAbility(abilities, QUICK_FEET_ABILITY_NAME)

export const hasQuickFeetTriggeringStatus = (
  conditions: readonly string[] | null | undefined,
): boolean => hasAnyCondition(conditionSet(conditions), QUICK_FEET_TRIGGERING_CONDITIONS)

const quickFeetActiveForSet = (
  conditions: Set<string>,
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): boolean => hasQuickFeetAbility(abilities) && hasAnyCondition(conditions, QUICK_FEET_TRIGGERING_CONDITIONS)

export const quickFeetSpeedCombatStageModifier = (
  conditions: readonly string[] | null | undefined,
  options: SheetConditionAbilityOptions = {},
): number => quickFeetActiveForSet(conditionSet(conditions), options.abilities) ? 2 : 0

export const quickFeetSuppressesParalysisInitiative = (
  conditions: readonly string[] | null | undefined,
  options: SheetConditionAbilityOptions = {},
): boolean => conditionSet(conditions).has('Paralysis') && hasQuickFeetAbility(options.abilities)

const firstPresentCondition = (conditions: Set<string>, names: readonly string[]): string | null =>
  names.find((name) => conditions.has(name)) ?? null

const evasionSuppressingConditionsForAbilities = (
  abilities: readonly SheetAbilityNameSource[] | null | undefined,
): readonly string[] => hasKeenEyeAbility(abilities)
  ? EVASION_SUPPRESSING_CONDITIONS.filter((condition) => condition !== 'Blindness')
  : EVASION_SUPPRESSING_CONDITIONS

const numericMovementValue = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null
}

export const conditionSlowsMovement = (
  conditions: readonly string[] | null | undefined,
): boolean => conditionSet(conditions).has('Slowed')

export const conditionBlocksShiftMovement = (
  conditions: readonly string[] | null | undefined,
): boolean => hasAnyCondition(conditionSet(conditions), SHIFT_MOVEMENT_BLOCKING_CONDITIONS)

export const isConditionAdjustedMovementCapability = (label: string): boolean =>
  movementCapabilityLabels.has(normalizedCapabilityLabel(label))

export const isSlowedMovementCapability = isConditionAdjustedMovementCapability

export const conditionAdjustedMovement = (
  baseMovement: unknown,
  conditions: readonly string[] | null | undefined,
): number => {
  const movement = numericMovementValue(baseMovement) ?? 0
  if (movement <= 0) return movement
  if (conditionBlocksShiftMovement(conditions)) return 0
  if (!conditionSlowsMovement(conditions)) return movement
  return Math.max(1, Math.floor(movement / 2))
}

export const conditionAdjustedMovementCapability = <T extends number | string | null | undefined>(
  label: string,
  value: T,
  conditions: readonly string[] | null | undefined,
): T | number => {
  if (!isConditionAdjustedMovementCapability(label)) return value
  if (!conditionBlocksShiftMovement(conditions) && !conditionSlowsMovement(conditions)) return value
  const movement = numericMovementValue(value)
  if (movement == null) return value
  return conditionAdjustedMovement(movement, conditions)
}

export const movementCapabilityConditionAdjustment = (
  label: string,
  value: number | string | null | undefined,
  conditions: readonly string[] | null | undefined,
): MovementCapabilityConditionAdjustment | null => {
  if (!isConditionAdjustedMovementCapability(label)) return null
  const movement = numericMovementValue(value)
  if (movement == null || movement <= 0) return null
  const blockingCondition = firstPresentCondition(conditionSet(conditions), SHIFT_MOVEMENT_BLOCKING_CONDITIONS)
  if (blockingCondition === 'Tripped') {
    return {
      condition: 'Tripped',
      adjustedValue: 0,
      displayValue: 'stand first',
      title: 'Tripped requires spending a Shift Action to stand before taking further actions.',
    }
  }
  if (blockingCondition === 'Stuck') {
    return {
      condition: 'Stuck',
      adjustedValue: 0,
      displayValue: 'no Shift movement',
      title: 'Stuck prevents Shift Actions used to move.',
    }
  }
  if (!conditionSlowsMovement(conditions)) return null
  const adjustedValue = conditionAdjustedMovement(movement, conditions)
  return {
    condition: 'Slowed',
    adjustedValue,
    displayValue: String(adjustedValue),
    title: 'Slowed halves Movement, minimum 1.',
  }
}

export const slowedMovementCapabilityApplied = (
  label: string,
  value: number | string | null | undefined,
  conditions: readonly string[] | null | undefined,
): boolean => movementCapabilityConditionAdjustment(label, value, conditions)?.condition === 'Slowed'

export const conditionCombatStageModifier = (
  conditions: readonly string[] | null | undefined,
  key: CombatStatStageKey,
  options: SheetConditionAbilityOptions = {},
): number => {
  const set = conditionSet(conditions)
  let modifier = 0
  if (key === 'def' && set.has('Burned')) modifier -= 2
  if (key === 'sdef' && (set.has('Poisoned') || set.has('Badly Poisoned'))) modifier -= 2
  if (key === 'spd' && quickFeetActiveForSet(set, options.abilities)) modifier += 2
  return modifier
}

export const conditionAdjustedCombatStage = (
  combatStage: unknown,
  conditions: readonly string[] | null | undefined,
  key: CombatStatStageKey,
  options: SheetConditionAbilityOptions = {},
): number => clampCombatStage(clampCombatStage(combatStage) + conditionCombatStageModifier(conditions, key, options))

export const conditionAdjustedCombatStages = (
  stages: Partial<Record<CombatStageKey, unknown>> | null | undefined,
  conditions: readonly string[] | null | undefined,
  options: SheetConditionAbilityOptions = {},
): CombatStageMap => ({
  atk: conditionAdjustedCombatStage(stages?.atk, conditions, 'atk', options),
  def: conditionAdjustedCombatStage(stages?.def, conditions, 'def', options),
  satk: conditionAdjustedCombatStage(stages?.satk, conditions, 'satk', options),
  sdef: conditionAdjustedCombatStage(stages?.sdef, conditions, 'sdef', options),
  spd: conditionAdjustedCombatStage(stages?.spd, conditions, 'spd', options),
  acc: sheetAbilityAdjustedAccuracyStage(stages?.acc, options.abilities),
})

export const conditionAccuracyModifier = (
  conditions: readonly string[] | null | undefined,
  options: SheetConditionAbilityOptions = {},
): number => {
  const set = conditionSet(conditions)
  const keenEye = hasKeenEyeAbility(options.abilities)
  let modifier = 0
  if (set.has('Total Blindness')) modifier -= 10
  else if (set.has('Blindness') && !keenEye) modifier -= 6
  if (set.has(SUPERSONIC_ACCURACY_PENALTY_CONDITION) && !keenEye) modifier -= 2
  if (set.has(HELPING_HAND_CONDITION)) modifier += 2
  return modifier
}

export const conditionDamageRollModifier = (
  conditions: readonly string[] | null | undefined,
): number => conditionSet(conditions).has(HELPING_HAND_CONDITION) ? 10 : 0

export const conditionEvasionModifier = (
  conditions: readonly string[] | null | undefined,
): number => conditionSet(conditions).has(SWEET_SCENT_EVASION_PENALTY_CONDITION) ? -2 : 0

/** Accuracy penalties from conditions are flat roll modifiers, not clamped Combat Stages. */
export const conditionAdjustedAccuracy = (
  accuracyStage: unknown,
  conditions: readonly string[] | null | undefined,
  options: SheetConditionAbilityOptions = {},
): number => {
  const stage = sheetAbilityAdjustedAccuracyStage(accuracyStage, options.abilities)
  return stage + conditionAccuracyModifier(conditions, options)
}

export const evasionSuppressedByCondition = (
  conditions: readonly string[] | null | undefined,
  options: SheetConditionAbilityOptions = {},
): string | null => firstPresentCondition(conditionSet(conditions), evasionSuppressingConditionsForAbilities(options.abilities))

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
  abilities,
  applyCombatStages = true,
}: ConditionAdjustedEvasionOptions): ConditionAdjustedEvasion => {
  const manualStage = clampCombatStage(combatStage)
  const conditionStageModifier = conditionCombatStageModifier(conditions, statStageKey, { abilities })
  const effectiveStage = clampCombatStage(manualStage + conditionStageModifier)
  const baseStatTotal = Math.max(0, finiteNumber(statTotal))
  const effectiveStat = applyCombatStages
    ? applyCombatStageToStat(baseStatTotal, effectiveStage)
    : baseStatTotal
  const base = computeStatEvasion(effectiveStat)
  const evasionBonus = finiteNumber(bonus)
  const conditionEvasionModifierValue = conditionEvasionModifier(conditions)
  const allSuppressedBy = evasionSuppressedByCondition(conditions, { abilities })
  const speedSuppressedBy = kind === 'speed' ? speedEvasionSuppressedByCondition(conditions) : null
  const suppressedByCondition = allSuppressedBy ?? speedSuppressedBy

  return {
    total: suppressedByCondition ? 0 : computeEvasionTotal(base, evasionBonus + conditionEvasionModifierValue),
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
  options: SheetConditionAbilityOptions = {},
): number => {
  const set = conditionSet(conditions)
  let initiative = Math.trunc(finiteNumber(baseSpeed))
  if (set.has('Paralysis') && !hasQuickFeetAbility(options.abilities)) initiative = Math.floor(initiative / 2)
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
  options: { tickValue?: number | null | undefined } & SheetConditionAbilityOptions = {},
): ConditionEffectSummary[] => {
  const set = conditionSet(conditions)
  const quickFeetActive = quickFeetActiveForSet(set, options.abilities)
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
      description: hasQuickFeetAbility(options.abilities)
        ? 'Quick Feet prevents Initiative from being halved. On a failed 11+ start-of-turn save: Standard or Shift only, Vulnerable, and no attacks of opportunity for 1 full round.'
        : 'Initiative is halved. On a failed 11+ start-of-turn save: Standard or Shift only, Vulnerable, and no attacks of opportunity for 1 full round.',
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

  if (set.has(HELPING_HAND_CONDITION)) {
    effects.push({
      id: 'helping-hand-bonus',
      label: HELPING_HAND_CONDITION,
      description: 'Next Accuracy Roll this round gains +2 and next Damage Roll this round gains +10; remove after the bonus is consumed or the round ends.',
    })
  }

  if (set.has(SUPERSONIC_ACCURACY_PENALTY_CONDITION)) {
    effects.push({
      id: 'supersonic-accuracy-penalty',
      label: SUPERSONIC_ACCURACY_PENALTY_CONDITION,
      description: hasKeenEyeAbility(options.abilities)
        ? 'Ignored by Keen Eye; attacks cannot have Accuracy Penalties.'
        : 'Accuracy Rolls take a -2 penalty for one full round.',
    })
  }

  if (set.has(ELECTRIC_RESISTANT_COAT_CONDITION)) {
    effects.push({
      id: 'electric-resistant-coat',
      label: ELECTRIC_RESISTANT_COAT_CONDITION,
      description: 'Electric-Type damage is resisted one step further; remove after being hit by a damaging Electric-Type Move.',
    })
  }

  if (set.has(SWEET_SCENT_EVASION_PENALTY_CONDITION)) {
    effects.push({
      id: 'sweet-scent-evasion-penalty',
      label: SWEET_SCENT_EVASION_PENALTY_CONDITION,
      description: 'Total Evasion takes a -2 penalty, to a minimum of 0.',
    })
  }

  if (set.has('Rage')) {
    effects.push({
      id: 'rage-actions',
      label: conditionDisplayName('Rage'),
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
      description: hasKeenEyeAbility(options.abilities)
        ? 'Ignored by Keen Eye; the user is immune to Blindness, but not Total Blindness.'
        : 'Accuracy Rolls take -6 and the target is treated as Vulnerable. Rough or Slow Terrain may cause Tripping.',
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
      description: 'Cannot Shift to move and cannot apply Speed Evasion. Ghost-type Pokémon are immune.',
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

  if (quickFeetActive) {
    effects.push({
      id: 'quick-feet-speed',
      label: QUICK_FEET_ABILITY_NAME,
      description: 'Speed Combat Stage +2 while Burned, Poisoned, Paralyzed, Frozen, or Asleep. Paralysis does not halve Initiative.',
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
