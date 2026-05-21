import {
  conditionAccuracyModifier,
  conditionAdjustedEvasion,
  evasionSuppressedByCondition,
  speedEvasionSuppressedByCondition,
} from '~/utils/sheetConditionEffects'
import { heldItemsAccuracyRollBonus } from '~/utils/sheetHeldItemEffects'
import {
  hasKeenEyeAbility,
  sheetAbilityAccuracyRollBonus,
  sheetAbilityAdjustedAccuracyStage,
  sheetAbilityIncomingAttackEvasionModifiers,
  type SheetAbilityIncomingAttackEvasionModifier,
} from '~/utils/sheetAbilityCombatModifiers'
import { resolveMoveAutomationHitChancePercent } from '~/utils/moveAutomationResolution'
import { pokemonTrainingFeatureAccuracyRollBonus } from '~/utils/sheets/pokemonTrainingFeatures'
import type { CombatStatStageKey } from '~/types/combatStages'
import type {
  MoveAutomationHitChanceTone,
  MoveAutomationScript,
  MoveAutomationTargetHitChance,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export type MoveAutomationEvasionKind = 'physical' | 'special' | 'speed'

export interface MoveAutomationEvasionCandidate {
  kind: MoveAutomationEvasionKind
  label: string
  value: number
}

export interface MoveAutomationEvasionResolution {
  value: number
  label: string
  candidates: MoveAutomationEvasionCandidate[]
  suppressedByCondition: string | null
  abilityModifier: number
  abilityModifiers: SheetAbilityIncomingAttackEvasionModifier[]
}

export interface MoveAutomationEvasionContext {
  attacker?: Pick<SpawnedPokemon, 'abilityNames'> | null
}

type MoveAutomationEvasionStatStageKey = Extract<CombatStatStageKey, 'def' | 'sdef' | 'spd'>

const signedAccuracyModifier = (value: number): string =>
  value > 0 ? `+${value}` : String(value)

const evasionLabelWithAbilityModifiers = (
  label: string,
  modifiers: readonly SheetAbilityIncomingAttackEvasionModifier[],
): string => {
  const entries = modifiers
    .filter((entry) => entry.modifier !== 0)
    .map((entry) => `${entry.source} ${signedAccuracyModifier(entry.modifier)}`)
  return entries.length ? `${label} (${entries.join(', ')})` : label
}

const moveAutomationTargetAbilityEvasionModifiers = (
  target: SpawnedPokemon,
  context: MoveAutomationEvasionContext,
): SheetAbilityIncomingAttackEvasionModifier[] => sheetAbilityIncomingAttackEvasionModifiers(
  target.abilityNames,
  { attackerAbilities: context.attacker?.abilityNames },
)

const sumAbilityEvasionModifiers = (
  modifiers: readonly SheetAbilityIncomingAttackEvasionModifier[],
): number => modifiers.reduce((sum, entry) => sum + entry.modifier, 0)

const finiteEvasionBonus = (value: number | null | undefined): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const attackerAdjustedEvasionBonus = (
  bonus: number | null | undefined,
  context: MoveAutomationEvasionContext,
): number => {
  const finiteBonus = finiteEvasionBonus(bonus)
  return hasKeenEyeAbility(context.attacker?.abilityNames) ? Math.min(0, finiteBonus) : finiteBonus
}

const evasionKindForStatStageKey = (key: MoveAutomationEvasionStatStageKey): MoveAutomationEvasionKind => {
  switch (key) {
    case 'def': return 'physical'
    case 'sdef': return 'special'
    case 'spd': return 'speed'
  }
}

const evasionForStat = (
  target: SpawnedPokemon,
  key: MoveAutomationEvasionStatStageKey,
  stat: number | null | undefined,
  stage: number | null | undefined,
  bonus: number | null | undefined,
): number => conditionAdjustedEvasion({
  statTotal: stat,
  combatStage: stage,
  bonus,
  conditions: target.conditions,
  abilities: target.abilityNames,
  statStageKey: key,
  kind: evasionKindForStatStageKey(key),
  applyCombatStages: true,
}).total

const physicalEvasion = (
  target: SpawnedPokemon,
  context: MoveAutomationEvasionContext,
): MoveAutomationEvasionCandidate => ({
  kind: 'physical',
  label: 'Physical Evasion',
  value: evasionForStat(target, 'def', target.def, target.combatStages.def, attackerAdjustedEvasionBonus(target.evasion?.physical, context)),
})

const specialEvasion = (
  target: SpawnedPokemon,
  context: MoveAutomationEvasionContext,
): MoveAutomationEvasionCandidate => ({
  kind: 'special',
  label: 'Special Evasion',
  value: evasionForStat(target, 'sdef', target.sdef, target.combatStages.sdef, attackerAdjustedEvasionBonus(target.evasion?.special, context)),
})

const speedEvasion = (
  target: SpawnedPokemon,
  context: MoveAutomationEvasionContext,
): MoveAutomationEvasionCandidate => ({
  kind: 'speed',
  label: 'Speed Evasion',
  value: evasionForStat(target, 'spd', target.spd ?? 0, target.combatStages.spd, attackerAdjustedEvasionBonus(target.evasion?.speed, context)),
})

export const moveAutomationEvasionCandidates = (
  script: MoveAutomationScript | null | undefined,
  target: SpawnedPokemon,
  context: MoveAutomationEvasionContext = {},
): MoveAutomationEvasionCandidate[] => {
  if (evasionSuppressedByCondition(target.conditions, { abilities: target.abilityNames })) return []

  const candidates: MoveAutomationEvasionCandidate[] = []
  if (script?.damageClass === 'Physical') candidates.push(physicalEvasion(target, context))
  else if (script?.damageClass === 'Special') candidates.push(specialEvasion(target, context))

  if (!speedEvasionSuppressedByCondition(target.conditions)) candidates.push(speedEvasion(target, context))
  return candidates
}

export const resolveMoveAutomationTargetEvasion = (
  script: MoveAutomationScript | null | undefined,
  target: SpawnedPokemon,
  context: MoveAutomationEvasionContext = {},
): MoveAutomationEvasionResolution => {
  const abilityModifiers = moveAutomationTargetAbilityEvasionModifiers(target, context)
  const abilityModifier = sumAbilityEvasionModifiers(abilityModifiers)
  const suppressedByCondition = evasionSuppressedByCondition(target.conditions, { abilities: target.abilityNames })
  if (suppressedByCondition) {
    const label = `No Evasion (${suppressedByCondition})`
    return {
      value: abilityModifier,
      label: evasionLabelWithAbilityModifiers(label, abilityModifiers),
      candidates: [],
      suppressedByCondition,
      abilityModifier,
      abilityModifiers,
    }
  }

  const candidates = moveAutomationEvasionCandidates(script, target, context)
  const best = candidates.reduce<MoveAutomationEvasionCandidate | null>((current, candidate) => {
    if (!current || candidate.value > current.value) return candidate
    return current
  }, null)
  const label = best ? best.label : 'No Evasion'

  return {
    value: (best?.value ?? 0) + abilityModifier,
    label: evasionLabelWithAbilityModifiers(label, abilityModifiers),
    candidates,
    suppressedByCondition: null,
    abilityModifier,
    abilityModifiers,
  }
}

const moveAutomationHeldItemAccuracyBonus = (user: SpawnedPokemon): number =>
  user.sheetKind === 'pokemon' ? heldItemsAccuracyRollBonus(user.tokenItems) : 0

export const moveAutomationUserAccuracy = (user: SpawnedPokemon): number =>
  sheetAbilityAdjustedAccuracyStage(user.combatStages?.acc, user.abilityNames)
  + conditionAccuracyModifier(user.conditions, { abilities: user.abilityNames })
  + moveAutomationHeldItemAccuracyBonus(user)
  + sheetAbilityAccuracyRollBonus(user.abilityNames)
  + (user.accuracyRollBonus ?? pokemonTrainingFeatureAccuracyRollBonus(user.activeTrainingFeature))

export const moveAutomationHitChanceTone = (percent: number): MoveAutomationHitChanceTone => {
  if (percent < 50) return 'low'
  if (percent < 80) return 'medium'
  return 'high'
}

const formatMoveAutomationHitChancePercent = (percent: number): string =>
  `${Number.isInteger(percent) ? percent.toString() : percent.toFixed(1)}%`

const moveAutomationHitChanceTitle = (options: {
  script: MoveAutomationScript
  percentLabel: string
  userAccuracy: number
  targetEvasion: MoveAutomationEvasionResolution
}): string => {
  if (!options.script.requiresAccuracy || options.script.ac == null) {
    return `${options.percentLabel} to hit. ${options.script.moveName} cannot miss.`
  }

  const doubleStrikeNote = options.script.dynamicDamageBase?.kind === 'double-strike'
    ? ' At least one of two Accuracy Rolls must hit.'
    : ''
  return `${options.percentLabel} to hit. AC ${options.script.ac} + ${options.targetEvasion.label} ${options.targetEvasion.value}; user Accuracy ${signedAccuracyModifier(options.userAccuracy)}.${doubleStrikeNote}`
}

export const moveAutomationTargetHitChance = (
  script: MoveAutomationScript,
  user: SpawnedPokemon,
  target: SpawnedPokemon,
): MoveAutomationTargetHitChance => {
  const userAccuracy = moveAutomationUserAccuracy(user)
  const targetEvasion = resolveMoveAutomationTargetEvasion(script, target, { attacker: user })
  const percent = resolveMoveAutomationHitChancePercent(script, {
    userAccuracy,
    targetEvasion: targetEvasion.value,
  })
  const label = formatMoveAutomationHitChancePercent(percent)
  return {
    targetId: target.id,
    percent,
    label,
    tone: moveAutomationHitChanceTone(percent),
    title: moveAutomationHitChanceTitle({ script, percentLabel: label, userAccuracy, targetEvasion }),
  }
}
