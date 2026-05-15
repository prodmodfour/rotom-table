import { applyCombatStageToStat } from '~/utils/combatStageStats'
import { computeEvasionTotal, computeStatEvasion } from '~/utils/evasion'
import {
  conditionAccuracyModifier,
  evasionSuppressedByCondition,
  speedEvasionSuppressedByCondition,
} from '~/utils/sheetConditionEffects'
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

export const moveAutomationUserAccuracy = (user: SpawnedPokemon): number =>
  user.combatStages.acc + conditionAccuracyModifier(user.conditions)
