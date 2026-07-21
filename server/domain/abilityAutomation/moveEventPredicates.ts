import {
  ABILITY_MOVE_EVENT_PREDICATE_KIND,
  parseAbilityMoveEventPredicate,
  type AbilityMoveEventPredicate,
} from '#shared/abilityAutomation/moveEventPredicates'
import type { AbilityMoveEncounterEvent } from '#shared/abilityAutomation/events'
import type { AbilitySpecJsonObject } from '#shared/abilityAutomation/spec'
import type {
  AbilitySubscriptionPredicateContext,
  AbilitySubscriptionPredicateEvaluator,
} from './subscriptionRouter'

const targetMatches = (
  event: AbilityMoveEncounterEvent,
  ownerPlacementId: string,
  relation: AbilityMoveEventPredicate['targetRelation'],
): boolean => {
  if (relation === 'any') return true
  if (relation === 'declared') return event.payload.declaredTargetIds.includes(ownerPlacementId)
  if (relation === 'attacked') return event.payload.attackedTargetIds.includes(ownerPlacementId)
  if (relation === 'hit') return event.payload.hitTargetIds.includes(ownerPlacementId)
  if (relation === 'missed') return event.payload.missedTargetIds.includes(ownerPlacementId)
  if (relation === 'critical') return event.payload.criticalTargetIds.includes(ownerPlacementId)
  return ![
    ...event.payload.declaredTargetIds,
    ...event.payload.attackedTargetIds,
    ...event.payload.hitTargetIds,
    ...event.payload.missedTargetIds,
    ...event.payload.criticalTargetIds,
  ].includes(ownerPlacementId)
}

export const evaluateAbilityMoveEventPredicate = (input: {
  readonly event: AbilityMoveEncounterEvent
  readonly ownerPlacementId: string
  readonly predicate: AbilityMoveEventPredicate
}): boolean => {
  const { event, predicate } = input
  if (predicate.timings.length > 0 && !predicate.timings.includes(event.payload.timing)) return false
  if (predicate.moveTypes.length > 0 && !predicate.moveTypes.includes(event.payload.moveType)) return false
  if (predicate.damageClasses.length > 0
    && !predicate.damageClasses.includes(event.payload.damageClass)) return false
  if (predicate.keywordsAny.length > 0
    && !predicate.keywordsAny.some(keyword => event.payload.keywords.includes(keyword))) return false
  if (!predicate.keywordsAll.every(keyword => event.payload.keywords.includes(keyword))) return false
  if (predicate.userRelation === 'owner' && event.payload.userPlacementId !== input.ownerPlacementId) return false
  if (predicate.userRelation === 'other' && event.payload.userPlacementId === input.ownerPlacementId) return false
  return targetMatches(event, input.ownerPlacementId, predicate.targetRelation)
}

export const ABILITY_MOVE_EVENT_PREDICATE_EVALUATOR: AbilitySubscriptionPredicateEvaluator = Object.freeze({
  kind: ABILITY_MOVE_EVENT_PREDICATE_KIND,
  version: 1,
  evaluate: (
    context: Readonly<AbilitySubscriptionPredicateContext>,
    value: AbilitySpecJsonObject,
  ) => context.event.kind === 'move' && evaluateAbilityMoveEventPredicate({
    event: context.event,
    ownerPlacementId: context.ownerPlacementId,
    predicate: parseAbilityMoveEventPredicate(value),
  }),
})
