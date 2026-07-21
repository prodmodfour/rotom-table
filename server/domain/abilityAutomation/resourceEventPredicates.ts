import type {
  AbilityFieldEncounterEvent,
  AbilityItemEncounterEvent,
} from '#shared/abilityAutomation/events'
import type { AbilitySpecJsonObject } from '#shared/abilityAutomation/spec'
import {
  ABILITY_ITEM_EVENT_PREDICATE_KIND,
  parseAbilityItemEventPredicate,
  type AbilityItemEventPredicate,
} from '#shared/abilityAutomation/itemEventPredicates'
import {
  ABILITY_FIELD_EVENT_PREDICATE_KIND,
  parseAbilityFieldEventPredicate,
  type AbilityFieldEventPredicate,
} from '#shared/abilityAutomation/fieldEventPredicates'
import type {
  AbilitySubscriptionPredicateContext,
  AbilitySubscriptionPredicateEvaluator,
} from './subscriptionRouter'

const sourceRelationMatches = (
  sourcePlacementId: string | null,
  ownerPlacementId: string,
  relation: 'any' | 'owner' | 'other' | 'none',
): boolean => relation === 'any'
  || (relation === 'owner' && sourcePlacementId === ownerPlacementId)
  || (relation === 'other' && sourcePlacementId !== null && sourcePlacementId !== ownerPlacementId)
  || (relation === 'none' && sourcePlacementId === null)

export const evaluateAbilityItemEventPredicate = (input: {
  readonly event: AbilityItemEncounterEvent
  readonly ownerPlacementId: string
  readonly predicate: AbilityItemEventPredicate
}): boolean => {
  const item = input.event.payload
  const before = item.ownerIdBefore === input.ownerPlacementId
  const after = item.ownerIdAfter === input.ownerPlacementId
  return (input.predicate.changes.length === 0 || input.predicate.changes.includes(item.change))
    && (input.predicate.outcomes.length === 0 || input.predicate.outcomes.includes(item.outcome))
    && (input.predicate.resourceKinds.length === 0
      || input.predicate.resourceKinds.includes(item.resourceKind))
    && (input.predicate.itemIds.length === 0 || input.predicate.itemIds.includes(item.itemId))
    && (input.predicate.ownerRole === 'owner-before' ? before
      : input.predicate.ownerRole === 'owner-after' ? after
        : input.predicate.ownerRole === 'either' ? before || after
          : !before && !after)
    && sourceRelationMatches(
      item.sourcePlacementId,
      input.ownerPlacementId,
      input.predicate.sourceRelation,
    )
    && (input.predicate.minimumQuantityApplied === null
      || item.quantityApplied >= input.predicate.minimumQuantityApplied)
}

export const evaluateAbilityFieldEventPredicate = (input: {
  readonly event: AbilityFieldEncounterEvent
  readonly ownerPlacementId: string
  readonly predicate: AbilityFieldEventPredicate
}): boolean => {
  const field = input.event.payload
  return (input.predicate.fieldKinds.length === 0
      || input.predicate.fieldKinds.includes(field.fieldKind))
    && (input.predicate.changes.length === 0 || input.predicate.changes.includes(field.change))
    && (input.predicate.outcomes.length === 0 || input.predicate.outcomes.includes(field.outcome))
    && (input.predicate.fieldIds.length === 0 || input.predicate.fieldIds.includes(field.fieldId))
    && sourceRelationMatches(
      field.sourcePlacementId,
      input.ownerPlacementId,
      input.predicate.sourceRelation,
    )
    && (input.predicate.resultingPresence === 'any'
      || (input.predicate.resultingPresence === 'present') === field.presentAfter)
    && (input.predicate.minimumLayerAfter === null
      || field.layerAfter >= input.predicate.minimumLayerAfter)
}

export const ABILITY_ITEM_EVENT_PREDICATE_EVALUATOR: AbilitySubscriptionPredicateEvaluator = Object.freeze({
  kind: ABILITY_ITEM_EVENT_PREDICATE_KIND,
  version: 1,
  evaluate: (context: Readonly<AbilitySubscriptionPredicateContext>, value: AbilitySpecJsonObject) => (
    context.event.kind === 'item' && evaluateAbilityItemEventPredicate({
      event: context.event,
      ownerPlacementId: context.ownerPlacementId,
      predicate: parseAbilityItemEventPredicate(value),
    })
  ),
})

export const ABILITY_FIELD_EVENT_PREDICATE_EVALUATOR: AbilitySubscriptionPredicateEvaluator = Object.freeze({
  kind: ABILITY_FIELD_EVENT_PREDICATE_KIND,
  version: 1,
  evaluate: (context: Readonly<AbilitySubscriptionPredicateContext>, value: AbilitySpecJsonObject) => (
    context.event.kind === 'field' && evaluateAbilityFieldEventPredicate({
      event: context.event,
      ownerPlacementId: context.ownerPlacementId,
      predicate: parseAbilityFieldEventPredicate(value),
    })
  ),
})
