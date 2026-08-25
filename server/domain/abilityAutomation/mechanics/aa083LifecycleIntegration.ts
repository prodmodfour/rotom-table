import { createHash } from 'node:crypto'
import { ENCOUNTER_EVENT_SCHEMA_VERSION, parseEncounterEvents, type EncounterEffectRemovedEvent } from '#shared/moveAutomation/events'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import {
  parseMoveEffectOperation,
  type MoveConditionEffectOperation,
  type MoveDirectHpEffectOperation,
  type MoveHealEffectOperation,
} from '#shared/moveAutomation/effects'
import type { TabletopMap } from '~/types/map'
import type {
  EncounterLifecycleTrigger,
  EncounterLifecycleTriggerContext,
  EncounterLifecycleTriggerHandler,
} from '../../moveAutomation/reduceLifecycle'
import { AA083_PERISH_COUNT_TAG, AA083_POISON_HEAL_TAG } from './aa083MoveIntegration'

export const AA083_PERISH_BODY_FAINT_REASON = 'ability.perish-body.count-zero' as const
export const AA083_POISON_HEAL_TICK_REASON = 'ability.poison-heal.turn-start-tick' as const
export const AA083_POISON_HEAL_CURE_REASON = 'ability.poison-heal.encounter-end-cure' as const

const digest = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const activeTaggedEffect = (effect: EncounterEffect, tag: string): boolean => (
  effect.kind === 'capability'
  && effect.tags.includes(tag)
  && effect.suppression.sources.length === 0
  && (effect.duration.remaining === null || effect.duration.remaining > 0)
)

const perishFaint = (eventId: string, effect: EncounterEffect): MoveDirectHpEffectOperation => (
  parseMoveEffectOperation({
    id: `ability.perish-body.faint.${digest(eventId, effect.id)}`,
    kind: 'direct-hp', source: { kind: 'encounter-effect', id: effect.id },
    recipients: { kind: 'selected-targets' }, phase: 'cleanup',
    reasonCode: AA083_PERISH_BODY_FAINT_REASON,
    payload: {
      mode: 'set', pool: 'hit-points', calculation: { kind: 'fixed', value: 0 },
      copySource: null, bounds: { minimum: null, maximum: null }, rounding: 'floor',
      applyTypeImmunity: false, cost: null,
      injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
    },
  }, `aa083.perishBody.${effect.id}`) as MoveDirectHpEffectOperation
)

const poisonHealTick = (eventId: string, effect: EncounterEffect): MoveHealEffectOperation => (
  parseMoveEffectOperation({
    id: `ability.poison-heal.tick.${digest(eventId, effect.id)}`,
    kind: 'heal', source: { kind: 'encounter-effect', id: effect.id },
    recipients: { kind: 'selected-targets' }, phase: 'cleanup',
    reasonCode: AA083_POISON_HEAL_TICK_REASON,
    payload: {
      mode: 'gain', pool: 'hit-points',
      calculation: { kind: 'percent-max', percent: 10 },
      bounds: { minimum: null, maximum: null }, rounding: 'floor',
      injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
    },
  }, `aa083.poisonHeal.tick.${effect.id}`) as MoveHealEffectOperation
)

const poisonHealCure = (eventId: string, effect: EncounterEffect): MoveConditionEffectOperation => (
  parseMoveEffectOperation({
    id: `ability.poison-heal.cure.${digest(eventId, effect.id)}`,
    kind: 'condition', source: { kind: 'encounter-effect', id: effect.id },
    recipients: { kind: 'selected-targets' }, phase: 'cleanup',
    reasonCode: AA083_POISON_HEAL_CURE_REASON,
    payload: {
      action: 'clear', conditionId: null, conditionSource: null,
      filter: {
        groups: [], conditionIds: ['poisoned', 'badly-poisoned'], excludedConditionIds: [],
      },
      randomChoice: null, duration: null, saveTiming: 'canonical',
      stackPolicy: { kind: 'refresh', maxStacks: null },
    },
  }, `aa083.poisonHeal.cure.${effect.id}`) as MoveConditionEffectOperation
)

const cleanupPlacementId = (
  event: EncounterLifecycleTriggerContext['event'],
): string | null => event.kind === 'recall'
  ? event.placementId
  : event.kind === 'move-ko' || event.kind === 'lifecycle-ko'
    ? event.targetPlacementId
    : null

const removalEvents = (input: {
  readonly context: EncounterLifecycleTriggerContext
  readonly placementId: string
}): readonly EncounterEffectRemovedEvent[] => parseEncounterEvents(
  input.context.effectsAtEventStart.filter(effect => (
    activeTaggedEffect(effect, AA083_PERISH_COUNT_TAG)
    && effect.affected.placementIds.includes(input.placementId)
  )).map((effect): EncounterEffectRemovedEvent => ({
    schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
    eventId: `event.perish-body.cleanup.${digest(input.context.event.eventId, effect.id)}`,
    kind: 'effect-removed',
    sourceOperationId: input.context.event.sourceOperationId,
    causalParentEventId: input.context.event.eventId,
    reasonCode: 'ability.perish-body.clear-on-recall-or-knockout',
    effectId: effect.id,
  })),
  'aa083.perishBody.removalEvents',
) as readonly EncounterEffectRemovedEvent[]

/** Perish Count and activated Poison Heal encounter-boundary semantics. */
export const createAa083LifecycleHandler = (input: {
  readonly poisonedPlacementIds: ReadonlySet<string>
  readonly effectivePoisonHealPlacementIds: ReadonlySet<string>
}): EncounterLifecycleTriggerHandler => Object.freeze({
  id: 'aa083.perish-poison-heal.lifecycle',
  resolve: (context: EncounterLifecycleTriggerContext): readonly EncounterLifecycleTrigger[] => {
    const event = context.event
    const cleanupId = cleanupPlacementId(event)
    if (cleanupId) {
      const emittedEvents = removalEvents({ context, placementId: cleanupId })
      return emittedEvents.length > 0 ? [{
        effectId: null,
        reasonCode: 'ability.perish-body.clear-on-recall-or-knockout',
        operations: [], emittedEvents,
      }] : []
    }
    if (event.kind === 'turn-start') {
      return context.effectsAtEventStart.flatMap((effect): EncounterLifecycleTrigger[] => {
        if (!effect.affected.placementIds.includes(event.placementId)) return []
        if (activeTaggedEffect(effect, AA083_PERISH_COUNT_TAG)
          && effect.duration.kind === 'turns'
          && effect.duration.remaining === 1) {
          return [{
            effectId: effect.id,
            reasonCode: AA083_PERISH_BODY_FAINT_REASON,
            operations: [perishFaint(event.eventId, effect)], emittedEvents: [],
          }]
        }
        if (activeTaggedEffect(effect, AA083_POISON_HEAL_TAG)
          && input.poisonedPlacementIds.has(event.placementId)
          && input.effectivePoisonHealPlacementIds.has(event.placementId)) {
          return [{
            effectId: effect.id,
            reasonCode: AA083_POISON_HEAL_TICK_REASON,
            operations: [poisonHealTick(event.eventId, effect)], emittedEvents: [],
          }]
        }
        return []
      })
    }
    if (event.kind === 'scene-end') {
      return context.effectsAtEventStart.flatMap((effect): EncounterLifecycleTrigger[] => (
        activeTaggedEffect(effect, AA083_POISON_HEAL_TAG)
        && effect.affected.placementIds.some(placementId => input.poisonedPlacementIds.has(placementId))
          ? [{
              effectId: effect.id,
              reasonCode: AA083_POISON_HEAL_CURE_REASON,
              operations: [poisonHealCure(event.eventId, effect)], emittedEvents: [],
            }]
          : []
      ))
    }
    return []
  },
})

/** Take a Breather clears Perish Count outside encounter event reduction. */
export const clearAa083PerishCount = (
  map: TabletopMap,
  placementId: string,
): TabletopMap => {
  const encounter = map.encounterState
  if (!encounter) return map
  const effects = encounter.effects.filter(effect => !(
    activeTaggedEffect(effect, AA083_PERISH_COUNT_TAG)
    && effect.affected.placementIds.includes(placementId)
  ))
  return effects.length === encounter.effects.length
    ? map
    : { ...map, encounterState: { ...encounter, effects } }
}

export const clearAa083PerishCountForBreather = clearAa083PerishCount

export const aa083PoisonHealActive = (map: Pick<TabletopMap, 'encounterState'>, placementId: string): boolean => (
  map.encounterState?.effects.some(effect => (
    activeTaggedEffect(effect, AA083_POISON_HEAL_TAG)
    && effect.affected.placementIds.includes(placementId)
  )) === true
)
