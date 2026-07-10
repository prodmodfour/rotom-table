import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterActionType,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { AuthoritativeMoveResolution } from '../resolveAuthoritativeMove'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import { deepCloneJson } from '~/utils/serialization'
import { observeEncounterMoveResources } from './reduceEncounterResources'

export interface PlannedMoveResourceObservation {
  readonly previousEncounterState: EncounterState
  readonly currentEncounterState: EncounterState
  readonly nextMap: TabletopMap
  readonly actionType: EncounterActionType
  readonly consumesReaction: boolean
  readonly movementBudget: number | null
  readonly movementSpent: number
  readonly oncePerTurnFlagId: string
}

const actionTypeFromMoveRange = (range: string): EncounterActionType => {
  if (/\bFull Action\b/i.test(range)) return 'full'
  if (/\bSwift Action\b/i.test(range)) return 'swift'
  if (/\bShift Action\b/i.test(range)) return 'shift'
  if (/\bFree Action\b/i.test(range)) return 'free'
  if (/\bReaction\b/i.test(range)) return 'reaction'
  if (/\bInterrupt\b/i.test(range)) return 'interrupt'
  return 'standard'
}

const usesReactionTiming = (range: string): boolean => (
  /\b(?:Interrupt|Reaction)\b/i.test(range)
)

const boundedMovementBudget = (token: SpawnedPokemon): number | null => {
  const budget = token.movementCapabilities?.overland
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0) return null
  return Math.floor(budget)
}

const movementSpent = (resolution: AuthoritativeMoveResolution): number => {
  const movement = resolution.movement
  if (!movement) return 0
  return ptuGridVectorDistance({
    x: movement.destination.x - movement.from.x,
    y: movement.destination.y - movement.from.y,
    z: movement.destination.z - movement.from.z,
  })
}

const resourceTurn = (
  state: EncounterState,
  actorPlacementId: string,
): number | null => state.history.currentTurn?.placementId === actorPlacementId
  ? state.history.currentTurn.turn
  : null

/**
 * Observe an accepted immediate move in the map-owned action ledger.
 *
 * This phase records declared action type, reaction timing, Pass movement, and
 * a stable per-turn move-use flag. It intentionally does not reject overspend;
 * MA-124 adds canonical cost enforcement after movement authority exists.
 */
export const planMoveResourceObservation = (input: {
  readonly map: TabletopMap
  readonly actor: SpawnedPokemon
  readonly resolution: AuthoritativeMoveResolution
  readonly sourceOperationId: string
}): PlannedMoveResourceObservation => {
  const previousEncounterState = parseEncounterState(
    input.map.encounterState ?? createEmptyEncounterState(),
  )
  const actionType = actionTypeFromMoveRange(input.resolution.script.range)
  const consumesReaction = usesReactionTiming(input.resolution.script.range)
  const movementBudget = boundedMovementBudget(input.actor)
  const spent = movementSpent(input.resolution)
  const oncePerTurnFlagId = `move.${input.resolution.moveKey}`
  const turnResources = observeEncounterMoveResources(
    previousEncounterState.turnResources,
    {
      placementId: input.resolution.actorPlacementId,
      actionType,
      consumesReaction,
      movementBudget,
      movementSpent: spent,
      oncePerTurnFlagId,
      sourceOperationId: input.sourceOperationId,
      round: input.map.initiative?.round ?? null,
      turn: resourceTurn(previousEncounterState, input.resolution.actorPlacementId),
    },
  )
  const currentEncounterState = parseEncounterState({
    ...previousEncounterState,
    turnResources,
  })

  return Object.freeze({
    previousEncounterState: deepCloneJson(previousEncounterState),
    currentEncounterState: deepCloneJson(currentEncounterState),
    nextMap: {
      ...deepCloneJson(input.map),
      encounterState: deepCloneJson(currentEncounterState),
    },
    actionType,
    consumesReaction,
    movementBudget,
    movementSpent: spent,
    oncePerTurnFlagId,
  })
}
