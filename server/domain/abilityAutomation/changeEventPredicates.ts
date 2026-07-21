import type {
  AbilityCombatStageEncounterEvent,
  AbilityConditionEncounterEvent,
  AbilityStatEncounterEvent,
} from '#shared/abilityAutomation/events'
import type { AbilitySpecJsonObject } from '#shared/abilityAutomation/spec'
import {
  ABILITY_CONDITION_EVENT_PREDICATE_KIND,
  parseAbilityConditionEventPredicate,
  type AbilityConditionEventPredicate,
} from '#shared/abilityAutomation/conditionEventPredicates'
import {
  ABILITY_VALUE_CHANGE_EVENT_PREDICATE_KIND,
  parseAbilityValueChangeEventPredicate,
  type AbilityValueChangeEventPredicate,
} from '#shared/abilityAutomation/changeEventPredicates'
import type {
  AbilitySubscriptionPredicateContext,
  AbilitySubscriptionPredicateEvaluator,
} from './subscriptionRouter'

const relationMatches = (
  sourcePlacementId: string | null,
  ownerPlacementId: string,
  relation: 'any' | 'owner' | 'other' | 'none',
): boolean => relation === 'any'
  || (relation === 'none' && sourcePlacementId === null)
  || (relation === 'owner' && sourcePlacementId === ownerPlacementId)
  || (relation === 'other' && sourcePlacementId !== null && sourcePlacementId !== ownerPlacementId)

const ownerMatches = (
  subjectPlacementId: string,
  actorPlacementId: string | null,
  ownerPlacementId: string,
  role: 'subject' | 'actor' | 'either' | 'other',
): boolean => {
  const subject = subjectPlacementId === ownerPlacementId
  const actor = actorPlacementId === ownerPlacementId
  return role === 'subject' ? subject
    : role === 'actor' ? actor
      : role === 'either' ? subject || actor
        : !subject && !actor
}

export const evaluateAbilityConditionEventPredicate = (input: {
  readonly event: AbilityConditionEncounterEvent
  readonly ownerPlacementId: string
  readonly predicate: AbilityConditionEventPredicate
}): boolean => {
  const { event, predicate } = input
  const condition = event.payload
  return (predicate.operations.length === 0 || predicate.operations.includes(condition.operation))
    && (predicate.outcomes.length === 0 || predicate.outcomes.includes(condition.outcome))
    && (predicate.conditionIds.length === 0 || predicate.conditionIds.includes(condition.conditionId))
    && ownerMatches(
      condition.placementId,
      event.actorPlacementId,
      input.ownerPlacementId,
      predicate.ownerRole,
    )
    && relationMatches(condition.sourcePlacementId, input.ownerPlacementId, predicate.sourceRelation)
    && (predicate.resultingState === 'any'
      || (predicate.resultingState === 'present') === condition.after)
    && (predicate.save === 'any'
      || (predicate.save === 'required') === (condition.saveRollId !== null))
}

export const evaluateAbilityValueChangeEventPredicate = (input: {
  readonly event: AbilityCombatStageEncounterEvent | AbilityStatEncounterEvent
  readonly ownerPlacementId: string
  readonly predicate: AbilityValueChangeEventPredicate
}): boolean => {
  const { event, predicate } = input
  if (predicate.eventKinds.length > 0 && !predicate.eventKinds.includes(event.kind)) return false
  if (event.kind === 'combat-stage') {
    if (predicate.combatStageStats.length > 0
      && !predicate.combatStageStats.includes(event.payload.stat)) return false
  }
  else {
    if (predicate.statKinds.length > 0 && !predicate.statKinds.includes(event.payload.stat)) return false
    if (predicate.statLayers.length > 0 && !predicate.statLayers.includes(event.payload.layer)) return false
  }
  const change = event.payload
  if (predicate.outcomes.length > 0 && !predicate.outcomes.includes(change.outcome)) return false
  if (!ownerMatches(change.placementId, event.actorPlacementId, input.ownerPlacementId, predicate.ownerRole)) {
    return false
  }
  if (!relationMatches(change.sourcePlacementId, input.ownerPlacementId, predicate.sourceRelation)) return false
  if (predicate.direction === 'raised' && change.appliedDelta <= 0) return false
  if (predicate.direction === 'lowered' && change.appliedDelta >= 0) return false
  if (predicate.direction === 'unchanged' && change.appliedDelta !== 0) return false
  if (predicate.minimumAbsoluteDelta !== null
    && Math.abs(change.appliedDelta) < predicate.minimumAbsoluteDelta) return false
  return true
}

export const ABILITY_CONDITION_EVENT_PREDICATE_EVALUATOR: AbilitySubscriptionPredicateEvaluator = Object.freeze({
  kind: ABILITY_CONDITION_EVENT_PREDICATE_KIND,
  version: 1,
  evaluate: (context: Readonly<AbilitySubscriptionPredicateContext>, value: AbilitySpecJsonObject) => (
    context.event.kind === 'condition' && evaluateAbilityConditionEventPredicate({
      event: context.event,
      ownerPlacementId: context.ownerPlacementId,
      predicate: parseAbilityConditionEventPredicate(value),
    })
  ),
})

export const ABILITY_VALUE_CHANGE_EVENT_PREDICATE_EVALUATOR: AbilitySubscriptionPredicateEvaluator = Object.freeze({
  kind: ABILITY_VALUE_CHANGE_EVENT_PREDICATE_KIND,
  version: 1,
  evaluate: (context: Readonly<AbilitySubscriptionPredicateContext>, value: AbilitySpecJsonObject) => (
    (context.event.kind === 'combat-stage' || context.event.kind === 'stat')
    && evaluateAbilityValueChangeEventPredicate({
      event: context.event,
      ownerPlacementId: context.ownerPlacementId,
      predicate: parseAbilityValueChangeEventPredicate(value),
    })
  ),
})
