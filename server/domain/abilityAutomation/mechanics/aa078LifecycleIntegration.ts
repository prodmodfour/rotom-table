import { createHash } from 'node:crypto'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import {
  parseMoveEffectOperation,
  type MoveDirectHpEffectOperation,
  type MoveHealEffectOperation,
} from '#shared/moveAutomation/effects'
import type {
  EncounterLifecycleTriggerHandler,
  EncounterLifecycleTrigger,
  EncounterLifecycleTriggerContext,
} from '../../moveAutomation/reduceLifecycle'

export const AA078_LEECH_SEED_LOSS_REASON = 'move.leech-seed.turn-start-loss' as const
export const AA078_LEECH_SEED_HEAL_REASON = 'move.leech-seed.turn-start-heal' as const
export const AA078_LIQUID_OOZE_LEECH_SEED_REASON = 'ability.liquid-ooze.leech-seed-reversal' as const

const digest = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const leechSeedEffect = (effect: EncounterEffect): boolean => effect.kind === 'condition'
  && effect.tags.includes('leech-seed')
  && effect.tags.includes('seeded')
  && effect.payload.conditionId === 'seeded'
  && effect.suppression.sources.length === 0

const directLoss = (input: {
  readonly eventId: string
  readonly effect: EncounterEffect
  readonly liquidOozeTick: number | null
}): MoveDirectHpEffectOperation => parseMoveEffectOperation({
  id: `leech-seed.loss.${digest(input.eventId, input.effect.id)}`,
  kind: 'direct-hp',
  source: { kind: 'encounter-effect', id: input.effect.id },
  recipients: { kind: input.liquidOozeTick === null ? 'selected-targets' : 'source-placement' },
  phase: 'cleanup',
  reasonCode: input.liquidOozeTick === null
    ? AA078_LEECH_SEED_LOSS_REASON
    : AA078_LIQUID_OOZE_LEECH_SEED_REASON,
  payload: {
    mode: 'lose', pool: 'hit-points',
    calculation: input.liquidOozeTick === null
      ? { kind: 'percent-max', percent: 10 }
      : { kind: 'fixed', value: input.liquidOozeTick },
    copySource: null,
    bounds: { minimum: null, maximum: null },
    rounding: 'floor',
    applyTypeImmunity: false,
    cost: null,
    injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
  },
}, `aa078.leechSeed.loss.${input.effect.id}`) as MoveDirectHpEffectOperation

const sourceHeal = (input: {
  readonly eventId: string
  readonly effect: EncounterEffect
  readonly lossOperationId: string
}): MoveHealEffectOperation => parseMoveEffectOperation({
  id: `leech-seed.heal.${digest(input.eventId, input.effect.id)}`,
  kind: 'heal',
  source: { kind: 'encounter-effect', id: input.effect.id },
  recipients: { kind: 'source-placement' },
  phase: 'cleanup',
  reasonCode: AA078_LEECH_SEED_HEAL_REASON,
  payload: {
    mode: 'gain', pool: 'hit-points',
    calculation: {
      kind: 'hp-lost', hpOperationId: input.lossOperationId,
      pool: 'hit-points', percent: 100, aggregation: 'aggregate',
    },
    bounds: { minimum: null, maximum: null },
    rounding: 'floor',
    injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  },
}, `aa078.leechSeed.heal.${input.effect.id}`) as MoveHealEffectOperation

/** Turn-start Leech Seed transfer with exact effective Liquid Ooze reversal. */
export const createAa078LeechSeedLifecycleHandler = (input: {
  readonly liquidOozeTickByPlacementId: ReadonlyMap<string, number>
}): EncounterLifecycleTriggerHandler => Object.freeze({
  id: 'aa078.leech-seed.lifecycle',
  resolve: (context: EncounterLifecycleTriggerContext): readonly EncounterLifecycleTrigger[] => {
    const event = context.event
    if (event.kind !== 'turn-start') return Object.freeze([])
    const triggers = context.effectsAtEventStart.flatMap((effect: EncounterEffect): EncounterLifecycleTrigger[] => {
      if (!leechSeedEffect(effect)
        || !effect.affected.placementIds.includes(event.placementId)) return []
      const liquidOozeTick = input.liquidOozeTickByPlacementId.get(event.placementId) ?? null
      const loss = directLoss({ eventId: event.eventId, effect, liquidOozeTick })
      return [{
        effectId: null,
        reasonCode: liquidOozeTick === null
          ? AA078_LEECH_SEED_LOSS_REASON
          : AA078_LIQUID_OOZE_LEECH_SEED_REASON,
        operations: liquidOozeTick === null
          ? [loss, sourceHeal({
              eventId: event.eventId,
              effect,
              lossOperationId: loss.id,
            })]
          : [loss],
        emittedEvents: [],
      }]
    })
    return Object.freeze(triggers)
  },
})
