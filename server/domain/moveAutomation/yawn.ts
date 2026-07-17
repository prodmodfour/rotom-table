import { createHash } from 'node:crypto'
import type {
  EncounterConditionEffect,
  EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvents,
  type EncounterEffectRemovedEvent,
  type EncounterEvent,
} from '#shared/moveAutomation/events'
import {
  parseMoveEffectOperation,
  type MoveConditionEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import { deepCloneJson } from '~/utils/serialization'
import { applyEncounterEffectLifecycleEvent } from './effectLifecycle'
import type { EncounterLifecycleTriggerHandler } from './reduceLifecycle'

export const YAWN_MOVE_SOURCE_ID = 'move.yawn' as const
export const YAWN_DROWSY_EFFECT_BASE_ID = 'yawn.drowsy' as const
export const YAWN_LIFECYCLE_HANDLER_ID = 'handler.yawn-delayed-sleep' as const
export const YAWN_SLEEP_REASON_CODE = 'yawn.delayed-sleep' as const

const YAWN_OPERATION_ID = 'yawn.drowsy' as const

const digest = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000'))
  .digest('hex')
  .slice(0, 32)

/** Identify only the reviewed target-linked effect emitted by the native Yawn spec. */
export const isYawnDrowsyEffect = (
  effect: EncounterEffect,
): effect is EncounterConditionEffect => (
  effect.kind === 'condition'
  && effect.source.moveId === YAWN_MOVE_SOURCE_ID
  && effect.source.operationId === YAWN_OPERATION_ID
  && effect.payload.action === 'apply'
  && effect.payload.conditionId === 'yawn'
  && effect.duration.kind === 'turns'
  && effect.duration.subject === 'target'
  && effect.duration.boundary === 'end'
)

const sleepOperation = (input: {
  readonly eventId: string
  readonly effectId: string
}): MoveConditionEffectOperation => parseMoveEffectOperation({
  id: `yawn.sleep.${digest(input.eventId, input.effectId)}`,
  kind: 'condition',
  source: { kind: 'encounter-effect', id: input.effectId },
  recipients: { kind: 'selected-targets' },
  phase: 'cleanup',
  reasonCode: YAWN_SLEEP_REASON_CODE,
  payload: {
    action: 'apply',
    conditionId: 'sleep',
    conditionSource: null,
    filter: null,
    randomChoice: null,
    duration: null,
    saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
}, `yawn.sleepOperation.${input.effectId}`) as MoveConditionEffectOperation

const endingTarget = (event: EncounterEvent): {
  readonly placementId: string | null
  readonly reasonCode: string
} | null => {
  if (event.kind === 'move-ko') {
    return {
      placementId: event.targetPlacementId,
      reasonCode: 'yawn.cleanup.target-knocked-out',
    }
  }
  if (event.kind === 'recall') {
    return {
      placementId: event.placementId,
      reasonCode: 'yawn.cleanup.target-recalled',
    }
  }
  if (event.kind === 'switch') {
    return {
      placementId: event.recalledPlacementId,
      reasonCode: 'yawn.cleanup.target-switched',
    }
  }
  if (event.kind === 'scene-end') {
    return {
      placementId: null,
      reasonCode: 'yawn.cleanup.scene-ended',
    }
  }
  return null
}

const cleanupEvents = (input: {
  readonly event: EncounterEvent
  readonly effects: readonly EncounterEffect[]
  readonly placementId: string | null
  readonly reasonCode: string
}): readonly EncounterEffectRemovedEvent[] => parseEncounterEvents(
  input.effects.filter(effect => (
    isYawnDrowsyEffect(effect)
    && (
      input.placementId === null
      || effect.affected.placementIds.includes(input.placementId)
    )
  )).map((effect): EncounterEffectRemovedEvent => ({
    schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
    eventId: `event.yawn.cleanup.${digest(input.event.eventId, effect.id, input.reasonCode)}`,
    kind: 'effect-removed',
    sourceOperationId: input.event.sourceOperationId,
    causalParentEventId: input.event.eventId,
    reasonCode: input.reasonCode,
    effectId: effect.id,
  })),
  'yawn.cleanupEvents',
) as readonly EncounterEffectRemovedEvent[]

/**
 * Resolve Yawn from authoritative game facts only.
 *
 * The first target turn-end after application enqueues one ordinary typed Sleep
 * operation; the shared condition reducer then rechecks current sheet, aura,
 * terrain, and encounter-effect immunity. The turn duration removes Yawn after
 * that attempt. Target KO/recall/switch and scene end instead emit exact typed
 * removals without applying Sleep. Source departure does not cancel Yawn.
 */
export const createYawnLifecycleHandler = (): EncounterLifecycleTriggerHandler => Object.freeze({
  id: YAWN_LIFECYCLE_HANDLER_ID,
  resolve: ({ event, state }: Parameters<EncounterLifecycleTriggerHandler['resolve']>[0]) => {
    if (event.kind === 'turn-end') {
      return state.effects.filter(effect => (
        isYawnDrowsyEffect(effect)
        && effect.suppression.sources.length === 0
        && effect.affected.placementIds.includes(event.placementId)
      )).map(effect => ({
        effectId: effect.id,
        reasonCode: 'yawn.target-turn-ended',
        operations: [sleepOperation({ eventId: event.eventId, effectId: effect.id })],
        emittedEvents: [],
      }))
    }

    const ending = endingTarget(event)
    if (!ending) return []
    const emittedEvents = cleanupEvents({
      event,
      effects: state.effects,
      placementId: ending.placementId,
      reasonCode: ending.reasonCode,
    })
    return emittedEvents.length === 0
      ? []
      : [{
          effectId: null,
          reasonCode: ending.reasonCode,
          operations: [],
          emittedEvents,
        }]
  },
})

export interface YawnKnockoutCleanupResult {
  readonly map: TabletopMap
  readonly changed: boolean
  readonly removedEffectIds: readonly string[]
}

/**
 * Immediate move planning already owns server-resolved KO recipients before a
 * separate lifecycle-event commit exists. Remove only Yawn effects addressing
 * those recipients so a fainted target cannot retain or later trigger drowsy.
 */
export const cleanupYawnEffectsForKnockouts = (input: {
  readonly map: TabletopMap
  readonly placementIds: readonly string[]
}): YawnKnockoutCleanupResult => {
  const map = deepCloneJson(input.map)
  const placementIds = new Set(input.placementIds)
  let state = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  const removedEffectIds = state.effects.flatMap(effect => (
    isYawnDrowsyEffect(effect)
    && effect.affected.placementIds.some(placementId => placementIds.has(placementId))
      ? [effect.id]
      : []
  ))

  for (const effectId of removedEffectIds) {
    const result = applyEncounterEffectLifecycleEvent(
      { effects: state.effects },
      { kind: 'effect-removed', effectId },
    )
    state = parseEncounterState({ ...state, effects: result.effects })
  }
  if (removedEffectIds.length > 0) map.encounterState = state

  return Object.freeze({
    map,
    changed: removedEffectIds.length > 0,
    removedEffectIds: Object.freeze(removedEffectIds),
  })
}
