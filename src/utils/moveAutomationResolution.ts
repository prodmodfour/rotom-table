import { COMBAT_STAGE_KEYS } from '~/utils/combatStages'
import { rollDamageFormula } from '~/utils/moveAutomation'
import {
  defaultTargetResolutionState,
  moveAutomationSuggestionKey,
  type MoveAutomationSuggestionKind,
  type MoveAutomationTargetResolutionState,
} from '~/utils/moveAutomationTargetResolution'
import type { CombatStageKey } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'

export type MoveAutomationResolutionRecord = Record<string, MoveAutomationTargetResolutionState | undefined>
export type MoveAutomationSuggestionRecord = Record<string, boolean | undefined>
export type MoveAutomationHpSuggestionAmountRecord = Record<string, string | undefined>
export type MoveAutomationStageDeltaRecord = Record<CombatStageKey, number>

export interface MoveAutomationResetInput {
  script: MoveAutomationScript | null | undefined
  userId: string
  targetResolutions: MoveAutomationResolutionRecord
  enabledSuggestions: MoveAutomationSuggestionRecord
  hpSuggestionAmounts: MoveAutomationHpSuggestionAmountRecord
  manualUserStageDeltas: MoveAutomationStageDeltaRecord
  manualTargetStageDeltas: MoveAutomationStageDeltaRecord
}

export interface MoveAutomationAccuracyRollOptions {
  userAccuracy?: number
  targetEvasion?: number
}

export interface MoveAutomationAccuracyRollResult {
  accuracyRoll: string
  hit: boolean
  crit: boolean
  naturalRoll?: number
  modifiedRoll?: number
  accuracyCheck?: number | null
  userAccuracy?: number
  targetEvasion?: number
}

export const clearMutableRecord = (record: Record<string, unknown>): void => {
  for (const key of Object.keys(record)) delete record[key]
}

export const resetMoveAutomationStageDeltas = (record: MoveAutomationStageDeltaRecord): void => {
  for (const key of COMBAT_STAGE_KEYS) record[key] = 0
}

export const randomD20 = (random: () => number = Math.random): number => 1 + Math.floor(random() * 20)

export const resolveMoveAutomationAccuracyRoll = (
  script: MoveAutomationScript | null | undefined,
  roll: number,
  options?: MoveAutomationAccuracyRollOptions,
): MoveAutomationAccuracyRollResult => {
  const ac = script?.ac
  const hasContext = options?.userAccuracy != null || options?.targetEvasion != null
  const userAccuracy = options?.userAccuracy ?? 0
  const targetEvasion = options?.targetEvasion ?? 0
  const modifiedRoll = roll + userAccuracy
  const accuracyCheck = ac == null ? null : ac + targetEvasion
  const hit = ac == null
    ? true
    : roll === 20 || (roll !== 1 && modifiedRoll >= ac + targetEvasion)
  const criticalRange = script?.criticalRange ?? (script?.damaging ? 20 : null)
  const crit = Boolean(criticalRange && roll >= criticalRange)

  if (!hasContext) {
    return {
      accuracyRoll: String(roll),
      hit,
      crit,
    }
  }

  return {
    accuracyRoll: `${roll}${userAccuracy ? ` ${userAccuracy > 0 ? '+' : '-'} ${Math.abs(userAccuracy)}` : ''}`,
    hit,
    crit,
    naturalRoll: roll,
    modifiedRoll,
    accuracyCheck,
    userAccuracy,
    targetEvasion,
  }
}

export const ensureMoveAutomationTargetResolution = (
  targetResolutions: MoveAutomationResolutionRecord,
  id: string,
  script: MoveAutomationScript | null | undefined,
): MoveAutomationTargetResolutionState => {
  targetResolutions[id] ??= defaultTargetResolutionState(script)
  return targetResolutions[id]
}

export const syncMoveAutomationTargetResolutions = (
  targetResolutions: MoveAutomationResolutionRecord,
  targetIds: readonly string[],
  script: MoveAutomationScript | null | undefined,
): void => {
  for (const id of targetIds) ensureMoveAutomationTargetResolution(targetResolutions, id, script)
  for (const id of Object.keys(targetResolutions)) {
    if (!targetIds.includes(id)) delete targetResolutions[id]
  }
}

const enableSuggestions = (
  script: MoveAutomationScript,
  enabledSuggestions: MoveAutomationSuggestionRecord,
  kind: MoveAutomationSuggestionKind,
  count: number,
  isOptional: (index: number) => boolean | undefined,
): void => {
  for (let index = 0; index < count; index += 1) {
    enabledSuggestions[moveAutomationSuggestionKey(script, kind, index)] = !isOptional(index)
  }
}

export const populateDefaultMoveAutomationSuggestions = (
  script: MoveAutomationScript | null | undefined,
  enabledSuggestions: MoveAutomationSuggestionRecord,
): void => {
  if (!script) return
  enableSuggestions(script, enabledSuggestions, 'condition', script.conditionSuggestions.length, (index) => script.conditionSuggestions[index]?.optional)
  enableSuggestions(script, enabledSuggestions, 'stage', script.stageSuggestions.length, (index) => script.stageSuggestions[index]?.optional)
  enableSuggestions(script, enabledSuggestions, 'hp', script.hpSuggestions.length, (index) => script.hpSuggestions[index]?.optional)
  enableSuggestions(script, enabledSuggestions, 'field', script.fieldSuggestions.length, (index) => script.fieldSuggestions[index]?.optional)
  enableSuggestions(script, enabledSuggestions, 'hazard', script.hazardSuggestions.length, (index) => script.hazardSuggestions[index]?.optional)
}

export const resetMoveAutomationResolutionState = ({
  script,
  userId,
  targetResolutions,
  enabledSuggestions,
  hpSuggestionAmounts,
  manualUserStageDeltas,
  manualTargetStageDeltas,
}: MoveAutomationResetInput): string[] => {
  clearMutableRecord(targetResolutions)
  clearMutableRecord(enabledSuggestions)
  clearMutableRecord(hpSuggestionAmounts)
  resetMoveAutomationStageDeltas(manualUserStageDeltas)
  resetMoveAutomationStageDeltas(manualTargetStageDeltas)
  populateDefaultMoveAutomationSuggestions(script, enabledSuggestions)
  return script?.targetMode === 'self' ? [userId] : []
}

export const applyMoveAutomationAccuracyRoll = (
  targetResolutions: MoveAutomationResolutionRecord,
  id: string,
  script: MoveAutomationScript | null | undefined,
  roll: number = randomD20(),
  options?: MoveAutomationAccuracyRollOptions,
): MoveAutomationTargetResolutionState => {
  const state = ensureMoveAutomationTargetResolution(targetResolutions, id, script)
  const result = resolveMoveAutomationAccuracyRoll(script, roll, options)
  state.accuracyRoll = result.accuracyRoll
  state.hit = result.hit
  state.crit = result.crit
  return state
}

export const applyMoveAutomationDamageRoll = (
  targetResolutions: MoveAutomationResolutionRecord,
  id: string,
  script: MoveAutomationScript | null | undefined,
  formula: string | null | undefined,
): MoveAutomationTargetResolutionState | null => {
  if (!formula) return null
  const result = rollDamageFormula(formula)
  if (!result) return null
  const state = ensureMoveAutomationTargetResolution(targetResolutions, id, script)
  state.damageRoll = result
  return state
}

export const rollAllMoveAutomationTargets = (
  targetIds: readonly string[],
  script: MoveAutomationScript | null | undefined,
  targetResolutions: MoveAutomationResolutionRecord,
  damageFormula: string | null | undefined,
): void => {
  for (const id of targetIds) {
    if (script?.requiresAccuracy) applyMoveAutomationAccuracyRoll(targetResolutions, id, script)
    if (script?.damaging) applyMoveAutomationDamageRoll(targetResolutions, id, script, damageFormula)
  }
}
