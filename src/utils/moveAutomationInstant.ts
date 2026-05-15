import { buildMoveAutomationTransaction } from '~/utils/moveAutomationTransaction'
import { moveAutomationSuggestionKey } from '~/utils/moveAutomationTargetResolution'
import {
  randomD20,
  resolveMoveAutomationAccuracyRoll,
  type MoveAutomationAccuracyRollResult,
} from '~/utils/moveAutomationResolution'
import { rollDamageFormula } from '~/utils/moveAutomation'
import {
  moveAutomationUserAccuracy,
  resolveMoveAutomationTargetEvasion,
} from '~/utils/moveAutomationAccuracy'
import { moveAutomationConditionImmunitySource } from '~/utils/moveAutomationConditionImmunity'
import { normalizeConditionName } from '~/utils/statusConditions'
import type { CombatStageKey } from '~/types/combatStages'
import type { MapFieldEffects } from '~/types/map'
import type {
  MoveAutomationFeedbackCondition,
  MoveAutomationFeedbackState,
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export interface InstantMoveAutomationResult {
  transaction: MoveAutomationTransaction
  feedback: MoveAutomationFeedbackState
}

export interface ResolveInstantMoveAutomationInput {
  script: MoveAutomationScript
  user: SpawnedPokemon
  target: SpawnedPokemon
  damageFormula: string | null | undefined
  fieldEffects?: MapFieldEffects
  random?: () => number
  idFactory?: () => string
}

const emptyStageDeltas = (): Record<CombatStageKey, number> => ({
  atk: 0,
  def: 0,
  satk: 0,
  sdef: 0,
  spd: 0,
  acc: 0,
})

export const naturalRollMeetsMoveThreshold = (
  threshold: string | null | undefined,
  naturalRoll: number,
): boolean => {
  const value = threshold?.trim()
  if (!value) return true

  const plus = value.match(/^(\d{1,2})\+$/)
  if (plus) return naturalRoll >= Number(plus[1])

  const range = value.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/)
  if (range) {
    const start = Number(range[1])
    const end = Number(range[2])
    return naturalRoll >= Math.min(start, end) && naturalRoll <= Math.max(start, end)
  }

  if (/even roll/i.test(value)) return naturalRoll % 2 === 0
  return false
}

const feedbackId = (factory: (() => string) | undefined): string =>
  factory?.() ?? `move-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const buildConditionFeedback = (options: {
  script: MoveAutomationScript
  target: SpawnedPokemon
  naturalRoll: number
  hit: boolean
  enabledSuggestions: Record<string, boolean>
}): MoveAutomationFeedbackCondition[] => {
  const feedback: MoveAutomationFeedbackCondition[] = []

  options.script.conditionSuggestions.forEach((suggestion, index) => {
    if (suggestion.recipient !== 'target' || suggestion.action === 'remove' || suggestion.action === 'clear') return
    if (!naturalRollMeetsMoveThreshold(suggestion.threshold, options.naturalRoll)) return

    const condition = normalizeConditionName(suggestion.condition) ?? suggestion.condition
    const blockedBy = moveAutomationConditionImmunitySource(condition, options.target, options.script.type)
    const applied = options.hit && !blockedBy
    if (applied) options.enabledSuggestions[moveAutomationSuggestionKey(options.script, 'condition', index)] = true
    feedback.push({
      condition,
      applied,
      ...(blockedBy ? { blockedBy } : {}),
    })
  })

  return feedback
}

const addAccuracyToFeedback = (
  result: MoveAutomationAccuracyRollResult,
): Pick<MoveAutomationFeedbackState, 'modifiedRoll' | 'accuracyCheck' | 'userAccuracy' | 'targetEvasion'> => ({
  modifiedRoll: result.modifiedRoll ?? result.naturalRoll ?? 0,
  accuracyCheck: result.accuracyCheck ?? null,
  userAccuracy: result.userAccuracy ?? 0,
  targetEvasion: result.targetEvasion ?? 0,
})

export const resolveInstantMoveAutomation = ({
  script,
  user,
  target,
  damageFormula,
  fieldEffects,
  random,
  idFactory,
}: ResolveInstantMoveAutomationInput): InstantMoveAutomationResult => {
  const naturalRoll = randomD20(random)
  const targetEvasion = resolveMoveAutomationTargetEvasion(script, target)
  const userAccuracy = moveAutomationUserAccuracy(user)
  const accuracy = resolveMoveAutomationAccuracyRoll(script, naturalRoll, {
    userAccuracy,
    targetEvasion: targetEvasion.value,
  })
  const damageRoll = accuracy.hit && script.damaging && damageFormula
    ? rollDamageFormula(damageFormula, random)
    : null
  const targetResolutions = {
    [target.id]: {
      accuracyRoll: accuracy.accuracyRoll,
      hit: accuracy.hit,
      crit: accuracy.crit,
      damageRoll,
      manualHpLoss: '',
      applyDamage: true,
    },
  }
  const enabledSuggestions: Record<string, boolean> = {}
  const conditions = buildConditionFeedback({
    script,
    target,
    naturalRoll,
    hit: accuracy.hit,
    enabledSuggestions,
  })

  const transaction = buildMoveAutomationTransaction({
    script,
    user,
    selectedTargets: [target],
    targetResolutions,
    enabledSuggestions,
    hpSuggestionAmounts: {},
    manualUserConditions: [],
    manualTargetConditions: [],
    manualUserStageDeltas: emptyStageDeltas(),
    manualTargetStageDeltas: emptyStageDeltas(),
    hazardCells: [],
    manualNote: accuracy.hit
      ? conditions
        .filter((condition) => condition.blockedBy)
        .map((condition) => `${condition.condition} did not apply to ${target.species}: immune (${condition.blockedBy}).`)
        .join(' ')
      : '',
    fieldEffects,
  })
  const targetHpUpdate = transaction.hpUpdates.find((update) => update.id === target.id)
  const damageLoss = targetHpUpdate
    ? Math.max(0, target.currentHp - targetHpUpdate.currentHp)
    : 0

  return {
    transaction,
    feedback: {
      id: feedbackId(idFactory),
      userId: user.id,
      targetId: target.id,
      moveName: script.moveName,
      phase: 'rolling',
      naturalRoll,
      ...addAccuracyToFeedback(accuracy),
      targetEvasionLabel: targetEvasion.label,
      hit: accuracy.hit,
      crit: accuracy.crit,
      damageLoss,
      conditions,
    },
  }
}
