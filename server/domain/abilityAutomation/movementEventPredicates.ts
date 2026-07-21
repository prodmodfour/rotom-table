import type { AbilityMovementEncounterEvent } from '#shared/abilityAutomation/events'
import type { AbilitySpecJsonObject } from '#shared/abilityAutomation/spec'
import {
  ABILITY_MOVEMENT_EVENT_PREDICATE_KIND,
  parseAbilityMovementEventPredicate,
  type AbilityMovementEventPredicate,
} from '#shared/abilityAutomation/movementEventPredicates'
import type {
  AbilitySubscriptionPredicateContext,
  AbilitySubscriptionPredicateEvaluator,
} from './subscriptionRouter'

export const evaluateAbilityMovementEventPredicate = (input: {
  readonly event: AbilityMovementEncounterEvent
  readonly ownerPlacementId: string
  readonly predicate: AbilityMovementEventPredicate
}): boolean => {
  const movement = input.event.payload
  const { predicate } = input
  if (predicate.checkpoints.length > 0 && !predicate.checkpoints.includes(movement.checkpoint)) return false
  if (predicate.modes.length > 0 && !predicate.modes.includes(movement.mode)) return false
  const mover = movement.placementId === input.ownerPlacementId
  const source = movement.sourcePlacementId === input.ownerPlacementId
  if (predicate.ownerRole === 'mover' && !mover) return false
  if (predicate.ownerRole === 'source' && !source) return false
  if (predicate.ownerRole === 'either' && !mover && !source) return false
  if (predicate.ownerRole === 'other' && (mover || source)) return false
  if (predicate.stepPosition === 'first' && movement.step !== 1) return false
  if (predicate.stepPosition === 'final' && movement.step !== movement.stepCount) return false
  if (predicate.grounding === 'grounded' && !movement.groundedAfter) return false
  if (predicate.grounding === 'airborne' && movement.groundedAfter) return false
  if (predicate.grounding === 'became-grounded'
    && (movement.groundedBefore || !movement.groundedAfter)) return false
  if (predicate.grounding === 'became-airborne'
    && (!movement.groundedBefore || movement.groundedAfter)) return false
  const adjacentBefore = movement.adjacentPlacementIdsBefore.includes(input.ownerPlacementId)
  const adjacentAfter = movement.adjacentPlacementIdsAfter.includes(input.ownerPlacementId)
  if (predicate.ownerAdjacency === 'present-before' && !adjacentBefore) return false
  if (predicate.ownerAdjacency === 'present-after' && !adjacentAfter) return false
  if (predicate.ownerAdjacency === 'gained' && (adjacentBefore || !adjacentAfter)) return false
  if (predicate.ownerAdjacency === 'lost' && (!adjacentBefore || adjacentAfter)) return false
  const beforeTerrain = new Set(movement.terrainIdsBefore)
  const afterTerrain = new Set(movement.terrainIdsAfter)
  const enteredTerrain = movement.terrainIdsAfter.some(id => !beforeTerrain.has(id))
  const exitedTerrain = movement.terrainIdsBefore.some(id => !afterTerrain.has(id))
  if (predicate.terrainChange === 'entered' && !enteredTerrain) return false
  if (predicate.terrainChange === 'exited' && !exitedTerrain) return false
  if (predicate.terrainChange === 'changed' && !enteredTerrain && !exitedTerrain) return false
  if (predicate.terrainChange === 'unchanged' && (enteredTerrain || exitedTerrain)) return false
  if ((predicate.zoneKinds.length > 0 || predicate.zoneTransitions.length > 0)
    && !movement.zoneTransitions.some(fact => (
      (predicate.zoneKinds.length === 0 || predicate.zoneKinds.includes(fact.zoneKind))
      && (predicate.zoneTransitions.length === 0
        || predicate.zoneTransitions.includes(fact.transition))
    ))) return false
  if (predicate.minimumStepDistance !== null
    && movement.distanceAfter - movement.distanceBefore < predicate.minimumStepDistance) return false
  return true
}

export const ABILITY_MOVEMENT_EVENT_PREDICATE_EVALUATOR: AbilitySubscriptionPredicateEvaluator = Object.freeze({
  kind: ABILITY_MOVEMENT_EVENT_PREDICATE_KIND,
  version: 1,
  evaluate: (context: Readonly<AbilitySubscriptionPredicateContext>, value: AbilitySpecJsonObject) => (
    context.event.kind === 'movement' && evaluateAbilityMovementEventPredicate({
      event: context.event,
      ownerPlacementId: context.ownerPlacementId,
      predicate: parseAbilityMovementEventPredicate(value),
    })
  ),
})
