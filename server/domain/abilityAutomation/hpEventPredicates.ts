import type { AbilityHpEncounterEvent } from '#shared/abilityAutomation/events'
import type { AbilitySpecJsonObject } from '#shared/abilityAutomation/spec'
import {
  ABILITY_HP_EVENT_PREDICATE_KIND,
  parseAbilityHpEventPredicate,
  type AbilityHpEventPredicate,
} from '#shared/abilityAutomation/hpEventPredicates'
import type {
  AbilitySubscriptionPredicateContext,
  AbilitySubscriptionPredicateEvaluator,
} from './subscriptionRouter'

export const evaluateAbilityHpEventPredicate = (input: {
  readonly event: AbilityHpEncounterEvent
  readonly ownerPlacementId: string
  readonly predicate: AbilityHpEventPredicate
}): boolean => {
  const { event, predicate } = input
  const hp = event.payload
  if (predicate.changeKinds.length > 0 && !predicate.changeKinds.includes(hp.changeKind)) return false
  if (predicate.faintTransitions.length > 0
    && !predicate.faintTransitions.includes(hp.faintTransition)) return false
  const subject = hp.placementId === input.ownerPlacementId
  const actor = event.actorPlacementId === input.ownerPlacementId
  if (predicate.ownerRole === 'subject' && !subject) return false
  if (predicate.ownerRole === 'actor' && !actor) return false
  if (predicate.ownerRole === 'either' && !subject && !actor) return false
  if (predicate.ownerRole === 'other' && (subject || actor)) return false
  if (predicate.massiveDamage === 'required' && !hp.massiveDamage) return false
  if (predicate.massiveDamage === 'forbidden' && hp.massiveDamage) return false
  if (predicate.crossedZero === 'required' && !hp.crossedZero) return false
  if (predicate.crossedZero === 'forbidden' && hp.crossedZero) return false
  const injuryDirection = hp.injuriesAfter > hp.injuriesBefore
    ? 'increased'
    : hp.injuriesAfter < hp.injuriesBefore
      ? 'decreased'
      : 'unchanged'
  if (predicate.injuryChange !== 'any' && predicate.injuryChange !== injuryDirection) return false
  const temporaryDirection = hp.temporaryAfter > hp.temporaryBefore
    ? 'gained'
    : hp.temporaryAfter < hp.temporaryBefore
      ? 'lost'
      : 'unchanged'
  if (predicate.temporaryChange !== 'any' && predicate.temporaryChange !== temporaryDirection) return false
  if (predicate.hpThreshold === 'zero' && hp.after !== 0) return false
  if (predicate.hpThreshold === 'below-third' && hp.after * 3 >= hp.maximumAfter) return false
  if (predicate.hpThreshold === 'below-half' && hp.after * 2 >= hp.maximumAfter) return false
  if (predicate.hpThreshold === 'at-or-above-half' && hp.after * 2 < hp.maximumAfter) return false
  if (predicate.minimumAppliedAmount !== null && hp.appliedAmount < predicate.minimumAppliedAmount) {
    return false
  }
  return true
}

export const ABILITY_HP_EVENT_PREDICATE_EVALUATOR: AbilitySubscriptionPredicateEvaluator = Object.freeze({
  kind: ABILITY_HP_EVENT_PREDICATE_KIND,
  version: 1,
  evaluate: (
    context: Readonly<AbilitySubscriptionPredicateContext>,
    value: AbilitySpecJsonObject,
  ) => context.event.kind === 'hp' && evaluateAbilityHpEventPredicate({
    event: context.event,
    ownerPlacementId: context.ownerPlacementId,
    predicate: parseAbilityHpEventPredicate(value),
  }),
})
