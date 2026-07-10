import {
  ENCOUNTER_EFFECT_LIMITS,
  parseEncounterEffect,
  parseEncounterEffects,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import type { EncounterSideId } from '#shared/moveAutomation/encounterState'

/**
 * Narrow authoritative facts understood by the effect-policy layer.
 *
 * MA-059 adds the broader encounter-event contract. Its reducer can adapt
 * those facts to this closed union without making wall-clock time or browser
 * state part of effect expiry.
 */
export const ENCOUNTER_EFFECT_LIFECYCLE_EVENT_KINDS = [
  'effect-applied',
  'turn-start',
  'turn-end',
  'round-start',
  'round-end',
  'scene-end',
  'effect-triggered',
  'effect-removed',
] as const

export type EncounterEffectLifecycleEventKind =
  (typeof ENCOUNTER_EFFECT_LIFECYCLE_EVENT_KINDS)[number]

export interface EncounterEffectAppliedLifecycleEvent {
  readonly kind: 'effect-applied'
  /** Fully server-authored instance; the strict shared parser still revalidates it. */
  readonly effect: EncounterEffect
}

export interface EncounterEffectTurnLifecycleEvent {
  readonly kind: 'turn-start' | 'turn-end'
  readonly placementId: string
  /** Authoritative side at this turn boundary, when one exists. */
  readonly sideId?: EncounterSideId
}

export interface EncounterEffectRoundLifecycleEvent {
  readonly kind: 'round-start' | 'round-end'
}

export interface EncounterEffectSceneEndLifecycleEvent {
  readonly kind: 'scene-end'
}

export interface EncounterEffectTriggeredLifecycleEvent {
  readonly kind: 'effect-triggered'
  readonly effectId: string
}

export interface EncounterEffectRemovedLifecycleEvent {
  readonly kind: 'effect-removed'
  readonly effectId: string
}

export type EncounterEffectLifecycleEvent =
  | EncounterEffectAppliedLifecycleEvent
  | EncounterEffectTurnLifecycleEvent
  | EncounterEffectRoundLifecycleEvent
  | EncounterEffectSceneEndLifecycleEvent
  | EncounterEffectTriggeredLifecycleEvent
  | EncounterEffectRemovedLifecycleEvent

export const ENCOUNTER_EFFECT_LIFECYCLE_TRANSITION_KINDS = [
  'added',
  'replaced',
  'refreshed',
  'stack-added',
  'stack-capped',
  'duration-decremented',
  'charge-consumed',
  'expired',
  'removed',
  'suppression-cleared',
] as const

export type EncounterEffectLifecycleTransitionKind =
  (typeof ENCOUNTER_EFFECT_LIFECYCLE_TRANSITION_KINDS)[number]

export type EncounterEffectLifecycleReasonCode =
  | 'effect-added'
  | 'effect-replaced'
  | 'effect-duration-refreshed'
  | 'effect-stack-added'
  | 'effect-max-stacks-reached'
  | 'effect-duration-decremented'
  | 'effect-duration-expired'
  | 'effect-triggered-expiry'
  | 'effect-charge-consumed'
  | 'effect-charges-depleted'
  | 'effect-explicitly-removed'
  | 'effect-suppression-source-removed'

export interface EncounterEffectLifecycleTransition {
  readonly effectId: string
  readonly kind: EncounterEffectLifecycleTransitionKind
  readonly reasonCode: EncounterEffectLifecycleReasonCode
  readonly previous: EncounterEffect | null
  readonly current: EncounterEffect | null
}

export interface EncounterEffectLifecycleState {
  readonly effects: readonly EncounterEffect[]
}

export interface EncounterEffectLifecycleResult extends EncounterEffectLifecycleState {
  readonly changed: boolean
  readonly transitions: readonly EncounterEffectLifecycleTransition[]
}

export type EncounterEffectLifecycleErrorCode =
  | 'invalid-event'
  | 'effect-limit-exceeded'
  | 'duplicate-independent-effect'
  | 'incompatible-reapplication'

export class EncounterEffectLifecycleError extends Error {
  readonly code: EncounterEffectLifecycleErrorCode

  constructor(code: EncounterEffectLifecycleErrorCode, message: string) {
    super(message)
    this.name = 'EncounterEffectLifecycleError'
    this.code = code
  }
}

const EVENT_KIND_SET = new Set<string>(ENCOUNTER_EFFECT_LIFECYCLE_EVENT_KINDS)

const fail = (code: EncounterEffectLifecycleErrorCode, message: string): never => {
  throw new EncounterEffectLifecycleError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const sameJson = (left: unknown, right: unknown): boolean => (
  JSON.stringify(left) === JSON.stringify(right)
)

function assertBoundedId(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > ENCOUNTER_EFFECT_LIMITS.identifierChars
    || value.trim() !== value
  ) {
    fail('invalid-event', `${label} must be a non-empty bounded identifier.`)
  }
}

const assertLifecycleEvent = (event: EncounterEffectLifecycleEvent): void => {
  if (
    typeof event !== 'object'
    || event === null
    || !EVENT_KIND_SET.has((event as { kind?: unknown }).kind as string)
  ) {
    fail('invalid-event', 'Effect lifecycle event kind is unsupported.')
  }

  if (event.kind === 'effect-applied') {
    parseEncounterEffect(event.effect, 'effectLifecycleEvent.effect')
    return
  }
  if (event.kind === 'turn-start' || event.kind === 'turn-end') {
    assertBoundedId(event.placementId, 'Effect lifecycle turn placementId')
    if (event.sideId !== undefined) assertBoundedId(event.sideId, 'Effect lifecycle turn sideId')
    return
  }
  if (event.kind === 'effect-triggered' || event.kind === 'effect-removed') {
    assertBoundedId(event.effectId, 'Effect lifecycle event effectId')
  }
}

const transition = (
  kind: EncounterEffectLifecycleTransitionKind,
  reasonCode: EncounterEffectLifecycleReasonCode,
  previous: EncounterEffect | null,
  current: EncounterEffect | null,
): EncounterEffectLifecycleTransition => ({
  effectId: current?.id ?? previous!.id,
  kind,
  reasonCode,
  previous,
  current,
})

const lifecycleResult = (
  effects: readonly EncounterEffect[],
  transitions: readonly EncounterEffectLifecycleTransition[],
  changed = transitions.some(entry => entry.kind !== 'stack-capped'),
): EncounterEffectLifecycleResult => deepFreeze({
  changed,
  effects: parseEncounterEffects(effects, 'effectLifecycleResult.effects'),
  transitions,
})

const durationMatchesTurn = (
  effect: EncounterEffect,
  event: EncounterEffectTurnLifecycleEvent,
): boolean => {
  const duration = effect.duration
  const boundary = event.kind === 'turn-start' ? 'start' : 'end'
  if (duration.kind !== 'turns' || duration.boundary !== boundary) return false
  if (duration.subject === 'source') return effect.source.placementId === event.placementId
  return effect.affected.placementIds.includes(event.placementId)
    || (event.sideId !== undefined && effect.affected.sideIds.includes(event.sideId))
}

const durationMatchesRound = (
  effect: EncounterEffect,
  event: EncounterEffectRoundLifecycleEvent,
): boolean => {
  const boundary = event.kind === 'round-start' ? 'start' : 'end'
  return effect.duration.kind === 'rounds' && effect.duration.boundary === boundary
}

const decrementDuration = (
  effect: EncounterEffect,
): { readonly effect: EncounterEffect | null, readonly transition: EncounterEffectLifecycleTransition } => {
  const duration = effect.duration
  if (duration.kind !== 'turns' && duration.kind !== 'rounds') {
    throw new Error('decrementDuration requires a finite duration.')
  }
  if (duration.remaining === 1) {
    return {
      effect: null,
      transition: transition('expired', 'effect-duration-expired', effect, null),
    }
  }
  const current = parseEncounterEffect({
    ...effect,
    duration: { ...duration, remaining: duration.remaining - 1 },
  }, 'effectLifecycleTransition.effect')
  return {
    effect: current,
    transition: transition(
      'duration-decremented',
      'effect-duration-decremented',
      effect,
      current,
    ),
  }
}

const consumeTrigger = (
  effect: EncounterEffect,
): { readonly effect: EncounterEffect | null, readonly transition?: EncounterEffectLifecycleTransition } => {
  if (effect.duration.kind === 'until-triggered') {
    return {
      effect: null,
      transition: transition('expired', 'effect-triggered-expiry', effect, null),
    }
  }
  if (effect.chargePolicy.kind === 'none') return { effect }

  const charges = effect.charges!
  if (charges <= effect.chargePolicy.amount) {
    return {
      effect: null,
      transition: transition('expired', 'effect-charges-depleted', effect, null),
    }
  }
  const current = parseEncounterEffect({
    ...effect,
    charges: charges - effect.chargePolicy.amount,
  }, 'effectLifecycleTransition.effect')
  return {
    effect: current,
    transition: transition('charge-consumed', 'effect-charge-consumed', effect, current),
  }
}

const immutableDefinitionMatches = (
  existing: EncounterEffect,
  incoming: EncounterEffect,
  requireSameSource: boolean,
): boolean => (
  existing.kind === incoming.kind
  && (!requireSameSource || (
    existing.source.moveId === incoming.source.moveId
    && existing.source.placementId === incoming.source.placementId
  ))
  && sameJson(existing.affected, incoming.affected)
  && sameJson(existing.tags, incoming.tags)
  && sameJson(existing.payload, incoming.payload)
  && sameJson(existing.dispel, incoming.dispel)
  && sameJson(existing.stackPolicy, incoming.stackPolicy)
  && sameJson(existing.chargePolicy, incoming.chargePolicy)
)

const assertCompatibleReapplication = (
  existing: EncounterEffect,
  incoming: EncounterEffect,
  requireSameSource: boolean,
): void => {
  if (!immutableDefinitionMatches(existing, incoming, requireSameSource)) {
    fail(
      'incompatible-reapplication',
      `Effect ${incoming.id} cannot ${incoming.stackPolicy.kind} an incompatible instance.`,
    )
  }
}

const applyEffect = (
  effects: readonly EncounterEffect[],
  incomingValue: EncounterEffect,
): EncounterEffectLifecycleResult => {
  const incoming = parseEncounterEffect(incomingValue, 'effectLifecycleEvent.effect')
  const existingIndex = effects.findIndex(effect => effect.id === incoming.id)

  if (existingIndex < 0) {
    if (effects.length >= ENCOUNTER_EFFECT_LIMITS.count) {
      return fail(
        'effect-limit-exceeded',
        `Encounter effects cannot exceed ${ENCOUNTER_EFFECT_LIMITS.count} instances.`,
      )
    }
    return lifecycleResult(
      [...effects, incoming],
      [transition('added', 'effect-added', null, incoming)],
    )
  }

  const existing = effects[existingIndex]!
  if (existing.stackPolicy.kind !== incoming.stackPolicy.kind) {
    return fail(
      'incompatible-reapplication',
      `Effect ${incoming.id} changed stack policy from ${existing.stackPolicy.kind} to ${incoming.stackPolicy.kind}.`,
    )
  }
  if (incoming.stackPolicy.kind === 'independent-instance') {
    return fail(
      'duplicate-independent-effect',
      `Independent effect ${incoming.id} requires a unique instance ID.`,
    )
  }

  const currentEffects = [...effects]
  if (incoming.stackPolicy.kind === 'replace') {
    currentEffects[existingIndex] = incoming
    return lifecycleResult(
      currentEffects,
      [transition('replaced', 'effect-replaced', existing, incoming)],
    )
  }

  if (incoming.stackPolicy.kind === 'refresh') {
    assertCompatibleReapplication(existing, incoming, false)
    const refreshed = parseEncounterEffect({
      ...existing,
      source: incoming.source,
      createdRound: incoming.createdRound,
      createdTurn: incoming.createdTurn,
      duration: incoming.duration,
      suppression: incoming.suppression,
    }, 'effectLifecycleTransition.effect')
    currentEffects[existingIndex] = refreshed
    return lifecycleResult(
      currentEffects,
      [transition('refreshed', 'effect-duration-refreshed', existing, refreshed)],
    )
  }

  assertCompatibleReapplication(existing, incoming, true)
  if (existing.stackPolicy.kind !== 'add-stack') {
    return fail(
      'incompatible-reapplication',
      `Effect ${incoming.id} has no deterministic reapplication policy.`,
    )
  }
  const maxStacks = existing.stackPolicy.maxStacks
  const stacks = Math.min(maxStacks, existing.stacks + incoming.stacks)
  if (stacks === existing.stacks) {
    return lifecycleResult(
      effects,
      [transition('stack-capped', 'effect-max-stacks-reached', existing, existing)],
      false,
    )
  }
  const stacked = parseEncounterEffect({
    ...existing,
    stacks,
  }, 'effectLifecycleTransition.effect')
  currentEffects[existingIndex] = stacked
  return lifecycleResult(
    currentEffects,
    [transition('stack-added', 'effect-stack-added', existing, stacked)],
  )
}

const clearRemovedSuppressionSources = (
  effects: readonly EncounterEffect[],
  removedIds: ReadonlySet<string>,
  transitions: EncounterEffectLifecycleTransition[],
): readonly EncounterEffect[] => effects.map((effect) => {
  const sources = effect.suppression.sources.filter(source => !removedIds.has(source.effectId))
  if (sources.length === effect.suppression.sources.length) return effect

  const current = parseEncounterEffect({
    ...effect,
    suppression: { sources },
  }, 'effectLifecycleTransition.effect')
  transitions.push(transition(
    'suppression-cleared',
    'effect-suppression-source-removed',
    effect,
    current,
  ))
  return current
})

const advanceEffects = (
  effects: readonly EncounterEffect[],
  event: Exclude<EncounterEffectLifecycleEvent, EncounterEffectAppliedLifecycleEvent>,
): EncounterEffectLifecycleResult => {
  const currentEffects: EncounterEffect[] = []
  const transitions: EncounterEffectLifecycleTransition[] = []
  const removedIds = new Set<string>()

  for (const effect of effects) {
    let outcome:
      | { readonly effect: EncounterEffect | null, readonly transition?: EncounterEffectLifecycleTransition }
      | undefined

    if (event.kind === 'effect-removed' && event.effectId === effect.id) {
      outcome = {
        effect: null,
        transition: transition('removed', 'effect-explicitly-removed', effect, null),
      }
    }
    else if (event.kind === 'effect-triggered' && event.effectId === effect.id) {
      outcome = consumeTrigger(effect)
    }
    else if (
      (event.kind === 'turn-start' || event.kind === 'turn-end')
      && durationMatchesTurn(effect, event)
    ) {
      outcome = decrementDuration(effect)
    }
    else if (
      (event.kind === 'round-start' || event.kind === 'round-end')
      && durationMatchesRound(effect, event)
    ) {
      outcome = decrementDuration(effect)
    }
    else if (event.kind === 'scene-end' && effect.duration.kind === 'scene') {
      outcome = {
        effect: null,
        transition: transition('expired', 'effect-duration-expired', effect, null),
      }
    }

    if (!outcome) {
      currentEffects.push(effect)
      continue
    }
    if (outcome.transition) transitions.push(outcome.transition)
    if (outcome.effect) currentEffects.push(outcome.effect)
    else removedIds.add(effect.id)
  }

  const cleanedEffects = removedIds.size === 0
    ? currentEffects
    : clearRemovedSuppressionSources(currentEffects, removedIds, transitions)
  return lifecycleResult(cleanedEffects, transitions)
}

/**
 * Apply exactly one server-authored lifecycle fact to the encounter effect
 * collection. The input is never mutated, output ordering is stable, and no
 * wall-clock or ambient state participates in duration, stack, or charge
 * transitions.
 */
export const applyEncounterEffectLifecycleEvent = (
  state: EncounterEffectLifecycleState,
  event: EncounterEffectLifecycleEvent,
): EncounterEffectLifecycleResult => {
  assertLifecycleEvent(event)
  const effects = parseEncounterEffects(state.effects, 'effectLifecycleState.effects')
  return event.kind === 'effect-applied'
    ? applyEffect(effects, event.effect)
    : advanceEffects(effects, event)
}
