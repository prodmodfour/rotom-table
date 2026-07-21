import {
  ABILITY_EVENT_CHECKPOINTS,
  parseAbilityEncounterEvent,
  type AbilityEncounterEvent,
  type AbilityEventCheckpoint,
} from '#shared/abilityAutomation/events'
import type { AbilitySpecJsonObject, AbilitySpecTriggerResponse } from '#shared/abilityAutomation/spec'
import type { AuthoritativeEffectiveAbility } from './context'
import { ABILITY_MOVE_EVENT_PREDICATE_EVALUATOR } from './moveEventPredicates'
import { ABILITY_STRIKE_EVENT_PREDICATE_EVALUATOR } from './strikeEventPredicates'
import { ABILITY_HP_EVENT_PREDICATE_EVALUATOR } from './hpEventPredicates'
import {
  ABILITY_CONDITION_EVENT_PREDICATE_EVALUATOR,
  ABILITY_VALUE_CHANGE_EVENT_PREDICATE_EVALUATOR,
} from './changeEventPredicates'
import { ABILITY_MOVEMENT_EVENT_PREDICATE_EVALUATOR } from './movementEventPredicates'
import {
  ABILITY_INITIATIVE_EVENT_PREDICATE_EVALUATOR,
  ABILITY_LIFECYCLE_EVENT_PREDICATE_EVALUATOR,
  ABILITY_PRESENCE_EVENT_PREDICATE_EVALUATOR,
} from './lifecycleEventPredicates'
import {
  ABILITY_FIELD_EVENT_PREDICATE_EVALUATOR,
  ABILITY_ITEM_EVENT_PREDICATE_EVALUATOR,
} from './resourceEventPredicates'
import type {
  AbilityAutomationRuntimeRegistry,
  AbilitySpecV1Runtime,
} from './registry'

export const ABILITY_SUBSCRIPTION_ROUTER_LIMITS = Object.freeze({
  placements: 512,
  abilitiesPerPlacement: 64,
  routes: 2_048,
  predicateEvaluators: 128,
})

export interface AbilitySubscriptionRoutingPlacement {
  readonly placementId: string
  readonly effectiveAbilities: readonly AuthoritativeEffectiveAbility[]
}

export interface AbilitySubscriptionPredicateContext {
  readonly event: AbilityEncounterEvent
  readonly checkpoint: AbilityEventCheckpoint
  readonly ownerPlacementId: string
  readonly ability: AuthoritativeEffectiveAbility
  readonly runtime: AbilitySpecV1Runtime
  readonly subscriptionId: string
}

export interface AbilitySubscriptionPredicateEvaluator {
  readonly kind: string
  readonly version: number
  readonly evaluate: (
    context: Readonly<AbilitySubscriptionPredicateContext>,
    predicate: AbilitySpecJsonObject,
  ) => boolean
}

export interface AbilitySubscriptionPredicateRegistry {
  readonly size: number
  readonly resolve: (kind: string) => AbilitySubscriptionPredicateEvaluator | null
  readonly entries: () => readonly AbilitySubscriptionPredicateEvaluator[]
}

export interface AbilitySubscriptionRoute {
  readonly routeId: string
  readonly eventId: string
  readonly checkpoint: AbilityEventCheckpoint
  readonly ownerPlacementId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly modeId: string
  readonly subscriptionId: string
  readonly priority: number
  readonly response: AbilitySpecTriggerResponse
  readonly oncePerCausalChain: boolean
  readonly runtimeVersion: number
  readonly definitionHash: string
  readonly sourceModule: string
}

export interface AbilitySubscriptionRoutingStats {
  readonly effectiveInstances: number
  readonly nativeRuntimes: number
  readonly subscriptionsConsidered: number
  readonly eventKindRejected: number
  readonly checkpointRejected: number
  readonly predicateRejected: number
  readonly predicateUnavailable: number
  readonly routes: number
}

export interface AbilitySubscriptionRoutingResult {
  readonly event: AbilityEncounterEvent
  readonly routes: readonly AbilitySubscriptionRoute[]
  readonly stats: AbilitySubscriptionRoutingStats
}

export type AbilitySubscriptionRouterErrorCode =
  | 'invalid-predicate-registration'
  | 'duplicate-predicate-kind'
  | 'invalid-checkpoint'
  | 'map-identity-mismatch'
  | 'duplicate-placement-id'
  | 'duplicate-ability-instance'
  | 'limit-exceeded'

export class AbilitySubscriptionRouterError extends Error {
  readonly code: AbilitySubscriptionRouterErrorCode

  constructor(code: AbilitySubscriptionRouterErrorCode, detail: string) {
    super(detail)
    this.name = 'AbilitySubscriptionRouterError'
    this.code = code
  }
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CHECKPOINT_SET = new Set<string>(ABILITY_EVENT_CHECKPOINTS)

const fail = (code: AbilitySubscriptionRouterErrorCode, detail: string): never => {
  throw new AbilitySubscriptionRouterError(code, detail)
}

const compareText = (left: string, right: string): number => (
  left === right ? 0 : left < right ? -1 : 1
)

export const createAbilitySubscriptionPredicateRegistry = (
  registrations: readonly AbilitySubscriptionPredicateEvaluator[] = [],
): AbilitySubscriptionPredicateRegistry => {
  if (registrations.length > ABILITY_SUBSCRIPTION_ROUTER_LIMITS.predicateEvaluators) {
    fail('limit-exceeded', 'Too many ability subscription predicate evaluators.')
  }
  const byKind = new Map<string, AbilitySubscriptionPredicateEvaluator>()
  for (const registration of registrations) {
    if (
      !registration
      || typeof registration.kind !== 'string'
      || !STABLE_ID_PATTERN.test(registration.kind)
      || !Number.isSafeInteger(registration.version)
      || registration.version < 1
      || typeof registration.evaluate !== 'function'
    ) fail('invalid-predicate-registration', 'Predicate evaluator registration is invalid.')
    if (byKind.has(registration.kind)) {
      fail('duplicate-predicate-kind', `Predicate evaluator ${registration.kind} is duplicated.`)
    }
    byKind.set(registration.kind, Object.freeze({ ...registration }))
  }
  const entries = Object.freeze([...byKind.values()].sort((left, right) => (
    compareText(left.kind, right.kind)
  )))
  return Object.freeze({
    size: entries.length,
    resolve: (kind: string) => byKind.get(kind) ?? null,
    entries: () => entries,
  })
}

/** Production contains only reviewed, versioned event predicate semantics. */
export const ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY = createAbilitySubscriptionPredicateRegistry([
  ABILITY_MOVE_EVENT_PREDICATE_EVALUATOR,
  ABILITY_STRIKE_EVENT_PREDICATE_EVALUATOR,
  ABILITY_HP_EVENT_PREDICATE_EVALUATOR,
  ABILITY_CONDITION_EVENT_PREDICATE_EVALUATOR,
  ABILITY_VALUE_CHANGE_EVENT_PREDICATE_EVALUATOR,
  ABILITY_MOVEMENT_EVENT_PREDICATE_EVALUATOR,
  ABILITY_PRESENCE_EVENT_PREDICATE_EVALUATOR,
  ABILITY_INITIATIVE_EVENT_PREDICATE_EVALUATOR,
  ABILITY_LIFECYCLE_EVENT_PREDICATE_EVALUATOR,
  ABILITY_ITEM_EVENT_PREDICATE_EVALUATOR,
  ABILITY_FIELD_EVENT_PREDICATE_EVALUATOR,
])

const predicateMatches = (input: {
  readonly predicate: AbilitySpecJsonObject | null
  readonly predicateRegistry: AbilitySubscriptionPredicateRegistry
  readonly context: AbilitySubscriptionPredicateContext
}): 'matched' | 'rejected' | 'unavailable' => {
  if (input.predicate === null) return 'matched'
  const kind = input.predicate.kind
  if (typeof kind !== 'string') return 'unavailable'
  const evaluator = input.predicateRegistry.resolve(kind)
  const extension = input.context.runtime.definition.extensionReferences.find(reference => (
    reference.family === 'predicate' && reference.kind === kind
  ))
  if (!evaluator || !extension || evaluator.version !== extension.version) return 'unavailable'
  try {
    return evaluator.evaluate(Object.freeze(input.context), input.predicate)
      ? 'matched'
      : 'rejected'
  }
  catch {
    return 'rejected'
  }
}

export const routeAbilityEventSubscriptions = (input: {
  readonly event: unknown
  readonly checkpoint: AbilityEventCheckpoint
  readonly mapSlug: string
  readonly mapRevision: number
  readonly placements: readonly AbilitySubscriptionRoutingPlacement[]
  readonly runtimeRegistry: AbilityAutomationRuntimeRegistry
  readonly predicateRegistry?: AbilitySubscriptionPredicateRegistry
}): AbilitySubscriptionRoutingResult => {
  if (!CHECKPOINT_SET.has(input.checkpoint)) {
    fail('invalid-checkpoint', `Unknown checkpoint ${input.checkpoint}.`)
  }
  const event = parseAbilityEncounterEvent(input.event)
  if (event.mapSlug !== input.mapSlug || event.mapRevision !== input.mapRevision) {
    fail('map-identity-mismatch', 'Ability event does not match the routed map revision.')
  }
  if (input.placements.length > ABILITY_SUBSCRIPTION_ROUTER_LIMITS.placements) {
    fail('limit-exceeded', 'Ability subscription placement budget exceeded.')
  }
  const placementIds = input.placements.map(placement => placement.placementId)
  if (new Set(placementIds).size !== placementIds.length) {
    fail('duplicate-placement-id', 'Ability routing placements must be unique.')
  }
  const predicateRegistry = input.predicateRegistry ?? ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY
  const routes: AbilitySubscriptionRoute[] = []
  let effectiveInstances = 0
  let nativeRuntimes = 0
  let subscriptionsConsidered = 0
  let eventKindRejected = 0
  let checkpointRejected = 0
  let predicateRejected = 0
  let predicateUnavailable = 0

  const placements = [...input.placements].sort((left, right) => (
    compareText(left.placementId, right.placementId)
  ))
  for (const placement of placements) {
    if (placement.effectiveAbilities.length > ABILITY_SUBSCRIPTION_ROUTER_LIMITS.abilitiesPerPlacement) {
      fail('limit-exceeded', `Placement ${placement.placementId} has too many effective abilities.`)
    }
    const abilityIds = placement.effectiveAbilities.map(ability => ability.instanceId)
    if (new Set(abilityIds).size !== abilityIds.length) {
      fail('duplicate-ability-instance', `Placement ${placement.placementId} repeats an ability instance.`)
    }
    const abilities = placement.effectiveAbilities
      .filter(ability => ability.effective)
      .sort((left, right) => (
        compareText(left.canonicalId, right.canonicalId)
        || compareText(left.instanceId, right.instanceId)
      ))
    effectiveInstances += abilities.length
    for (const ability of abilities) {
      const runtime = input.runtimeRegistry.resolve(ability.canonicalId)
      if (!runtime || (ability.definitionHash !== null && ability.definitionHash !== runtime.definitionHash)) {
        continue
      }
      nativeRuntimes += 1
      for (const subscription of runtime.definition.spec.subscriptions) {
        subscriptionsConsidered += 1
        if (subscription.eventKind !== event.kind) {
          eventKindRejected += 1
          continue
        }
        if (subscription.checkpoint !== input.checkpoint) {
          checkpointRejected += 1
          continue
        }
        const predicate = predicateMatches({
          predicate: subscription.predicate,
          predicateRegistry,
          context: {
            event,
            checkpoint: input.checkpoint,
            ownerPlacementId: placement.placementId,
            ability,
            runtime,
            subscriptionId: subscription.id,
          },
        })
        if (predicate !== 'matched') {
          if (predicate === 'unavailable') predicateUnavailable += 1
          else predicateRejected += 1
          continue
        }
        if (routes.length >= ABILITY_SUBSCRIPTION_ROUTER_LIMITS.routes) {
          fail('limit-exceeded', 'Ability subscription route budget exceeded.')
        }
        routes.push(Object.freeze({
          routeId: `${event.eventId}:${placement.placementId}:${ability.instanceId}:${subscription.id}`,
          eventId: event.eventId,
          checkpoint: input.checkpoint,
          ownerPlacementId: placement.placementId,
          abilityInstanceId: ability.instanceId,
          canonicalId: ability.canonicalId,
          modeId: subscription.modeId,
          subscriptionId: subscription.id,
          priority: subscription.priority,
          response: subscription.response,
          oncePerCausalChain: subscription.oncePerCausalChain,
          runtimeVersion: runtime.version,
          definitionHash: runtime.definitionHash,
          sourceModule: runtime.sourceModule,
        }))
      }
    }
  }
  routes.sort((left, right) => (
    right.priority - left.priority
    || compareText(left.canonicalId, right.canonicalId)
    || compareText(left.ownerPlacementId, right.ownerPlacementId)
    || compareText(left.abilityInstanceId, right.abilityInstanceId)
    || compareText(left.subscriptionId, right.subscriptionId)
  ))
  return Object.freeze({
    event,
    routes: Object.freeze(routes),
    stats: Object.freeze({
      effectiveInstances,
      nativeRuntimes,
      subscriptionsConsidered,
      eventKindRejected,
      checkpointRejected,
      predicateRejected,
      predicateUnavailable,
      routes: routes.length,
    }),
  })
}
