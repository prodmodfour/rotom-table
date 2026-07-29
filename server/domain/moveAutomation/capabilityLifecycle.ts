import { createHash } from 'node:crypto'
import { parseMoveEffectOperation, type MoveDirectHpEffectOperation } from '#shared/moveAutomation/effects'
import type { EncounterCapabilityEffect } from '#shared/moveAutomation/encounterEffects'
import type { EncounterLifecycleTriggerContext, EncounterLifecycleTriggerHandler } from './reduceLifecycle'

export const CAPABILITY_LIFECYCLE_HANDLER_ID = 'handler.capability-runtime' as const

const digest = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 32)

const isIntangiblePhasingMarker = (effect: unknown): effect is EncounterCapabilityEffect => {
  const candidate = effect as EncounterCapabilityEffect
  return candidate?.kind === 'capability'
    && candidate.payload?.capabilityId === 'runtime-mode.phasing'
    && candidate.tags?.includes('capability-mode.intangible') === true
    && candidate.suppression?.sources.length === 0
}

const isCapabilityWeaponBleed = (effect: unknown): effect is EncounterCapabilityEffect => {
  const candidate = effect as EncounterCapabilityEffect
  return candidate?.kind === 'capability'
    && candidate.payload?.capabilityId === 'weapon-move-bleed'
    && candidate.tags?.includes('capability-weapon-move') === true
    && candidate.tags?.includes('start-turn-tick') === true
    && candidate.duration.kind === 'turns'
    && candidate.duration.subject === 'target'
    && candidate.duration.boundary === 'start'
    && candidate.suppression?.sources.length === 0
}

const percentTick = (input: {
  readonly eventId: string
  readonly effect: EncounterCapabilityEffect
  readonly reasonCode: string
  readonly idPrefix?: string
}): MoveDirectHpEffectOperation => (
  parseMoveEffectOperation({
    id: `${input.idPrefix ?? input.reasonCode}.${digest(input.eventId, input.effect.id)}`,
    kind: 'direct-hp',
    source: { kind: 'encounter-effect', id: input.effect.id },
    recipients: { kind: 'selected-targets' },
    phase: 'cleanup',
    reasonCode: input.reasonCode,
    payload: {
      mode: 'lose', pool: 'hit-points', calculation: { kind: 'percent-max', percent: 10 },
      copySource: null, bounds: { minimum: 1, maximum: null }, rounding: 'floor',
      applyTypeImmunity: false, cost: null,
      injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
    },
  }, `${input.reasonCode}.${input.effect.id}`) as MoveDirectHpEffectOperation
)

const phasingTick = (eventId: string, effect: EncounterCapabilityEffect): MoveDirectHpEffectOperation => (
  percentTick({
    eventId,
    effect,
    reasonCode: 'capability.phasing.round-end-tick',
    idPrefix: 'capability.phasing.tick',
  })
)

/** Native round-boundary consequences retained by Capability-owned encounter markers. */
export const createCapabilityLifecycleHandler = (
  activeEffectIds: ReadonlySet<string>,
): EncounterLifecycleTriggerHandler => Object.freeze({
  id: CAPABILITY_LIFECYCLE_HANDLER_ID,
  resolve: (context: EncounterLifecycleTriggerContext) => {
    if (context.event.kind === 'round-end') {
      return context.state.effects.filter((effect): effect is EncounterCapabilityEffect => (
        isIntangiblePhasingMarker(effect) && activeEffectIds.has(effect.id)
      )).map((effect: EncounterCapabilityEffect) => ({
        effectId: effect.id,
        reasonCode: 'capability.phasing.round-end-trigger',
        operations: [phasingTick(context.event.eventId, effect)],
        emittedEvents: [],
      }))
    }
    if (context.event.kind === 'turn-start') {
      const placementId = context.event.placementId
      return context.state.effects.filter((effect): effect is EncounterCapabilityEffect => (
        isCapabilityWeaponBleed(effect)
        && effect.affected.placementIds.includes(placementId)
        && (effect.duration.remaining === null || effect.duration.remaining > 0)
      )).map(effect => ({
        effectId: effect.id,
        reasonCode: 'capability.weapon-move.bleed-start-turn-trigger',
        operations: [percentTick({
          eventId: context.event.eventId,
          effect,
          reasonCode: 'capability.weapon-move.bleed-start-turn-tick',
        })],
        emittedEvents: [],
      }))
    }
    return []
  },
})
