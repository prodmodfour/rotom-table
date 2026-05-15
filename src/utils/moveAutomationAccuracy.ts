import { applyCombatStageToStat } from '~/utils/combatStageStats'
import { computeEvasionTotal, computeStatEvasion } from '~/utils/evasion'
import { normalizeConditionNames } from '~/utils/statusConditions'
import type { MoveAutomationScript } from '~/types/moveAutomation'
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

const conditionSet = (target: SpawnedPokemon): Set<string> =>
  new Set(normalizeConditionNames(target.conditions))

const suppressesAllEvasion = (conditions: Set<string>): string | null => {
  for (const condition of ['Vulnerable', 'Sleep', 'Frozen']) {
    if (conditions.has(condition)) return condition
  }
  return null
}

const speedEvasionSuppressed = (conditions: Set<string>): boolean => conditions.has('Stuck')

const evasionForStat = (
  stat: number | null | undefined,
  stage: number | null | undefined,
  bonus: number | null | undefined,
): number => computeEvasionTotal(
  computeStatEvasion(applyCombatStageToStat(stat ?? 0, stage ?? 0)),
  bonus ?? 0,
)

const physicalEvasion = (target: SpawnedPokemon): MoveAutomationEvasionCandidate => ({
  kind: 'physical',
  label: 'Physical Evasion',
  value: evasionForStat(target.def, target.combatStages.def, target.evasion?.physical),
})

const specialEvasion = (target: SpawnedPokemon): MoveAutomationEvasionCandidate => ({
  kind: 'special',
  label: 'Special Evasion',
  value: evasionForStat(target.sdef, target.combatStages.sdef, target.evasion?.special),
})

const speedEvasion = (target: SpawnedPokemon): MoveAutomationEvasionCandidate => ({
  kind: 'speed',
  label: 'Speed Evasion',
  value: evasionForStat(target.spd ?? 0, target.combatStages.spd, target.evasion?.speed),
})

export const moveAutomationEvasionCandidates = (
  script: MoveAutomationScript | null | undefined,
  target: SpawnedPokemon,
): MoveAutomationEvasionCandidate[] => {
  const conditions = conditionSet(target)
  if (suppressesAllEvasion(conditions)) return []

  const candidates: MoveAutomationEvasionCandidate[] = []
  if (script?.damageClass === 'Physical') candidates.push(physicalEvasion(target))
  else if (script?.damageClass === 'Special') candidates.push(specialEvasion(target))

  if (!speedEvasionSuppressed(conditions)) candidates.push(speedEvasion(target))
  return candidates
}

export const resolveMoveAutomationTargetEvasion = (
  script: MoveAutomationScript | null | undefined,
  target: SpawnedPokemon,
): MoveAutomationEvasionResolution => {
  const conditions = conditionSet(target)
  const suppressedByCondition = suppressesAllEvasion(conditions)
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

const accuracyPenaltyFromConditions = (conditions: readonly string[]): number => {
  const normalized = new Set(normalizeConditionNames(conditions))
  if (normalized.has('Total Blindness')) return -10
  if (normalized.has('Blindness')) return -6
  return 0
}

export const moveAutomationUserAccuracy = (user: SpawnedPokemon): number =>
  user.combatStages.acc + accuracyPenaltyFromConditions(user.conditions)
