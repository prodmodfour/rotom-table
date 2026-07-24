import { applyCombatStageToStat } from '~/utils/combatStageStats'
import {
  conditionAdjustedCombatStage,
  conditionDamageRollModifier,
} from '~/utils/sheetConditionEffects'
import {
  fieldEffectDamageContributions,
  type DamageRollResult,
} from '~/utils/moveAutomation'
import { parsePositiveInt } from '~/utils/moveAutomationDialog'
import { applyInfatuationOffenseModifier, resolveInfatuationDamageEffect } from '~/utils/infatuationDamage'
import { mapFieldEffectsHaveActiveRoom } from '~/utils/encounterRooms'
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
import {
  moveAutomationDamageAppliesOnAccuracyOutcome,
  moveAutomationEffectivenessForAccuracyOutcome,
  moveAutomationIsSmiteMiss,
} from '~/utils/moveAutomationSmite'
import {
  resolveMoveDamagePipeline,
  type MoveDamageModifier,
  type MoveDamageModifierSource,
  type MoveDamagePipelineResult,
} from '~/utils/moveAutomationDamagePipeline'
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
  /** Complete ordered arithmetic evidence; optional only for legacy formatted fixtures. */
  pipeline?: MoveDamagePipelineResult
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

export interface MoveAutomationResolvedDamageStat {
  readonly value: number
  readonly label: string
  /** Applies actor-owned contextual offense modifiers such as Infatuation. */
  readonly applyActorOffenseModifiers?: boolean
  /** Reviewed origin retained when an operation selects a non-default stat. */
  readonly source?: MoveDamageModifierSource
}

export interface MoveAutomationResolvedDamageStats {
  readonly attackStat?: MoveAutomationResolvedDamageStat
  readonly defenseStat?: MoveAutomationResolvedDamageStat
}

export interface MoveAutomationResolvedDamageInputs {
  readonly stats?: MoveAutomationResolvedDamageStats
  /** Final per-recipient DB that produced the authoritative damage roll. */
  readonly damageBase?: number | null
  /** Server-resolved operation type and exact final effectiveness for this recipient. */
  readonly typeEffectiveness?: {
    readonly moveType: string
    readonly multiplier: number
  }
  /** Exact effective passive projection for defensive stage providers. */
  readonly dauntlessShieldActive?: boolean
  /** Exact effective passive projection for condition-gated Attack stages. */
  readonly gutsActive?: boolean
  /** Future server-owned queries may contribute only fully attributed modifiers. */
  readonly additionalModifiers?: readonly MoveDamageModifier[]
}

export const resolveMoveAutomationTargetDamageBreakdown = (
  script: MoveAutomationScript | null | undefined,
  user: SpawnedPokemon,
  target: SpawnedPokemon,
  resolution: MoveAutomationTargetResolutionState | undefined,
  fieldEffects?: MapFieldEffects,
  selectedTargets: readonly SpawnedPokemon[] = [target],
  resolvedDamage: MoveAutomationResolvedDamageInputs = {},
): MoveAutomationDamageBreakdown => {
  if (!script?.damaging) return NO_DAMAGE_BREAKDOWN
  const state = resolution ?? defaultTargetResolutionState(script)
  if (!state.applyDamage || !moveAutomationDamageAppliesOnAccuracyOutcome(script, state.hit)) {
    return NO_DAMAGE_BREAKDOWN
  }
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
  const resolvedStats = resolvedDamage.stats ?? {}
  const baseRollTotal = state.damageRoll?.total ?? 0
  const criticalDamageBonus = !state.hit
    ? 0
    : state.criticalBonusDamage != null
      ? state.criticalBonusDamage
      : state.crit
        ? state.damageRoll?.rolls.reduce((sum, roll) => sum + roll, 0) ?? 0
        : 0
  const criticalApplied = state.hit && (state.crit || criticalDamageBonus !== 0)
  const unmodifiedRaw = baseRollTotal + criticalDamageBonus
  if (unmodifiedRaw <= 0) return NO_DAMAGE_BREAKDOWN
  const infatuation = resolveInfatuationDamageEffect(user.conditions, selectedTargets)
  const conditionRollModifier = conditionDamageRollModifier(user.conditions)
  const physical = script.damageClass === 'Physical'
  const effectiveOffenseAbilities = [
    ...(user.abilityNames ?? []).filter(name => name !== 'Guts'),
    ...((resolvedDamage.gutsActive ?? user.abilityNames?.includes('Guts')) ? ['Guts'] : []),
  ]
  const defaultOffense = physical
    ? applyCombatStageToStat(user.atk, conditionAdjustedCombatStage(
      user.combatStages.atk,
      user.conditions,
      'atk',
      { abilities: effectiveOffenseAbilities },
    ))
    : applyCombatStageToStat(user.satk, conditionAdjustedCombatStage(
      user.combatStages.satk,
      user.conditions,
      'satk',
      { abilities: user.abilityNames },
    ))
  const selectedOffense = resolvedStats.attackStat?.value ?? defaultOffense
  const offense = resolvedStats.attackStat?.applyActorOffenseModifiers === false
    ? selectedOffense
    : applyInfatuationOffenseModifier(selectedOffense, infatuation)
  const wonderRoomActive = target.sheetKind === 'pokemon'
    && mapFieldEffectsHaveActiveRoom(fieldEffects, 'wonder')
  const defaultDefenseUsesPhysicalStat = wonderRoomActive ? !physical : physical
  const defense = resolvedStats.defenseStat?.value ?? (defaultDefenseUsesPhysicalStat
    ? applyCombatStageToStat(target.def, conditionAdjustedCombatStage(
      (resolvedDamage.dauntlessShieldActive
        ?? target.abilityNames?.includes('Dauntless Shield'))
        ? Math.min(6, target.combatStages.def + 1)
        : target.combatStages.def,
      target.conditions,
      'def',
      { abilities: target.abilityNames },
    ))
    : applyCombatStageToStat(target.sdef, conditionAdjustedCombatStage(
      target.combatStages.sdef,
      target.conditions,
      'sdef',
      { abilities: target.abilityNames },
    )))
  const resolvedMoveType = resolvedDamage.typeEffectiveness?.moveType ?? script.type
  const fieldContributions = fieldEffectDamageContributions(
    resolvedMoveType,
    fieldEffects,
    user.abilityNames,
  )
  const baseMultiplier = resolvedDamage.typeEffectiveness?.multiplier
    ?? moveAutomationTargetDamageMultiplier(script, target)
  const multiplier = moveAutomationEffectivenessForAccuracyOutcome(
    script,
    state.hit,
    baseMultiplier,
  )
  if (multiplier === 0) return NO_DAMAGE_BREAKDOWN
  const smiteMiss = moveAutomationIsSmiteMiss(script, state.hit)

  const moveSource = { kind: 'move', id: script.moveName } as const
  const modifiers: MoveDamageModifier[] = [{
    id: 'damage.base-roll',
    stage: 'base-damage-base',
    priority: -100_000,
    source: moveSource,
    stackingGroup: 'base-damage-roll',
    reasonCode: 'damage.base-roll',
    operation: 'set',
    value: baseRollTotal,
  }, {
    id: 'damage.attack-stat',
    stage: 'attack-stat',
    priority: 0,
    source: resolvedStats.attackStat?.source ?? { kind: 'placement', id: user.id },
    stackingGroup: 'attack-stat',
    reasonCode: resolvedStats.attackStat
      ? 'damage.reviewed-attack-stat'
      : 'damage.default-attack-stat',
    operation: 'add',
    value: offense,
  }, {
    id: 'damage.defense-stat',
    stage: 'defense-stat',
    priority: 0,
    source: resolvedStats.defenseStat?.source ?? { kind: 'placement', id: target.id },
    stackingGroup: 'defense-stat',
    reasonCode: resolvedStats.defenseStat
      ? 'damage.reviewed-defense-stat'
      : 'damage.default-defense-stat',
    operation: 'subtract',
    value: defense,
  }]
  if (conditionRollModifier !== 0) {
    modifiers.push({
      id: 'damage.condition-roll',
      stage: 'pre-type-modifiers',
      priority: 100,
      source: { kind: 'condition', id: 'Helping Hand' },
      stackingGroup: 'condition-damage-roll',
      reasonCode: 'damage.condition-roll-modifier',
      operation: 'add',
      value: conditionRollModifier,
    })
  }
  if (infatuation.damageRollModifier !== 0) {
    modifiers.push({
      id: 'damage.infatuation-roll',
      stage: 'pre-type-modifiers',
      priority: 110,
      source: { kind: 'condition', id: 'Infatuation' },
      stackingGroup: 'condition-damage-roll',
      reasonCode: 'damage.infatuation-roll-modifier',
      operation: 'add',
      value: infatuation.damageRollModifier,
    })
  }
  for (const field of fieldContributions) {
    modifiers.push({
      id: field.id,
      stage: 'pre-type-modifiers',
      priority: 200,
      source: { kind: field.sourceKind, id: field.sourceId },
      stackingGroup: field.stackingGroup,
      reasonCode: field.reasonCode,
      operation: 'add',
      value: field.value,
    })
  }
  modifiers.push({
    id: smiteMiss ? 'damage.smite-miss-effectiveness' : 'damage.type-effectiveness',
    stage: 'type-effectiveness',
    priority: 0,
    source: smiteMiss
      ? { kind: 'rules', id: 'ptu.smite' }
      : { kind: 'type', id: `${resolvedMoveType}:${target.id}` },
    stackingGroup: 'type-effectiveness',
    reasonCode: smiteMiss
      ? 'damage.smite-miss-resistance-step'
      : 'damage.type-effectiveness',
    operation: 'multiply-floor',
    value: multiplier,
  })
  if (criticalApplied) {
    modifiers.push({
      id: 'damage.critical-roll',
      stage: 'critical-modifiers',
      priority: 0,
      source: moveSource,
      stackingGroup: 'critical-damage-roll',
      reasonCode: 'damage.critical-hit-roll',
      operation: 'add-before-type',
      value: criticalDamageBonus,
    })
  }
  modifiers.push(
    ...(resolvedDamage.additionalModifiers ?? []),
    {
      id: 'damage.minimum',
      stage: 'minimum-damage',
      priority: 100_000,
      source: { kind: 'rules', id: 'ptu.minimum-damage' },
      stackingGroup: 'minimum-damage',
      reasonCode: 'damage.minimum-one',
      operation: 'floor-at-least',
      value: 1,
    },
    {
      id: 'damage.final-non-negative',
      stage: 'final-hp-loss',
      priority: 99_998,
      source: { kind: 'rules', id: 'ptu.final-hp-loss' },
      stackingGroup: 'final-hp-loss',
      reasonCode: 'damage.final-non-negative',
      operation: 'floor-at-least',
      value: 0,
    },
    {
      id: 'damage.final-floor',
      stage: 'final-hp-loss',
      priority: 99_999,
      source: { kind: 'rules', id: 'ptu.final-hp-loss' },
      stackingGroup: 'final-hp-loss',
      reasonCode: 'damage.final-floor',
      operation: 'floor',
    },
  )
  const pipeline = resolveMoveDamagePipeline({
    damageBase: resolvedDamage.damageBase ?? script.damageBase,
    modifiers,
  })
  const terms: MoveAutomationDamageBreakdownTerm[] = [
    damageTerm(baseRollTotal, 'roll'),
  ]
  if (criticalDamageBonus !== 0) terms.push(damageTerm(criticalDamageBonus, 'critical'))
  if (conditionRollModifier !== 0) terms.push(damageTerm(conditionRollModifier, 'conditions'))
  if (infatuation.damageRollModifier !== 0) terms.push(damageTerm(infatuation.damageRollModifier, 'Infatuation'))
  terms.push(damageTerm(
    offense,
    resolvedStats.attackStat?.label ?? (physical ? 'Atk' : 'Sp.Atk'),
  ))
  for (const field of fieldContributions) terms.push(damageTerm(field.value, field.label))
  terms.push({
    operator: 'subtract',
    amount: defense,
    label: resolvedStats.defenseStat?.label ?? (physical ? 'Def' : 'Sp.Def'),
  })

  return {
    kind: 'standard',
    hpLoss: pipeline.hpLoss,
    terms,
    multiplier,
    multiplierLabel: formatMultiplier(multiplier),
    scaledDamage: pipeline.postModifierDamage,
    minimumDamageApplied: pipeline.minimumDamageApplied,
    critical: criticalApplied,
    pipeline,
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
