import type { TrainerSheet } from '~/types/trainerSheet'
import { conditionByName, normalizeConditionName } from '~/utils/statusConditions'
import { resolvedSheetEdgeInstances, sheetHasCanonicalEdge } from '#shared/edgeAutomation/sheetEdges'
import { edgeChoiceValues } from '#shared/edgeAutomation/instances'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'

export const trainerBadMoodCriticalRangeBonus = (
  sheet: TrainerSheet,
  conditions: readonly string[],
): number => {
  if (!sheetHasCanonicalEdge(sheet, 'trainer', 'Bad Mood')) return 0
  let persistent = false
  let volatile = false
  for (const raw of conditions) {
    const canonical = normalizeConditionName(raw)
    const category = canonical ? conditionByName.get(canonical)?.category : null
    if (category === 'Persistent Affliction') persistent = true
    if (category === 'Volatile Affliction') volatile = true
  }
  return Number(persistent) + Number(volatile)
}

export const trainerStaminaTemporaryHp = (sheet: TrainerSheet): number => {
  if (!sheetHasCanonicalEdge(sheet, 'trainer', 'Stamina')) return 0
  const ranks = new Map(resolveTrainerSkills(sheet).map(skill => [skill.key, skill.rankValue]))
  return Math.max(ranks.get('athletics') ?? 0, ranks.get('combat') ?? 0)
}

export interface TrainerEdgeManeuverProjection {
  readonly checkBonus: number
  readonly usageConsumedOn: 'attempt' | 'success'
  readonly defenseSkill: 'default' | 'stealth'
  readonly grappleWinOutcome: 'normal-choice' | 'end-grapple-only'
  readonly disengageDistance: number
  readonly standFromTrippedAction: 'shift' | 'swift'
}

export const resolveTrainerEdgeManeuverProjection = (
  sheet: TrainerSheet,
  maneuver: 'dirty-trick' | 'manipulate' | 'grapple' | 'push' | 'trip' | 'disengage' | 'stand',
  defending = false,
): TrainerEdgeManeuverProjection => {
  const trickster = maneuver === 'dirty-trick' && sheetHasCanonicalEdge(sheet, 'trainer', 'Expert Trickster')
  const manipulator = maneuver === 'manipulate' && sheetHasCanonicalEdge(sheet, 'trainer', 'Expert Manipulator')
  const slippery = defending && ['grapple', 'push', 'trip'].includes(maneuver)
    && sheetHasCanonicalEdge(sheet, 'trainer', 'Slippery')
  return Object.freeze({
    checkBonus: trickster || manipulator ? 2 : 0,
    usageConsumedOn: trickster || manipulator ? 'success' : 'attempt',
    defenseSkill: slippery ? 'stealth' : 'default',
    grappleWinOutcome: slippery && maneuver === 'grapple' ? 'end-grapple-only' : 'normal-choice',
    disengageDistance: maneuver === 'disengage' && sheetHasCanonicalEdge(sheet, 'trainer', 'Nimble Movement') ? 2 : 1,
    standFromTrippedAction: maneuver === 'stand' && sheetHasCanonicalEdge(sheet, 'trainer', 'Kip Up') ? 'swift' : 'shift',
  })
}

export interface TrainerEdgeDefenseProjection {
  readonly evasionBonus: number
  readonly saveBonus: number
  readonly restorativeTargetForfeitsNextTurn: boolean
}

export const resolveTrainerEdgeDefenseProjection = (input: {
  readonly sheet: TrainerSheet
  readonly moveKeywords?: readonly string[]
  readonly saveCondition?: string | null
  readonly restorativeItemUsedOnOther?: boolean
}): TrainerEdgeDefenseProjection => {
  const smooth = sheetHasCanonicalEdge(input.sheet, 'trainer', 'Smooth')
  const social = (input.moveKeywords ?? []).some(keyword => normalized(keyword) === 'social')
  const save = normalized(input.saveCondition ?? '')
  return Object.freeze({
    evasionBonus: smooth && social ? 4 : 0,
    saveBonus: smooth && (save === 'rage' || save === 'infatuation') ? 2 : 0,
    restorativeTargetForfeitsNextTurn: Boolean(input.restorativeItemUsedOnOther)
      && !sheetHasCanonicalEdge(input.sheet, 'trainer', 'Medic Training'),
  })
}

export interface TrainerWeaponOfChoiceProjection {
  readonly opposedDisarmBonus: number
  readonly mayPreventDisarmForAp: boolean
  readonly apCost: number | null
  readonly sourceInstanceId: string | null
}

const normalized = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')

export const resolveTrainerWeaponOfChoice = (
  sheet: TrainerSheet,
  wieldedWeaponType: string,
): TrainerWeaponOfChoiceProjection => {
  const instance = resolvedSheetEdgeInstances(sheet, 'trainer').find(candidate => (
    candidate.canonicalId === 'Weapon of Choice'
    && edgeChoiceValues(candidate, 'weapon')
      .some(value => normalized(value) === normalized(wieldedWeaponType))
  ))
  return Object.freeze({
    opposedDisarmBonus: instance ? 2 : 0,
    mayPreventDisarmForAp: Boolean(instance),
    apCost: instance ? 1 : null,
    sourceInstanceId: instance?.instanceId ?? null,
  })
}

export interface TrainerEdgeMoveHitTriggers {
  readonly applyVulnerable: boolean
  readonly volatileSavePenalty: number
  readonly volatileSavePenaltyRounds: number
}

export const trainerEdgeMoveHitTriggers = (input: {
  readonly sheet: TrainerSheet
  readonly criticalHit: boolean
  readonly statusMoveNaturalRoll?: number | null
  readonly moveKeywords?: readonly string[]
  readonly hit: boolean
}): TrainerEdgeMoveHitTriggers => {
  const demoralize = sheetHasCanonicalEdge(input.sheet, 'trainer', 'Demoralize')
    && (input.criticalHit || (input.statusMoveNaturalRoll ?? 0) >= 19)
  const flustering = input.hit
    && (input.moveKeywords ?? []).some(keyword => normalized(keyword) === 'social')
    && sheetHasCanonicalEdge(input.sheet, 'trainer', 'Flustering Charisma')
  return Object.freeze({
    applyVulnerable: demoralize,
    volatileSavePenalty: flustering ? -2 : 0,
    volatileSavePenaltyRounds: flustering ? 1 : 0,
  })
}
