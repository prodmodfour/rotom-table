import { createHash } from 'node:crypto'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
  type EncounterMoveCompletedEvent,
  type EncounterMoveDeclaredEvent,
  type EncounterMoveKoEvent,
} from '#shared/moveAutomation/events'
import {
  parseEncounterHistory,
  type EncounterHistory,
  type EncounterHistoryMoveOutcome,
} from '#shared/moveAutomation/encounterHistory'
import type {
  MoveHistoryBranchSelection,
  MoveHistoryIdentity,
  MoveHistoryMoveListSource,
  MoveHistoryOrigin,
} from '#shared/moveAutomation/moveHistoryMetadata'
import type { EncounterActionType } from '#shared/moveAutomation/encounterResources'
import { reduceEncounterHistoryEvent } from './reduceEncounterHistory'

const eventId = (operationId: string, suffix: string): string => `event.move.${createHash('sha256').update(`${operationId}\n${suffix}`).digest('hex').slice(0, 40)}`
const outcomeFor = (attacked: readonly string[], hit: readonly string[]): EncounterHistoryMoveOutcome => {
  if (attacked.length === 0) return 'no-target'
  if (hit.length === 0) return 'miss'
  return hit.length === attacked.length ? 'hit' : 'mixed'
}

export interface RecordAcceptedMoveHistoryInput {
  readonly history: EncounterHistory
  readonly round: number | null
  readonly operationId: string
  readonly resolutionId: string | null
  readonly actorPlacementId: string
  readonly canonicalMoveId: string
  readonly specVersion: number
  readonly actionType: EncounterActionType
  readonly origin: MoveHistoryOrigin
  readonly moveListSource: MoveHistoryMoveListSource
  readonly attackedTargetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  /** Server-observed positive-HP to zero-HP transitions caused by this accepted primary Move. */
  readonly knockoutTargetIds?: readonly string[]
  readonly branchSelections: readonly MoveHistoryBranchSelection[]
}

/**
 * Persist one source-operation-bound declaration/completion index for every
 * accepted primary Move. This is Encounter-owned history only; downstream
 * domains consume it as immutable typed fact authority.
 */
export const recordAcceptedMoveHistory = (input: RecordAcceptedMoveHistoryInput): EncounterHistory => {
  const resolutionId = input.resolutionId
    ?? `resolution.${createHash('sha256').update(input.operationId).digest('hex').slice(0, 40)}`
  const identity: MoveHistoryIdentity = {
    resolutionId,
    canonicalId: input.canonicalMoveId,
    specVersion: input.specVersion,
    actorPlacementId: input.actorPlacementId,
    actionType: input.actionType,
    origin: input.origin,
    moveListSource: input.moveListSource,
  }
  const declaredEventId = eventId(input.operationId, 'declared')
  const declared = parseEncounterEvent({
    schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
    eventId: declaredEventId,
    kind: 'move-declared',
    sourceOperationId: input.operationId,
    causalParentEventId: null,
    reasonCode: 'accepted-move.declared',
    move: identity,
    targetPlacementIds: input.attackedTargetIds,
  }) as EncounterMoveDeclaredEvent
  const outcome = outcomeFor(input.attackedTargetIds, input.hitTargetIds)
  const completed = parseEncounterEvent({
    schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
    eventId: eventId(input.operationId, 'completed'),
    kind: 'move-completed',
    sourceOperationId: input.operationId,
    causalParentEventId: declaredEventId,
    reasonCode: 'accepted-move.completed',
    move: identity,
    attackedTargetIds: input.attackedTargetIds,
    hitTargetIds: input.hitTargetIds,
    outcome,
    succeeded: outcome !== 'miss',
    branches: input.branchSelections,
  }) as EncounterMoveCompletedEvent
  const starting = parseEncounterHistory({
    ...parseEncounterHistory(input.history),
    currentRound: input.round,
  })
  // Apply only the typed history index reducer, never lifecycle trigger reducers.
  const declaredHistory = reduceEncounterHistoryEvent(starting, declared)
  const knockoutHistory = [...new Set(input.knockoutTargetIds ?? [])].reduce((history, targetPlacementId) => {
    const hitIndex = input.hitTargetIds.indexOf(targetPlacementId)
    const knockout = parseEncounterEvent({
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
      eventId: eventId(input.operationId, `knockout:${targetPlacementId}`),
      kind: 'move-ko',
      sourceOperationId: input.operationId,
      causalParentEventId: declaredEventId,
      reasonCode: 'accepted-move.knockout',
      move: identity,
      targetPlacementId,
      hitIndex: hitIndex >= 0 ? hitIndex + 1 : null,
    }) as EncounterMoveKoEvent
    return reduceEncounterHistoryEvent(history, knockout)
  }, declaredHistory)
  const completedHistory = reduceEncounterHistoryEvent(knockoutHistory, completed)
  // Existing resource/consecutive authorities remain sole mechanics owners;
  // this adds immutable accepted-result indexes without double-applying acted
  // or chain semantics that are already reduced elsewhere in the Move plan.
  return parseEncounterHistory({
    ...completedHistory,
    actedThisTurnPlacementIds: starting.actedThisTurnPlacementIds,
    actedThisRoundPlacementIds: starting.actedThisRoundPlacementIds,
    consecutiveMoves: starting.consecutiveMoves,
  })
}
