import type { AbilityStrikeEncounterEvent } from '#shared/abilityAutomation/events'
import type { AbilitySpecJsonObject } from '#shared/abilityAutomation/spec'
import {
  ABILITY_STRIKE_EVENT_PREDICATE_KIND,
  parseAbilityStrikeEventPredicate,
  type AbilityStrikeEventPredicate,
} from '#shared/abilityAutomation/strikeEventPredicates'
import type {
  AbilitySubscriptionPredicateContext,
  AbilitySubscriptionPredicateEvaluator,
} from './subscriptionRouter'

export const evaluateAbilityStrikeEventPredicate = (input: {
  readonly event: AbilityStrikeEncounterEvent
  readonly ownerPlacementId: string
  readonly predicate: AbilityStrikeEventPredicate
}): boolean => {
  const { event, predicate } = input
  const payload = event.payload
  if (predicate.timings.length > 0 && !predicate.timings.includes(payload.timing)) return false
  if (predicate.accuracyOutcomes.length > 0
    && !predicate.accuracyOutcomes.includes(payload.accuracyOutcome)) return false
  if (predicate.rangeContexts.length > 0
    && !predicate.rangeContexts.includes(payload.rangeContext)) return false
  if (predicate.directness.length > 0 && !predicate.directness.includes(payload.directness)) return false
  if (predicate.moveTypes.length > 0 && !predicate.moveTypes.includes(payload.moveType)) return false
  if (predicate.damageClasses.length > 0
    && !predicate.damageClasses.includes(payload.damageClass)) return false
  if (predicate.effectiveness.length > 0
    && (payload.effectiveness === null || !predicate.effectiveness.includes(payload.effectiveness))) return false
  if (predicate.contact === 'required' && !payload.makesContact) return false
  if (predicate.contact === 'forbidden' && payload.makesContact) return false
  if (predicate.critical === 'required' && !payload.critical) return false
  if (predicate.critical === 'forbidden' && payload.critical) return false
  const ownerIsAttacker = payload.attackerPlacementId === input.ownerPlacementId
  const ownerIsDefender = payload.defenderPlacementId === input.ownerPlacementId
  if (predicate.ownerRole === 'attacker' && !ownerIsAttacker) return false
  if (predicate.ownerRole === 'defender' && !ownerIsDefender) return false
  if (predicate.ownerRole === 'either' && !ownerIsAttacker && !ownerIsDefender) return false
  if (predicate.ownerRole === 'other' && (ownerIsAttacker || ownerIsDefender)) return false
  const prevented = payload.accuracyOutcome === 'prevented'
    || payload.effectiveness === 'immune'
    || (payload.preventedDamage ?? 0) > 0
  if (predicate.prevention === 'prevented' && !prevented) return false
  if (predicate.prevention === 'unprevented' && prevented) return false
  if (predicate.strikeIndex === 'first' && payload.strikeIndex !== 1) return false
  if (predicate.strikeIndex === 'last' && payload.strikeIndex !== payload.strikeCount) return false
  if (predicate.minimumHpLoss !== null
    && (payload.hpLoss === null || payload.hpLoss < predicate.minimumHpLoss)) return false
  if (predicate.minimumTotalLoss !== null
    && (payload.totalLoss === null || payload.totalLoss < predicate.minimumTotalLoss)) return false
  return true
}

export const ABILITY_STRIKE_EVENT_PREDICATE_EVALUATOR: AbilitySubscriptionPredicateEvaluator = Object.freeze({
  kind: ABILITY_STRIKE_EVENT_PREDICATE_KIND,
  version: 1,
  evaluate: (
    context: Readonly<AbilitySubscriptionPredicateContext>,
    value: AbilitySpecJsonObject,
  ) => context.event.kind === 'strike' && evaluateAbilityStrikeEventPredicate({
    event: context.event,
    ownerPlacementId: context.ownerPlacementId,
    predicate: parseAbilityStrikeEventPredicate(value),
  }),
})
