import type {
  AbilityInitiativeEncounterEvent,
  AbilityLifecycleEncounterEvent,
  AbilityPresenceEncounterEvent,
} from '#shared/abilityAutomation/events'
import type { AbilitySpecJsonObject } from '#shared/abilityAutomation/spec'
import {
  ABILITY_PRESENCE_EVENT_PREDICATE_KIND,
  parseAbilityPresenceEventPredicate,
  type AbilityPresenceEventPredicate,
} from '#shared/abilityAutomation/presenceEventPredicates'
import {
  ABILITY_INITIATIVE_EVENT_PREDICATE_KIND,
  parseAbilityInitiativeEventPredicate,
  type AbilityInitiativeEventPredicate,
} from '#shared/abilityAutomation/initiativeEventPredicates'
import {
  ABILITY_LIFECYCLE_EVENT_PREDICATE_KIND,
  parseAbilityLifecycleEventPredicate,
  type AbilityLifecycleEventPredicate,
} from '#shared/abilityAutomation/lifecycleEventPredicates'
import type {
  AbilitySubscriptionPredicateContext,
  AbilitySubscriptionPredicateEvaluator,
} from './subscriptionRouter'

export const evaluateAbilityPresenceEventPredicate = (input: {
  readonly event: AbilityPresenceEncounterEvent
  readonly ownerPlacementId: string
  readonly predicate: AbilityPresenceEventPredicate
}): boolean => {
  const presence = input.event.payload
  const outgoing = presence.outgoingPlacementId === input.ownerPlacementId
  const incoming = presence.incomingPlacementId === input.ownerPlacementId
  return (input.predicate.operations.length === 0
      || input.predicate.operations.includes(presence.operation))
    && (input.predicate.ownerRole === 'outgoing' ? outgoing
      : input.predicate.ownerRole === 'incoming' ? incoming
        : input.predicate.ownerRole === 'either' ? outgoing || incoming
          : !outgoing && !incoming)
    && (input.predicate.sideId === null || input.predicate.sideId === presence.sideId)
}

export const evaluateAbilityInitiativeEventPredicate = (input: {
  readonly event: AbilityInitiativeEncounterEvent
  readonly ownerPlacementId: string
  readonly predicate: AbilityInitiativeEventPredicate
}): boolean => {
  const initiative = input.event.payload
  const affected = initiative.placementId === input.ownerPlacementId
  const activeBefore = initiative.activePlacementIdBefore === input.ownerPlacementId
  const activeAfter = initiative.activePlacementIdAfter === input.ownerPlacementId
  if (input.predicate.changes.length > 0
    && !input.predicate.changes.includes(initiative.change)) return false
  if (input.predicate.ownerRole === 'affected' && !affected) return false
  if (input.predicate.ownerRole === 'active-before' && !activeBefore) return false
  if (input.predicate.ownerRole === 'active-after' && !activeAfter) return false
  if (input.predicate.ownerRole === 'either' && !affected && !activeBefore && !activeAfter) return false
  if (input.predicate.ownerRole === 'other' && (affected || activeBefore || activeAfter)) return false
  const beforeIndex = initiative.orderBefore.indexOf(input.ownerPlacementId)
  const afterIndex = initiative.orderAfter.indexOf(input.ownerPlacementId)
  if (input.predicate.ownerPosition === 'entered' && (beforeIndex >= 0 || afterIndex < 0)) return false
  if (input.predicate.ownerPosition === 'removed' && (beforeIndex < 0 || afterIndex >= 0)) return false
  if (input.predicate.ownerPosition === 'earlier'
    && (beforeIndex < 0 || afterIndex < 0 || afterIndex >= beforeIndex)) return false
  if (input.predicate.ownerPosition === 'later'
    && (beforeIndex < 0 || afterIndex < 0 || afterIndex <= beforeIndex)) return false
  if (input.predicate.ownerPosition === 'unchanged' && beforeIndex !== afterIndex) return false
  const turnAdvanced = initiative.roundAfter === initiative.roundBefore
    && initiative.turnAfter === initiative.turnBefore + 1
  const roundReset = initiative.roundAfter === initiative.roundBefore + 1
    && initiative.turnAfter === 0
  if (input.predicate.clock === 'turn-advanced' && !turnAdvanced) return false
  if (input.predicate.clock === 'round-reset' && !roundReset) return false
  if (input.predicate.clock === 'unchanged' && (turnAdvanced || roundReset)) return false
  return true
}

export const evaluateAbilityLifecycleEventPredicate = (input: {
  readonly event: AbilityLifecycleEncounterEvent
  readonly ownerPlacementId: string
  readonly predicate: AbilityLifecycleEventPredicate
}): boolean => {
  const lifecycle = input.event.payload
  if (input.predicate.boundaries.length > 0
    && !input.predicate.boundaries.includes(lifecycle.boundary)) return false
  if (input.predicate.transitions.length > 0
    && !input.predicate.transitions.includes(lifecycle.transition)) return false
  if (input.predicate.subjectRelation === 'owner'
    && lifecycle.subjectPlacementId !== input.ownerPlacementId) return false
  if (input.predicate.subjectRelation === 'other'
    && (lifecycle.subjectPlacementId === null
      || lifecycle.subjectPlacementId === input.ownerPlacementId)) return false
  if (input.predicate.subjectRelation === 'global' && lifecycle.subjectPlacementId !== null) return false
  if (input.predicate.minimumOrdinal !== null
    && (lifecycle.ordinal === null || lifecycle.ordinal < input.predicate.minimumOrdinal)) return false
  return true
}

export const ABILITY_PRESENCE_EVENT_PREDICATE_EVALUATOR: AbilitySubscriptionPredicateEvaluator = Object.freeze({
  kind: ABILITY_PRESENCE_EVENT_PREDICATE_KIND,
  version: 1,
  evaluate: (context: Readonly<AbilitySubscriptionPredicateContext>, value: AbilitySpecJsonObject) => (
    context.event.kind === 'presence' && evaluateAbilityPresenceEventPredicate({
      event: context.event,
      ownerPlacementId: context.ownerPlacementId,
      predicate: parseAbilityPresenceEventPredicate(value),
    })
  ),
})

export const ABILITY_INITIATIVE_EVENT_PREDICATE_EVALUATOR: AbilitySubscriptionPredicateEvaluator = Object.freeze({
  kind: ABILITY_INITIATIVE_EVENT_PREDICATE_KIND,
  version: 1,
  evaluate: (context: Readonly<AbilitySubscriptionPredicateContext>, value: AbilitySpecJsonObject) => (
    context.event.kind === 'initiative' && evaluateAbilityInitiativeEventPredicate({
      event: context.event,
      ownerPlacementId: context.ownerPlacementId,
      predicate: parseAbilityInitiativeEventPredicate(value),
    })
  ),
})

export const ABILITY_LIFECYCLE_EVENT_PREDICATE_EVALUATOR: AbilitySubscriptionPredicateEvaluator = Object.freeze({
  kind: ABILITY_LIFECYCLE_EVENT_PREDICATE_KIND,
  version: 1,
  evaluate: (context: Readonly<AbilitySubscriptionPredicateContext>, value: AbilitySpecJsonObject) => (
    context.event.kind === 'lifecycle' && evaluateAbilityLifecycleEventPredicate({
      event: context.event,
      ownerPlacementId: context.ownerPlacementId,
      predicate: parseAbilityLifecycleEventPredicate(value),
    })
  ),
})
