import { contestCatalog, contestEffectById } from './catalog'
import { explainContestTypeRelationship } from './typeRelationship'
import type { ContestEffectId, ContestStatId } from './ids'

export interface ContestAppealAssemblyInputV1 {
  readonly effectId: ContestEffectId
  readonly moveTypeId: ContestStatId
  readonly contestTypeId: ContestStatId
  readonly spentDice: number
  readonly startingVoltage: number
  readonly adjacentVoltages: readonly number[]
  readonly repeatedMove: boolean
  readonly baseMoveDiceMultiplier: number
  readonly alignmentSteps: number
  readonly sonic: boolean
  readonly voiceLessonsActive: boolean
  readonly acceptedInterventionBonusDice: number
}

export interface ContestAppealAssemblyV1 {
  readonly baseDice: number
  readonly relationship: ReturnType<typeof explainContestTypeRelationship>
  readonly voltageDice: number
  readonly voiceDice: number
  readonly interventionDice: number
  readonly assembledRaw: number
  readonly assembledDice: number
}

/** Pure canonical assembly shared by authoritative execution and offer previews. */
export const assembleContestAppeal = (input: ContestAppealAssemblyInputV1): ContestAppealAssemblyV1 => {
  const effect = contestEffectById.get(input.effectId)
  if (!effect) throw new Error(`Unknown canonical Contest effect ${input.effectId}.`)
  const startingVoltage = Math.max(0, Math.min(contestCatalog.performance.voltage.maximum, Math.floor(input.startingVoltage)))
  let relationship = explainContestTypeRelationship(input.moveTypeId, input.contestTypeId)
  for (let step = 0; step < Math.max(0, Math.min(1, Math.floor(input.alignmentSteps))); step += 1) relationship = relationship.relationship === 'opposed'
    ? Object.freeze({ relationship: 'allied' as const, dice: 0, explanation: 'Alignment improved from opposed to allied by an accepted intervention.' })
    : Object.freeze({ relationship: 'matching' as const, dice: 1, explanation: 'Alignment improved to matching by an accepted intervention.' })
  let baseDice = typeof effect.baseDice === 'number' ? effect.baseDice : 0
  if (input.effectId === 'double-time') baseDice = Math.max(0, input.adjacentVoltages.reduce((sum, value) => sum + Math.max(0, Math.floor(value)), 0) - Math.max(0, startingVoltage - 2))
  if (input.effectId === 'inversed-appeal') baseDice = Math.max(0, 5 - startingVoltage)
  if (input.effectId === 'reflective-appeal') baseDice = startingVoltage
  if (input.effectId === 'seen-nothing-yet') baseDice = startingVoltage * 2
  if (input.effectId === 'exhausting-act' && startingVoltage >= 2) baseDice += 2
  if (input.effectId === 'catching-up' && input.adjacentVoltages.every(value => value > startingVoltage)) baseDice += 3
  if (input.effectId === 'good-show' && input.adjacentVoltages.every(value => value < startingVoltage)) baseDice += 3
  if (input.effectId === 'reliable' && input.repeatedMove) baseDice += 1
  baseDice *= Math.max(1, Math.min(2, Math.floor(input.baseMoveDiceMultiplier)))
  const voltageDice = startingVoltage * contestCatalog.performance.voltage.startOfTurnBonusDicePerPoint
  const voiceDice = input.sonic && input.voiceLessonsActive ? 1 : 0
  const interventionDice = Math.max(0, Math.floor(input.acceptedInterventionBonusDice))
  const assembledRaw = baseDice + relationship.dice + Math.max(0, Math.floor(input.spentDice)) + voltageDice + voiceDice + interventionDice
  return Object.freeze({ baseDice, relationship, voltageDice, voiceDice, interventionDice, assembledRaw, assembledDice: Math.max(0, assembledRaw) })
}
