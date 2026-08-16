import { createHash } from 'node:crypto'
import { parseMoveEffectOperation, type MoveEffectOperation, type MoveHealEffectOperation, type MoveTemporaryEffectOperation } from '#shared/moveAutomation/effects'
import type { EncounterCapabilityEffect, EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { EncounterLifecycleTriggerContext, EncounterLifecycleTriggerHandler } from '../moveAutomation/reduceLifecycle'
import type { MoveSpecEmittedOperation } from '../moveAutomation/executeSpec'
import type { InterpretedMoveItemEffects } from '../moveAutomation/itemEffectInterpreter'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from './registry'
import { toSlug } from '~~/data/ptuReference'
import {
  ITEM_DIGESTION_EFFECT_TAG,
  itemDigestionSheetTag,
  itemDigestionSourceTag,
} from './digestionEffectIdentity'

export const ITEM_DIGESTION_TRADE_HEAL_REASON = 'item.digestion-buff.trade-heal' as const
export const ITEM_DIGESTION_TRADE_EFFECT_REASON = 'item.digestion-buff.trade-encounter-healing' as const
export const ITEM_DIGESTION_TURN_HEAL_REASON = 'item.digestion-buff.turn-start-healing' as const
export const ITEM_DIGESTION_HEAL_CAPABILITY_PREFIX = 'item-digestion-turn-heal:' as const
export { ITEM_DIGESTION_EFFECT_TAG } from './digestionEffectIdentity'

const suffix = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 32)
const fail = (message: string): never => { throw new Error(message) }

export const resolveReviewedDigestionBuffTrades = (interpretation: InterpretedMoveItemEffects): readonly {
  readonly operationId: string
  readonly canonicalItemId: string
  readonly recipientIds: readonly string[]
  readonly sheetKind: 'pokemon' | 'trainer'
  readonly sheetSlug: string
}[] => interpretation.results.flatMap((result) => {
  if (result.action !== 'digest-buff' || result.outcome !== 'applied') return []
  return result.mutationIds.flatMap((mutationId) => {
    const mutation = interpretation.mutations.find(candidate => candidate.id === mutationId)
    if (!mutation || mutation.kind !== 'digest-buff') return []
    const canonicalItemId = mutation.canonicalItemIds?.[0]
    const definition = canonicalItemId
      ? ITEM_AUTOMATION_RUNTIME_REGISTRY.definitions.find(candidate => toSlug(candidate.canonicalId) === canonicalItemId) ?? null
      : null
    if (!definition?.spec.effects.some(effect => effect.operation === 'store-digestion-buff')) return []
    // The interpreter binds this to the exact authoritative stored occurrence;
    // the reducer revalidates the same slot and identity before commit.
    return mutation.canonicalItemIds?.length === 1
      ? [{
          operationId: result.operationId,
          canonicalItemId: definition.canonicalId,
          recipientIds: [mutation.sourcePlacementId],
          sheetKind: mutation.owner.sheetKind,
          sheetSlug: mutation.owner.slug,
        }]
      : []
  })
})

const fixedHealing = (input: {
  readonly operationId: string
  readonly canonicalItemId: string
  readonly recipientIds: readonly string[]
  readonly amount: number
  readonly sheetKind: 'pokemon' | 'trainer'
  readonly sheetSlug: string
}): MoveSpecEmittedOperation => ({
  operation: parseMoveEffectOperation({
    id: `item.digestion.heal.${suffix(`${input.operationId}\u0000${input.canonicalItemId}`)}`,
    kind: 'heal',
    source: { kind: 'operation', id: input.operationId },
    recipients: { kind: 'actor' },
    phase: 'cleanup',
    reasonCode: ITEM_DIGESTION_TRADE_HEAL_REASON,
    payload: {
      mode: 'gain', pool: 'hit-points', calculation: { kind: 'fixed', value: input.amount },
      bounds: { minimum: null, maximum: null }, rounding: 'floor',
      injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
    },
  }, 'itemDigestionTrade.fixedHealing'),
  recipientIds: [...input.recipientIds],
})

const encounterHealingEffect = (input: {
  readonly operationId: string
  readonly canonicalItemId: string
  readonly recipientIds: readonly string[]
  readonly numerator: number
  readonly denominator: number
  readonly sheetKind: 'pokemon' | 'trainer'
  readonly sheetSlug: string
}): MoveSpecEmittedOperation => {
  const percent = (input.numerator * 100) / input.denominator
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) fail('Digestion Buff healing fraction is invalid.')
  const effectId = `item.digestion.encounter-heal.${suffix(`${input.operationId}\u0000${input.canonicalItemId}`)}`
  const operation: MoveTemporaryEffectOperation = {
    id: `item.digestion.effect.${suffix(effectId)}`,
    kind: 'temporary-effect',
    source: { kind: 'operation', id: input.operationId },
    recipients: { kind: 'actor' },
    phase: 'cleanup',
    reasonCode: ITEM_DIGESTION_TRADE_EFFECT_REASON,
    payload: {
      action: 'add', effectId, recipientScope: 'placements',
      definition: {
        kind: 'capability', duration: { kind: 'encounter', remaining: null },
        stacks: 1, charges: null, stackPolicy: { kind: 'replace', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null },
        tags: [
          ITEM_DIGESTION_EFFECT_TAG,
          itemDigestionSourceTag(input.canonicalItemId),
          itemDigestionSheetTag({ sheetKind: input.sheetKind, sheetSlug: input.sheetSlug }),
        ],
        payload: {
          capabilityId: `${ITEM_DIGESTION_HEAL_CAPABILITY_PREFIX}${input.denominator}`,
          action: 'grant', value: input.numerator,
        },
        dispel: { policy: 'matching-tags', tags: [ITEM_DIGESTION_EFFECT_TAG] },
        // The effect belongs to this Pokémon sheet for the encounter; recall
        // must not erase it or hand it to a replacement combatant.
        transferPolicy: 'retain',
      },
    },
  }
  return {
    operation: parseMoveEffectOperation(operation, 'itemDigestionTrade.encounterHealing'),
    recipientIds: [...input.recipientIds],
  }
}

/** Materialize deterministic Snack benefits only after an authoritative trade was accepted. */
export const createDigestionBuffTradeOperations = (input: {
  readonly interpretation: InterpretedMoveItemEffects
}): readonly MoveSpecEmittedOperation[] => Object.freeze(resolveReviewedDigestionBuffTrades(input.interpretation).map((trade) => {
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require(trade.canonicalItemId)
  const effect = definition.spec.effects.find(candidate => candidate.operation === 'store-digestion-buff')
    ?? fail(`${trade.canonicalItemId} lost its reviewed Digestion Buff effect.`)
  return effect.buffKind === 'fixed-heal'
    ? fixedHealing({ ...trade, amount: effect.amount })
    : encounterHealingEffect({
        ...trade,
        numerator: effect.amount,
        denominator: effect.denominator ?? fail(`${trade.canonicalItemId} lost its healing denominator.`),
      })
}))

export const isItemDigestionTurnHealingEffect = (effect: EncounterEffect): effect is EncounterCapabilityEffect => (
  effect.kind === 'capability'
  && effect.tags.includes(ITEM_DIGESTION_EFFECT_TAG)
  && effect.duration.kind === 'encounter'
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId.startsWith(ITEM_DIGESTION_HEAL_CAPABILITY_PREFIX)
  && typeof effect.payload.value === 'number'
  && Number.isSafeInteger(effect.payload.value)
  && effect.payload.value > 0
  && effect.payload.value <= 100
  && Number.isSafeInteger(Number(effect.payload.capabilityId.slice(ITEM_DIGESTION_HEAL_CAPABILITY_PREFIX.length)))
  && Number(effect.payload.capabilityId.slice(ITEM_DIGESTION_HEAL_CAPABILITY_PREFIX.length)) > 0
)

export const itemDigestionTurnHealingOperation = (input: {
  readonly eventId: string
  readonly effect: EncounterCapabilityEffect
}): MoveHealEffectOperation => {
  if (!isItemDigestionTurnHealingEffect(input.effect)) fail('Encounter effect is not reviewed Digestion Buff healing.')
  const denominator = Number(input.effect.payload.capabilityId.slice(ITEM_DIGESTION_HEAL_CAPABILITY_PREFIX.length))
  const numerator = input.effect.payload.value
  const percent = (Number(numerator) * 100) / denominator
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) fail('Encounter effect has an invalid Digestion Buff healing fraction.')
  return parseMoveEffectOperation({
    id: `item.digestion.turn-heal.${suffix(`${input.eventId}\u0000${input.effect.id}`)}`,
    kind: 'heal', source: { kind: 'encounter-effect', id: input.effect.id },
    recipients: { kind: 'attacked-targets' }, phase: 'cleanup',
    reasonCode: ITEM_DIGESTION_TURN_HEAL_REASON,
    payload: {
      mode: 'gain', pool: 'hit-points',
      calculation: { kind: 'percent-max', percent },
      bounds: { minimum: null, maximum: null }, rounding: 'floor',
      injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
    },
  }, 'itemDigestionTrade.turnHealing') as MoveHealEffectOperation
}

export const isItemDigestionTurnHealingOperation = (
  operation: MoveEffectOperation,
): operation is MoveHealEffectOperation => operation.kind === 'heal'
  && operation.reasonCode === ITEM_DIGESTION_TURN_HEAL_REASON

/** Emit one server-authored healing operation for each active effect owned by the turn actor. */
export const createItemDigestionEncounterLifecycleHandler = (): EncounterLifecycleTriggerHandler => Object.freeze({
  id: 'handler.item-digestion-turn-healing',
  resolve: ({ event, state }: EncounterLifecycleTriggerContext) => {
    if (event.kind !== 'turn-start') return []
    return state.effects.flatMap(effect => (
      isItemDigestionTurnHealingEffect(effect)
      && effect.suppression.sources.length === 0
      && effect.affected.placementIds.includes(event.placementId)
        ? [{
            effectId: effect.id,
            reasonCode: `${ITEM_DIGESTION_TURN_HEAL_REASON}-trigger`,
            operations: [itemDigestionTurnHealingOperation({ eventId: event.eventId, effect })],
            emittedEvents: [],
          }]
        : []
    ))
  },
})
