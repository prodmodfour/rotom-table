import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvents,
  type EncounterEffectRemovedEvent,
  type EncounterEvent,
} from '#shared/moveAutomation/events'
import {
  MOVE_SEMI_INVULNERABLE_EFFECT_TAG,
  moveSemiInvulnerableSetupGroup,
  parseMoveSemiInvulnerableSetupGroups,
  type MoveSemiInvulnerableSetupGroup,
} from './semiInvulnerableEffects'
import type { EncounterLifecycleTriggerHandler } from './reduceLifecycle'
import {
  assertMoveSemiInvulnerableStableId,
  deepFreezeMoveSemiInvulnerable,
  deriveMoveSemiInvulnerableId,
  failMoveSemiInvulnerableSetup,
} from './semiInvulnerableSupport'

export const MOVE_SEMI_INVULNERABLE_CLEANUP_REASONS = [
  'semi-invulnerable.resolved',
  'semi-invulnerable.cancelled',
  'semi-invulnerable.source-left',
  'semi-invulnerable.linked-effect-removed',
] as const

export type MoveSemiInvulnerableCleanupReason =
  (typeof MOVE_SEMI_INVULNERABLE_CLEANUP_REASONS)[number]

const CLEANUP_REASON_SET = new Set<string>(MOVE_SEMI_INVULNERABLE_CLEANUP_REASONS)

const cleanupEventsForGroup = (input: {
  readonly group: MoveSemiInvulnerableSetupGroup
  readonly sourceOperationId: string
  readonly reasonCode: MoveSemiInvulnerableCleanupReason
  readonly causalParentEventId?: string | null
  readonly retainedEffectIds?: ReadonlySet<string>
}): readonly EncounterEffectRemovedEvent[] => {
  const sourceOperationId = assertMoveSemiInvulnerableStableId(
    input.sourceOperationId,
    'Cleanup source operation ID',
  )
  const causalParentEventId = input.causalParentEventId ?? null
  if (causalParentEventId !== null) {
    assertMoveSemiInvulnerableStableId(
      causalParentEventId,
      'Cleanup causal parent event ID',
    )
  }
  if (!CLEANUP_REASON_SET.has(input.reasonCode)) {
    return failMoveSemiInvulnerableSetup(
      'invalid-cleanup',
      'Semi-invulnerable cleanup reason is unsupported.',
    )
  }
  const effects = input.retainedEffectIds
    ? input.group.effects.filter(effect => input.retainedEffectIds!.has(effect.id))
    : input.group.effects
  return parseEncounterEvents(effects.map((effect, index): EncounterEffectRemovedEvent => ({
    schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
    eventId: deriveMoveSemiInvulnerableId(
      'event.semi-invulnerable.cleanup',
      sourceOperationId,
      input.group.setupOperationId,
      effect.id,
      String(index),
    ),
    kind: 'effect-removed',
    sourceOperationId,
    causalParentEventId,
    reasonCode: input.reasonCode,
    effectId: effect.id,
  })), 'semiInvulnerable.cleanupEvents') as readonly EncounterEffectRemovedEvent[]
}

/** Build the exact all-participant cleanup batch for resolve or explicit cancel. */
export const createMoveSemiInvulnerableCleanupEvents = (input: {
  readonly effects: readonly EncounterEffect[]
  readonly setupOperationId: string
  readonly sourceOperationId: string
  readonly reasonCode: MoveSemiInvulnerableCleanupReason
  readonly causalParentEventId?: string | null
}): readonly EncounterEffectRemovedEvent[] => cleanupEventsForGroup({
  group: moveSemiInvulnerableSetupGroup(input.effects, input.setupOperationId),
  sourceOperationId: input.sourceOperationId,
  reasonCode: input.reasonCode,
  causalParentEventId: input.causalParentEventId,
})

const sourceLeavingPlacementId = (event: EncounterEvent): string | null => {
  if (event.kind === 'move-ko' || event.kind === 'lifecycle-ko') return event.targetPlacementId
  if (event.kind === 'recall') return event.placementId
  if (event.kind === 'switch') return event.recalledPlacementId
  return null
}

const normalizedMoveId = (value: string): string => value.trim().toLowerCase()

const interruptCancelledGroups = (
  event: EncounterEvent,
  effects: readonly EncounterEffect[],
): readonly MoveSemiInvulnerableSetupGroup[] => {
  if (event.kind !== 'move-hit') return []
  return parseMoveSemiInvulnerableSetupGroups(effects).filter(group => (
    group.actorPlacementId === event.targetPlacementId
    && group.definition.userTargetingExceptions.some(exception => (
      exception.timing === 'interrupt'
      && exception.cancelsSetupOnHit
      && normalizedMoveId(exception.canonicalMoveId)
        === normalizedMoveId(event.move.canonicalId)
    ))
  ))
}

/**
 * Remove linked setup effects when either participant leaves or is knocked out.
 * Scene-duration cleanup remains owned by the ordinary scene-end lifecycle.
 * Removing one effect through another audited cancellation also removes its
 * retained counterpart, so Sky Drop cannot leave either participant stranded.
 */
export const createMoveSemiInvulnerableLifecycleHandler = (): EncounterLifecycleTriggerHandler => Object.freeze({
  id: 'handler.semi-invulnerable-cleanup',
  resolve: (context: Parameters<EncounterLifecycleTriggerHandler['resolve']>[0]) => {
    const { event, state, effectsAtEventStart } = context
    if (event.kind === 'scene-end') return []

    if (event.kind === 'effect-removed') {
      if (CLEANUP_REASON_SET.has(event.reasonCode)) return []
      const removed = effectsAtEventStart.find(effect => effect.id === event.effectId)
      if (!removed || !removed.tags.includes(MOVE_SEMI_INVULNERABLE_EFFECT_TAG)) return []
      const group = moveSemiInvulnerableSetupGroup(
        effectsAtEventStart,
        removed.source.operationId,
      )
      const retainedIds = new Set(state.effects.map(effect => effect.id))
      const emittedEvents = cleanupEventsForGroup({
        group,
        sourceOperationId: event.sourceOperationId,
        reasonCode: 'semi-invulnerable.linked-effect-removed',
        causalParentEventId: event.eventId,
        retainedEffectIds: retainedIds,
      })
      return emittedEvents.length === 0 ? [] : [deepFreezeMoveSemiInvulnerable({
        effectId: null,
        reasonCode: 'semi-invulnerable.linked-effect-removed',
        operations: [],
        emittedEvents,
      })]
    }

    const interrupted = interruptCancelledGroups(event, state.effects)
    if (interrupted.length > 0) {
      const emittedEvents = interrupted.flatMap(group => cleanupEventsForGroup({
        group,
        sourceOperationId: event.sourceOperationId,
        reasonCode: 'semi-invulnerable.cancelled',
        causalParentEventId: event.eventId,
      }))
      return [deepFreezeMoveSemiInvulnerable({
        effectId: null,
        reasonCode: 'semi-invulnerable.cancelled',
        operations: [],
        emittedEvents,
      })]
    }

    const leavingPlacementId = sourceLeavingPlacementId(event)
    if (leavingPlacementId === null) return []
    const groups = parseMoveSemiInvulnerableSetupGroups(state.effects).filter(group => (
      group.actorPlacementId === leavingPlacementId
      || group.carriedTargetPlacementId === leavingPlacementId
    ))
    if (groups.length === 0) return []
    const emittedEvents = groups.flatMap(group => cleanupEventsForGroup({
      group,
      sourceOperationId: event.sourceOperationId,
      reasonCode: 'semi-invulnerable.source-left',
      causalParentEventId: event.eventId,
    }))
    return [deepFreezeMoveSemiInvulnerable({
      effectId: null,
      reasonCode: 'semi-invulnerable.source-left',
      operations: [],
      emittedEvents,
    })]
  },
})
