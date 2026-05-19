import { clampCombatStage } from '~/utils/combatStages'
import {
  conditionAccuracyModifier,
  conditionAdjustedEvasion,
  evasionSuppressedByCondition,
  speedEvasionSuppressedByCondition,
} from '~/utils/sheetConditionEffects'
import { heldItemsAccuracyRollBonus } from '~/utils/sheetHeldItemEffects'
import { resolveMoveAutomationHitChancePercent } from '~/utils/moveAutomationResolution'
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
}

type MoveAutomationEvasionStatStageKey = Extract<CombatStatStageKey, 'def' | 'sdef' | 'spd'>

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

const physicalEvasion = (target: SpawnedPokemon): MoveAutomationEvasionCandidate => ({
  kind: 'physical',
  label: 'Physical Evasion',
  value: evasionForStat(target, 'def', target.def, target.combatStages.def, target.evasion?.physical),
})

const specialEvasion = (target: SpawnedPokemon): MoveAutomationEvasionCandidate => ({
  kind: 'special',
  label: 'Special Evasion',
  value: evasionForStat(target, 'sdef', target.sdef, target.combatStages.sdef, target.evasion?.special),
})

const speedEvasion = (target: SpawnedPokemon): MoveAutomationEvasionCandidate => ({
  kind: 'speed',
  label: 'Speed Evasion',
  value: evasionForStat(target, 'spd', target.spd ?? 0, target.combatStages.spd, target.evasion?.speed),
})

export const moveAutomationEvasionCandidates = (
  script: MoveAutomationScript | null | undefined,
  target: SpawnedPokemon,
): MoveAutomationEvasionCandidate[] => {
  if (evasionSuppressedByCondition(target.conditions)) return []

  const candidates: MoveAutomationEvasionCandidate[] = []
  if (script?.damageClass === 'Physical') candidates.push(physicalEvasion(target))
  else if (script?.damageClass === 'Special') candidates.push(specialEvasion(target))

  if (!speedEvasionSuppressedByCondition(target.conditions)) candidates.push(speedEvasion(target))
  return candidates
}

export const resolveMoveAutomationTargetEvasion = (
  script: MoveAutomationScript | null | undefined,
  target: SpawnedPokemon,
): MoveAutomationEvasionResolution => {
  const suppressedByCondition = evasionSuppressedByCondition(target.conditions)
  if (suppressedByCondition) {
    return {
      value: 0,
      label: `No Evasion (${suppressedByCondition})`,
      candidates: [],
      suppressedByCondition,
    }
  }

  const candidates = moveAutomationEvasionCandidates(script, target)
  const best = candidates.reduce<MoveAutomationEvasionCandidate | null>((current, candidate) => {
    if (!current || candidate.value > current.value) return candidate
    return current
  }, null)

  return {
    value: best?.value ?? 0,
    label: best ? best.label : 'No Evasion',
    candidates,
    suppressedByCondition: null,
  }
}

const moveAutomationHeldItemAccuracyBonus = (user: SpawnedPokemon): number =>
  user.sheetKind === 'pokemon' ? heldItemsAccuracyRollBonus(user.tokenItems) : 0

export const moveAutomationUserAccuracy = (user: SpawnedPokemon): number =>
  clampCombatStage(user.combatStages?.acc)
  + conditionAccuracyModifier(user.conditions)
  + moveAutomationHeldItemAccuracyBonus(user)

export const moveAutomationHitChanceTone = (percent: number): MoveAutomationHitChanceTone => {
  if (percent < 50) return 'low'
  if (percent < 80) return 'medium'
  return 'high'
}

const formatMoveAutomationHitChancePercent = (percent: number): string =>
  `${Number.isInteger(percent) ? percent.toString() : percent.toFixed(1)}%`

const signedAccuracyModifier = (value: number): string =>
  value > 0 ? `+${value}` : String(value)

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
  const targetEvasion = resolveMoveAutomationTargetEvasion(script, target)
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
