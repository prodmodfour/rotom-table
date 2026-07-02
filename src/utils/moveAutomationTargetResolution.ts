import { applyCombatStageToStat } from '~/utils/combatStageStats'
import {
  conditionAdjustedCombatStage,
  conditionDamageRollModifier,
} from '~/utils/sheetConditionEffects'
import { fieldEffectDamageBonus, type DamageRollResult } from '~/utils/moveAutomation'
import { parsePositiveInt } from '~/utils/moveAutomationDialog'
import { applyInfatuationOffenseModifier, resolveInfatuationDamageEffect } from '~/utils/infatuationDamage'
import { resolveMoveAutomationDirectHpLoss } from '~/utils/moveAutomationDirectHpLoss'
import {
  formatMultiplier,
  resistMultiplierOneStepFurther,
} from '~/utils/typeChart'
import { computeSheetAbilityAwareMultiplier } from '~/utils/sheetPassiveAbilityEffects'
import { conditionBaseName, normalizeConditionNames } from '~/utils/statusConditions'
import { ELECTRIC_RESISTANT_COAT_CONDITION } from '~/utils/moveAutomationSpecialConditions'
import { moveAutomationMoveImmunitySource } from '~/utils/moveAutomationMoveImmunity'
import { moveAutomationPassiveImmunityKeywordsForTarget } from '~/utils/moveAutomationKeywordImmunity'
import type { MapFieldEffects } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export type MoveAutomationSuggestionKind = 'condition' | 'stage' | 'hp' | 'field' | 'hazard'

export interface MoveAutomationTargetResolutionState {
  accuracyRoll: string
  hit: boolean
  crit: boolean
  damageRoll: DamageRollResult | null
  /** Explicit critical bonus used by multi-roll keywords such as Double Strike. */
  criticalBonusDamage?: number
  manualHpLoss: string
  applyDamage: boolean
}

export type MoveAutomationDamageBreakdownKind = 'none' | 'manual' | 'direct' | 'standard'

export interface MoveAutomationDamageBreakdownTerm {
  operator: 'add' | 'subtract'
  amount: number
  label: string
}

export interface MoveAutomationDamageBreakdownBase {
  kind: MoveAutomationDamageBreakdownKind
  hpLoss: number
}

export interface MoveAutomationNoDamageBreakdown extends MoveAutomationDamageBreakdownBase {
  kind: 'none'
  hpLoss: 0
}

export interface MoveAutomationManualDamageBreakdown extends MoveAutomationDamageBreakdownBase {
  kind: 'manual'
  manualHpLoss: number
}

export interface MoveAutomationDirectDamageBreakdown extends MoveAutomationDamageBreakdownBase {
  kind: 'direct'
  label: string
}

export interface MoveAutomationStandardDamageBreakdown extends MoveAutomationDamageBreakdownBase {
  kind: 'standard'
  terms: MoveAutomationDamageBreakdownTerm[]
  multiplier: number
  multiplierLabel: string
  scaledDamage: number
  minimumDamageApplied: boolean
  critical: boolean
}

export type MoveAutomationDamageBreakdown =
  | MoveAutomationNoDamageBreakdown
  | MoveAutomationManualDamageBreakdown
  | MoveAutomationDirectDamageBreakdown
  | MoveAutomationStandardDamageBreakdown

export const moveAutomationSuggestionKey = (
  script: MoveAutomationScript | null | undefined,
  kind: MoveAutomationSuggestionKind,
  index: number,
): string => `${script?.moveName ?? 'move'}:${kind}:${index}`

export const defaultTargetResolutionState = (
  script: MoveAutomationScript | null | undefined,
): MoveAutomationTargetResolutionState => ({
  accuracyRoll: '',
  hit: !script?.requiresAccuracy,
  crit: false,
  damageRoll: null,
  manualHpLoss: '',
  applyDamage: Boolean(script?.damaging),
})

export const suggestionIsEnabled = (
  script: MoveAutomationScript | null | undefined,
  enabledSuggestions: Readonly<Record<string, boolean | undefined>>,
  kind: MoveAutomationSuggestionKind,
  index: number,
): boolean => Boolean(enabledSuggestions[moveAutomationSuggestionKey(script, kind, index)])

const targetHasCondition = (
  target: SpawnedPokemon,
  conditionName: string,
): boolean => normalizeConditionNames(target.conditions)
  .some((condition) => (conditionBaseName(condition) ?? condition) === conditionName)

export const moveAutomationTargetDamageMultiplier = (
  script: MoveAutomationScript | null | undefined,
  target: SpawnedPokemon,
): number => {
  if (script && moveAutomationMoveImmunitySource(script, target)) return 0

  const multiplier = computeSheetAbilityAwareMultiplier(
    script?.type ?? 'Normal',
    target.defenderTypes,
    target.abilityNames,
    target.defenderCapabilities,
    { moveKeywords: script ? moveAutomationPassiveImmunityKeywordsForTarget(script.keywords, target) : undefined },
  )
  if (script?.type === 'Electric' && multiplier > 0 && targetHasCondition(target, ELECTRIC_RESISTANT_COAT_CONDITION)) {
    return resistMultiplierOneStepFurther(multiplier)
  }
  return multiplier
}

export const moveAutomationMultiplierLabel = (
  script: MoveAutomationScript | null | undefined,
  target: SpawnedPokemon,
): string => {
  const multiplier = moveAutomationTargetDamageMultiplier(script, target)
  if (script?.directHpLoss?.ignoreWeaknessResistance) {
    return multiplier === 0 ? '0 (immune)' : '1 (ignores weakness/resistance)'
  }
  return formatMultiplier(multiplier)
}

const NO_DAMAGE_BREAKDOWN: MoveAutomationNoDamageBreakdown = { kind: 'none', hpLoss: 0 }

const damageTerm = (
  amount: number,
  label: string,
): MoveAutomationDamageBreakdownTerm => ({
  operator: amount < 0 ? 'subtract' : 'add',
  amount: Math.abs(amount),
  label,
})

export const resolveMoveAutomationTargetDamageBreakdown = (
  script: MoveAutomationScript | null | undefined,
  user: SpawnedPokemon,
  target: SpawnedPokemon,
  resolution: MoveAutomationTargetResolutionState | undefined,
  fieldEffects?: MapFieldEffects,
  selectedTargets: readonly SpawnedPokemon[] = [target],
): MoveAutomationDamageBreakdown => {
  if (!script?.damaging) return NO_DAMAGE_BREAKDOWN
  const state = resolution ?? defaultTargetResolutionState(script)
  if (!state.applyDamage || !state.hit) return NO_DAMAGE_BREAKDOWN
  const manual = parsePositiveInt(state.manualHpLoss)
  if (manual != null) return { kind: 'manual', hpLoss: manual, manualHpLoss: manual }
  const directHpLoss = resolveMoveAutomationDirectHpLoss({
    script,
    user,
    target,
    rollTotal: state.damageRoll?.total,
  })
  if (directHpLoss != null) {
    if (directHpLoss <= 0) return NO_DAMAGE_BREAKDOWN
    return { kind: 'direct', hpLoss: directHpLoss, label: script.directHpLoss?.label ?? 'direct HP loss' }
  }
  const baseRollTotal = state.damageRoll?.total ?? 0
  const criticalDamageBonus = state.criticalBonusDamage != null
    ? state.criticalBonusDamage
    : state.crit
      ? state.damageRoll?.rolls.reduce((sum, roll) => sum + roll, 0) ?? 0
      : 0
  const unmodifiedRaw = baseRollTotal + criticalDamageBonus
  if (unmodifiedRaw <= 0) return NO_DAMAGE_BREAKDOWN
  const infatuation = resolveInfatuationDamageEffect(user.conditions, selectedTargets)
  const conditionRollModifier = conditionDamageRollModifier(user.conditions)
  const raw = unmodifiedRaw + infatuation.damageRollModifier + conditionRollModifier
  const physical = script.damageClass === 'Physical'
  const stagedOffense = physical
    ? applyCombatStageToStat(user.atk, conditionAdjustedCombatStage(
      user.combatStages.atk,
      user.conditions,
      'atk',
      { abilities: user.abilityNames },
    ))
    : applyCombatStageToStat(user.satk, conditionAdjustedCombatStage(
      user.combatStages.satk,
      user.conditions,
      'satk',
      { abilities: user.abilityNames },
    ))
  const offense = applyInfatuationOffenseModifier(stagedOffense, infatuation)
  const defense = physical
    ? applyCombatStageToStat(target.def, conditionAdjustedCombatStage(
      target.combatStages.def,
      target.conditions,
      'def',
      { abilities: target.abilityNames },
    ))
    : applyCombatStageToStat(target.sdef, conditionAdjustedCombatStage(
      target.combatStages.sdef,
      target.conditions,
      'sdef',
      { abilities: target.abilityNames },
    ))
  const fieldBonus = fieldEffectDamageBonus(script.type, fieldEffects)
  const multiplier = moveAutomationTargetDamageMultiplier(script, target)
  if (multiplier === 0) return NO_DAMAGE_BREAKDOWN
  const afterDefense = raw + offense + fieldBonus - defense
  const scaledDamage = Math.floor(afterDefense * multiplier)
  const hpLoss = Math.max(1, scaledDamage)
  const terms: MoveAutomationDamageBreakdownTerm[] = [
    damageTerm(baseRollTotal, 'roll'),
  ]
  if (criticalDamageBonus !== 0) terms.push(damageTerm(criticalDamageBonus, 'critical'))
  if (conditionRollModifier !== 0) terms.push(damageTerm(conditionRollModifier, 'conditions'))
  if (infatuation.damageRollModifier !== 0) terms.push(damageTerm(infatuation.damageRollModifier, 'Infatuation'))
  terms.push(damageTerm(offense, physical ? 'Atk' : 'Sp.Atk'))
  if (fieldBonus !== 0) terms.push(damageTerm(fieldBonus, 'field'))
  terms.push({ operator: 'subtract', amount: defense, label: physical ? 'Def' : 'Sp.Def' })

  return {
    kind: 'standard',
    hpLoss,
    terms,
    multiplier,
    multiplierLabel: formatMultiplier(multiplier),
    scaledDamage,
    minimumDamageApplied: hpLoss !== scaledDamage,
    critical: state.crit,
  }
}

export const resolveMoveAutomationTargetDamageLoss = (
  script: MoveAutomationScript | null | undefined,
  user: SpawnedPokemon,
  target: SpawnedPokemon,
  resolution: MoveAutomationTargetResolutionState | undefined,
  fieldEffects?: MapFieldEffects,
  selectedTargets: readonly SpawnedPokemon[] = [target],
): number => resolveMoveAutomationTargetDamageBreakdown(
  script,
  user,
  target,
  resolution,
  fieldEffects,
  selectedTargets,
).hpLoss

export interface ResolveHpSuggestionAmountOptions {
  damageDealt?: number
  fieldEffects?: MapFieldEffects
}

export const resolveHpSuggestionAmount = (
  script: MoveAutomationScript | null | undefined,
  hpSuggestionAmounts: Readonly<Record<string, string | undefined>>,
  index: number,
  token: SpawnedPokemon,
  options: ResolveHpSuggestionAmountOptions = {},
): number => {
  const item = script?.hpSuggestions[index]
  if (!item) return 0
  const override = parsePositiveInt(hpSuggestionAmounts[moveAutomationSuggestionKey(script, 'hp', index)] ?? '')
  if (override != null) return override
  if (item.mode === 'fixed-loss') return item.amount ?? 0
  if (item.mode === 'set-zero') return token.currentHp
  const weatherOverride = options.fieldEffects?.weather
    ?.map((effect) => item.weatherPercentOverrides?.[effect.kind])
    .find((percent): percent is number => typeof percent === 'number')
  const percent = weatherOverride ?? item.percent
  if (!percent) return 0
  const base = item.mode === 'heal-percent-damage-dealt' || item.mode === 'recoil-percent-damage-dealt'
    ? options.damageDealt ?? 0
    : item.mode === 'lose-percent-current'
      ? token.currentHp
      : token.maxHp
  const raw = base * percent / 100
  const rounded = item.rounding === 'floor' ? Math.floor(raw) : Math.round(raw)
  return Math.max(0, rounded)
}
