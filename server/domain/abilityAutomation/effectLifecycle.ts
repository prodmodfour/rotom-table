import { normalizeRevision } from '#shared/sessionRevisions'
import {
  ABILITY_EFFECT_LIFECYCLE_SCHEMA_VERSION,
  createEmptyAbilityEffectLifecycleState,
  parseAbilityEffectLifecycleState,
  type AbilityEffectLifecycleEntry,
  type AbilityEffectLifecycleState,
} from '#shared/abilityAutomation/durations'
import { createEmptyEncounterState, parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveStateChangePlan,
} from '../moveAutomation/plan'
import type { AuthoritativeAbilityContext } from './context'

export type AbilityEffectLifecycleEvent =
  | {
      readonly kind: 'turn-boundary'
      readonly placementId: string
      readonly boundary: 'start' | 'end'
    }
  | { readonly kind: 'round-boundary'; readonly boundary: 'start' | 'end' }
  | { readonly kind: 'scene-end' }
  | { readonly kind: 'presence-snapshot'; readonly presentPlacementIds: readonly string[] }
  | {
      readonly kind: 'effective-ability-snapshot'
      readonly placementId: string
      readonly activeAbilityInstanceIds: readonly string[]
    }
  | {
      readonly kind: 'field-snapshot'
      readonly weatherIds: readonly string[]
      readonly terrainIds: readonly string[]
    }
  | {
      readonly kind: 'triggered'
      readonly effectId: string
      readonly triggerId: string
    }

export type AbilityEffectLifecycleReasonCode =
  | 'ability-duration.turn-advanced'
  | 'ability-duration.turn-expired'
  | 'ability-duration.round-advanced'
  | 'ability-duration.round-expired'
  | 'ability-duration.scene-expired'
  | 'ability-duration.source-left'
  | 'ability-duration.source-ability-lost'
  | 'ability-duration.target-left'
  | 'ability-duration.weather-ended'
  | 'ability-duration.terrain-ended'
  | 'ability-duration.triggered'

export interface AbilityEffectLifecycleTransition {
  readonly effectId: string
  readonly kind: 'advanced' | 'expired'
  readonly reasonCode: AbilityEffectLifecycleReasonCode
  readonly remaining: number | null
}

export interface AbilityEffectLifecycleReduction {
  readonly state: AbilityEffectLifecycleState
  readonly expiredEffectIds: readonly string[]
  readonly transitions: readonly AbilityEffectLifecycleTransition[]
}

const compareText = (left: string, right: string): number => (
  left === right ? 0 : left < right ? -1 : 1
)

const uniqueSet = (values: readonly string[]): ReadonlySet<string> => new Set(values)

const transition = (
  entry: AbilityEffectLifecycleEntry,
  kind: AbilityEffectLifecycleTransition['kind'],
  reasonCode: AbilityEffectLifecycleReasonCode,
  remaining: number | null,
): AbilityEffectLifecycleTransition => Object.freeze({
  effectId: entry.effectId,
  kind,
  reasonCode,
  remaining,
})

const expirationReason = (
  entry: AbilityEffectLifecycleEntry,
  event: AbilityEffectLifecycleEvent,
): AbilityEffectLifecycleReasonCode | null => {
  if (event.kind === 'scene-end') return 'ability-duration.scene-expired'
  const { duration } = entry
  if (event.kind === 'presence-snapshot') {
    const present = uniqueSet(event.presentPlacementIds)
    if (duration.kind === 'source-presence' && !present.has(entry.sourcePlacementId)) {
      return 'ability-duration.source-left'
    }
    if (duration.kind === 'target-presence') {
      const presentTargets = entry.targetPlacementIds.filter(id => present.has(id)).length
      if (
        duration.policy === 'any-target-leaves'
          ? presentTargets !== entry.targetPlacementIds.length
          : presentTargets === 0
      ) return 'ability-duration.target-left'
    }
  }
  if (
    event.kind === 'effective-ability-snapshot'
    && duration.kind === 'source-ability'
    && event.placementId === entry.sourcePlacementId
    && !event.activeAbilityInstanceIds.includes(entry.sourceAbilityInstanceId)
  ) return 'ability-duration.source-ability-lost'
  if (event.kind === 'field-snapshot') {
    if (duration.kind === 'weather' && !event.weatherIds.includes(duration.fieldId)) {
      return 'ability-duration.weather-ended'
    }
    if (duration.kind === 'terrain' && !event.terrainIds.includes(duration.fieldId)) {
      return 'ability-duration.terrain-ended'
    }
  }
  if (
    event.kind === 'triggered'
    && duration.kind === 'until-triggered'
    && event.effectId === entry.effectId
    && event.triggerId === duration.triggerId
  ) return 'ability-duration.triggered'
  return null
}

/** Pure deterministic lifecycle reduction over one authoritative game event. */
export const reduceAbilityEffectLifecycle = (
  value: unknown,
  event: AbilityEffectLifecycleEvent,
): AbilityEffectLifecycleReduction => {
  const state = parseAbilityEffectLifecycleState(value)
  const entries: AbilityEffectLifecycleEntry[] = []
  const expiredEffectIds: string[] = []
  const transitions: AbilityEffectLifecycleTransition[] = []
  for (const entry of state.entries) {
    const reason = expirationReason(entry, event)
    if (reason) {
      expiredEffectIds.push(entry.effectId)
      transitions.push(transition(entry, 'expired', reason, null))
      continue
    }
    const duration = entry.duration
    const advancesTurn = event.kind === 'turn-boundary'
      && duration.kind === 'turn'
      && event.placementId === duration.subjectPlacementId
      && event.boundary === duration.boundary
    const advancesRound = event.kind === 'round-boundary'
      && duration.kind === 'round'
      && event.boundary === duration.boundary
    if (advancesTurn || advancesRound) {
      const expiredReason = duration.kind === 'turn'
        ? 'ability-duration.turn-expired'
        : 'ability-duration.round-expired'
      if (duration.remaining === 1) {
        expiredEffectIds.push(entry.effectId)
        transitions.push(transition(entry, 'expired', expiredReason, null))
        continue
      }
      const advancedReason = duration.kind === 'turn'
        ? 'ability-duration.turn-advanced'
        : 'ability-duration.round-advanced'
      const nextEntry = {
        ...entry,
        duration: { ...duration, remaining: duration.remaining - 1 },
      } as AbilityEffectLifecycleEntry
      entries.push(nextEntry)
      transitions.push(transition(entry, 'advanced', advancedReason, duration.remaining - 1))
      continue
    }
    entries.push(entry)
  }
  return Object.freeze({
    state: parseAbilityEffectLifecycleState({
      schemaVersion: ABILITY_EFFECT_LIFECYCLE_SCHEMA_VERSION,
      entries,
    }),
    expiredEffectIds: Object.freeze(expiredEffectIds),
    transitions: Object.freeze(transitions),
  })
}

/** Remove expired payload effects and lifecycle ownership in one encounter value. */
export const reduceAbilityEffectLifecycleEncounter = (
  value: unknown,
  event: AbilityEffectLifecycleEvent,
): { readonly encounter: EncounterState; readonly reduction: AbilityEffectLifecycleReduction } => {
  const encounter = parseEncounterState(value)
  const reduction = reduceAbilityEffectLifecycle(
    encounter.abilityEffectLifecycle ?? createEmptyAbilityEffectLifecycleState(),
    event,
  )
  if (reduction.transitions.length === 0) return Object.freeze({ encounter, reduction })
  const expired = new Set(reduction.expiredEffectIds)
  return Object.freeze({
    encounter: parseEncounterState({
      ...encounter,
      effects: encounter.effects.filter(effect => !expired.has(effect.id)),
      abilityEffectLifecycle: reduction.state,
    }),
    reduction,
  })
}

export const planAbilityEffectLifecycleEvent = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly event: AbilityEffectLifecycleEvent
  readonly operationId: string
}): { readonly plan: MoveStateChangePlan; readonly transitions: readonly AbilityEffectLifecycleTransition[] } => {
  const previous = parseEncounterState(
    input.context.map.encounterState ?? createEmptyEncounterState(),
  )
  const reduced = reduceAbilityEffectLifecycleEncounter(previous, input.event)
  if (reduced.reduction.transitions.length === 0) {
    return Object.freeze({ plan: createMoveStateChangePlan([]), transitions: Object.freeze([]) })
  }
  return Object.freeze({
    plan: createMoveStateChangePlan([{
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision),
      sourceOperationId: input.operationId,
      reasonCode: 'ability-effects.lifecycle-event',
      previous,
      current: reduced.encounter,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }]),
    transitions: reduced.reduction.transitions,
  })
}

export interface AbilityEffectRecoveryFacts {
  readonly presentPlacementIds: readonly string[]
  readonly activeAbilityInstanceIdsByPlacement: ReadonlyMap<string, readonly string[]>
  readonly weatherIds: readonly string[]
  readonly terrainIds: readonly string[]
}

/** Reconcile persisted presence/ability/field dependencies after restart. */
export const recoverAbilityEffectLifecycles = (
  value: unknown,
  facts: AbilityEffectRecoveryFacts,
): EncounterState => {
  let encounter = reduceAbilityEffectLifecycleEncounter(value, {
    kind: 'presence-snapshot',
    presentPlacementIds: facts.presentPlacementIds,
  }).encounter
  const sourcePlacementIds = [...new Set(
    (encounter.abilityEffectLifecycle?.entries ?? []).map(entry => entry.sourcePlacementId),
  )].sort(compareText)
  for (const placementId of sourcePlacementIds) {
    encounter = reduceAbilityEffectLifecycleEncounter(encounter, {
      kind: 'effective-ability-snapshot',
      placementId,
      activeAbilityInstanceIds: facts.activeAbilityInstanceIdsByPlacement.get(placementId) ?? [],
    }).encounter
  }
  return reduceAbilityEffectLifecycleEncounter(encounter, {
    kind: 'field-snapshot',
    weatherIds: facts.weatherIds,
    terrainIds: facts.terrainIds,
  }).encounter
}
