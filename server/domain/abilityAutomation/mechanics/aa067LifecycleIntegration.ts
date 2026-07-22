import { createHash } from 'node:crypto'
import {
  parseMoveEffectOperation,
  type MoveDirectHpEffectOperation,
  type MoveHealEffectOperation,
} from '#shared/moveAutomation/effects'
import { parseEncounterEffect, type EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { MoveResolutionAuditTrace } from '#shared/moveAutomation/trace'
import type { TabletopMap } from '~/types/map'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type {
  EncounterLifecycleTrigger,
  EncounterLifecycleTriggerHandler,
} from '../../moveAutomation/reduceLifecycle'
import { aa067DelayedReactionSplit } from './aa067StaticIntegration'

export const AA067_DELAYED_REACTION_CAPABILITY_ID = 'aa067.delayed-reaction.hp-loss' as const
export const AA067_DESERT_WEATHER_TEMP_HP_REASON = 'ability.desert-weather.rainy-turn-end' as const
export const AA067_DELAYED_REACTION_HP_REASON = 'ability.delayed-reaction.deferred-hp-loss' as const
const hash = (...values: readonly string[]): string => createHash('sha256').update(values.join('\u0000')).digest('hex').slice(0, 28)

interface DelayedDebt { readonly recipientId: string; readonly amount: number; readonly sourceOperationId: string }

export class Aa067LifecycleIntegrationError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa067LifecycleIntegrationError' }
}
const fail = (detail: string): never => { throw new Aa067LifecycleIntegrationError(detail) }

const delayedDebts = (trace: MoveResolutionAuditTrace): readonly DelayedDebt[] => {
  const selected = new Set(trace.events.flatMap(event => event.kind === 'operation'
    && event.reasonCode === 'ability.delayed-reaction.optional-half' && event.outcome === 'applied'
    ? event.recipientIds : []))
  const debts = new Map<string, DelayedDebt>()
  for (const event of trace.events) {
    if (event.kind !== 'operation' || event.operationKind !== 'damage'
      || !event.result || typeof event.result !== 'object' || Array.isArray(event.result)) continue
    const recipients = (event.result as { recipients?: unknown }).recipients
    if (!Array.isArray(recipients)) continue
    for (const value of recipients) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const recipientId = (value as { recipientId?: unknown }).recipientId
      const details = (value as { details?: unknown }).details
      if (typeof recipientId !== 'string' || !selected.has(recipientId)
        || !details || typeof details !== 'object' || Array.isArray(details)) continue
      const calculation = (details as { calculation?: unknown }).calculation
      const pipeline = calculation && typeof calculation === 'object' && !Array.isArray(calculation)
        ? (calculation as { damagePipeline?: unknown }).damagePipeline : null
      const stages = pipeline && typeof pipeline === 'object' && !Array.isArray(pipeline)
        ? (pipeline as { stages?: unknown }).stages : null
      if (!Array.isArray(stages)) continue
      const modifiers = stages.flatMap(stage => stage && typeof stage === 'object' && !Array.isArray(stage)
        && Array.isArray((stage as { modifiers?: unknown }).modifiers)
        ? (stage as { modifiers: unknown[] }).modifiers : [])
      const modifier = modifiers.find(candidate => candidate && typeof candidate === 'object'
        && !Array.isArray(candidate)
        && (candidate as { reasonCode?: unknown }).reasonCode === 'ability.delayed-reaction.immediate-half')
      if (!modifier || typeof modifier !== 'object' || Array.isArray(modifier)) continue
      const before = (modifier as { input?: unknown }).input
      const after = (modifier as { output?: unknown }).output
      if (!Number.isSafeInteger(before) || Number(before) < 0 || !Number.isSafeInteger(after)) continue
      const split = aa067DelayedReactionSplit(Number(before))
      if (after !== split.immediate) fail('Delayed Reaction damage trace no longer matches its reviewed split.')
      const amount = split.deferred
      if (amount <= 0) continue
      if (amount > 1_000_000) fail('Delayed Reaction HP debt exceeds the bounded encounter-effect value.')
      const existing = debts.get(recipientId)
      const combined = (existing?.amount ?? 0) + amount
      if (!Number.isSafeInteger(combined) || combined > 1_000_000) {
        fail('Combined Delayed Reaction HP debt exceeds the bounded encounter-effect value.')
      }
      debts.set(recipientId, {
        recipientId, amount: combined, sourceOperationId: event.operationId,
      })
    }
  }
  return Object.freeze([...debts.values()])
}

/** Persist the exact post-mitigation remainder as one map-owned debt per recipient. */
export const applyAa067DelayedReactionDebts = (input: {
  readonly map: TabletopMap
  readonly context: AuthoritativeMoveRulesContext
  readonly trace: MoveResolutionAuditTrace
  readonly operationId: string
}): TabletopMap => {
  const debts = delayedDebts(input.trace)
  if (debts.length === 0) return input.map
  const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const effects: EncounterEffect[] = []
  for (const debt of debts) {
    if (!input.context.queries.abilities.has(debt.recipientId, 'Delayed Reaction')) continue
    effects.push(parseEncounterEffect({
      id: `ability.delayed-reaction.${hash(input.operationId, debt.sourceOperationId, debt.recipientId)}`,
      kind: 'capability',
      source: { operationId: debt.sourceOperationId, moveId: 'ability.delayed-reaction', placementId: debt.recipientId },
      affected: { placementIds: [debt.recipientId], sideIds: [], cells: [] },
      createdRound: Math.max(1, input.map.initiative?.round ?? 1),
      createdTurn: encounter.history.currentTurn?.turn ?? 0,
      duration: {
        kind: 'turns', subject: 'target', boundary: 'end',
        remaining: encounter.history.currentTurn?.placementId === debt.recipientId ? 2 : 1,
      },
      stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'aa067', 'delayed-reaction', 'deferred-hp-loss'],
      payload: { capabilityId: AA067_DELAYED_REACTION_CAPABILITY_ID, action: 'grant', value: debt.amount },
      dispel: { policy: 'matching-tags', tags: ['delayed-reaction', 'deferred-hp-loss'] },
      transferPolicy: 'retain', suppression: { sources: [] },
    }, `ability.delayedReaction.debt.${debt.recipientId}`))
  }
  return effects.length === 0 ? input.map : {
    ...input.map,
    encounterState: parseEncounterState({ ...encounter, effects: [...encounter.effects, ...effects] }),
  }
}

const debtOperation = (eventId: string, effect: EncounterEffect): MoveDirectHpEffectOperation => {
  const amount = effect.kind === 'capability' && effect.payload.capabilityId === AA067_DELAYED_REACTION_CAPABILITY_ID
    ? effect.payload.value ?? 0 : 0
  return parseMoveEffectOperation({
    id: `ability.delayed-reaction.hp.${hash(eventId, effect.id)}`,
    kind: 'direct-hp', source: { kind: 'encounter-effect', id: effect.id },
    recipients: { kind: 'area-targets' }, phase: 'cleanup', reasonCode: AA067_DELAYED_REACTION_HP_REASON,
    payload: {
      mode: 'lose', pool: 'hit-points', calculation: { kind: 'fixed', value: amount },
      copySource: null, bounds: { minimum: null, maximum: null }, rounding: 'floor',
      applyTypeImmunity: false, cost: null,
      injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
    },
  }, 'ability.delayedReaction.deferredHp') as MoveDirectHpEffectOperation
}

const rainyTempHpOperation = (eventId: string): MoveHealEffectOperation => parseMoveEffectOperation({
  id: `ability.desert-weather.temp-hp.${hash(eventId)}`,
  kind: 'heal', source: { kind: 'lifecycle-event', id: eventId }, recipients: { kind: 'actor' },
  phase: 'cleanup', reasonCode: AA067_DESERT_WEATHER_TEMP_HP_REASON,
  payload: {
    mode: 'gain', pool: 'temporary-hit-points', calculation: { kind: 'percent-max', percent: 10 },
    bounds: { minimum: null, maximum: null }, rounding: 'floor',
    injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  },
}, 'ability.desertWeather.rainyTempHp') as MoveHealEffectOperation

export const createAa067LifecycleHandler = (input: {
  readonly effects: readonly EncounterEffect[]
  readonly rainyDesertWeatherPlacementIds: readonly string[]
}): EncounterLifecycleTriggerHandler => {
  const rainy = new Set(input.rainyDesertWeatherPlacementIds)
  const debts = input.effects.filter(effect => effect.kind === 'capability'
    && effect.payload.capabilityId === AA067_DELAYED_REACTION_CAPABILITY_ID
    && effect.suppression.sources.length === 0)
  return Object.freeze({
    id: 'handler.ability.aa067.lifecycle',
    resolve: ({ event }: Parameters<EncounterLifecycleTriggerHandler['resolve']>[0]) => {
      if (event.kind !== 'turn-end') return []
      const triggers: EncounterLifecycleTrigger[] = debts.filter(effect => (
        effect.affected.placementIds.includes(event.placementId)
        && effect.duration.kind === 'turns'
        && effect.duration.subject === 'target'
        && effect.duration.boundary === 'end'
        && effect.duration.remaining === 1
      )).map(effect => ({
        effectId: effect.id,
        reasonCode: `${AA067_DELAYED_REACTION_HP_REASON}-trigger`,
        operations: [debtOperation(event.eventId, effect)], emittedEvents: [],
      }))
      if (rainy.has(event.placementId)) triggers.push({
        effectId: null,
        reasonCode: `${AA067_DESERT_WEATHER_TEMP_HP_REASON}-trigger`,
        operations: [rainyTempHpOperation(event.eventId)], emittedEvents: [],
      })
      return triggers
    },
  })
}

export const aa067LifecycleRecipientIds = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: { readonly kind: string; readonly reasonCode: string }
  readonly candidateRecipientIds: readonly string[]
}): readonly string[] => input.operation.reasonCode === AA067_DESERT_WEATHER_TEMP_HP_REASON
  ? input.candidateRecipientIds.filter(id => input.context.queries.abilities.has(id, 'Desert Weather'))
  : input.candidateRecipientIds

