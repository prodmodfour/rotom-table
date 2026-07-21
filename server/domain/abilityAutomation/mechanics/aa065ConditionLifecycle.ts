import { createHash } from 'node:crypto'
import {
  parseMoveEffectOperation,
  type MoveDirectHpEffectOperation,
  type MoveEffectOperation,
} from '#shared/moveAutomation/effects'
import { parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import type { EncounterCapabilityEffect } from '#shared/moveAutomation/encounterEffects'
import type { TabletopMap } from '~/types/map'
import { normalizeConditionNames } from '~/utils/statusConditions'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { EncounterLifecycleTriggerHandler } from '../../moveAutomation/reduceLifecycle'
import type { MoveCoreTokenEffectOperationResult } from '../../moveAutomation/reducers/coreTokenEffectTypes'

export const AA065_CORROSIVE_TOXINS_HP_BYPASS_CAPABILITY_ID = 'aa065.corrosive-toxins.bad-poison-hp-loss-bypass' as const
export const AA065_CORROSIVE_TOXINS_RESIDUAL_REASON = 'ability.corrosive-toxins.badly-poisoned-hp-loss' as const
const HANDLER_ID = 'handler.ability.aa065.corrosive-toxins-residual'
const MAX_BAD_POISON_STREAK = 16

const isBypassEffect = (
  effect: EncounterState['effects'][number],
): effect is EncounterCapabilityEffect => (
  effect.kind === 'capability'
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === AA065_CORROSIVE_TOXINS_HP_BYPASS_CAPABILITY_ID
)

const residualOperation = (input: {
  readonly eventId: string
  readonly effect: Extract<EncounterState['effects'][number], { readonly kind: 'capability' }>
}): MoveDirectHpEffectOperation => {
  const streak = Math.max(1, Math.min(MAX_BAD_POISON_STREAK, input.effect.stacks))
  const value = 5 * (2 ** (streak - 1))
  const digest = createHash('sha256')
    .update(`${input.eventId}\u0000${input.effect.id}\u0000${streak}`)
    .digest('hex').slice(0, 32)
  return parseMoveEffectOperation({
    id: `ability.corrosive-toxins.residual.${digest}`,
    kind: 'direct-hp',
    source: { kind: 'encounter-effect', id: input.effect.id },
    recipients: { kind: 'area-targets' },
    phase: 'cleanup',
    reasonCode: AA065_CORROSIVE_TOXINS_RESIDUAL_REASON,
    payload: {
      mode: 'lose', pool: 'hit-points',
      calculation: { kind: 'fixed', value },
      copySource: null,
      bounds: { minimum: null, maximum: null },
      rounding: 'floor',
      // This explicit false is the reviewed Corrosive Toxins bypass: neither
      // type immunity nor HP-loss prevention can intercept its Bad Poison loss.
      applyTypeImmunity: false,
      cost: null,
      injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' },
    },
  }, 'aa065.corrosive-toxins.residual') as MoveDirectHpEffectOperation
}

/** Materialize only Corrosive Toxins-owned Bad Poison residuals at the afflicted target's turn end. */
export const createAa065CorrosiveToxinsLifecycleHandler = (
  map: Pick<TabletopMap, 'encounterState'>,
): EncounterLifecycleTriggerHandler | null => {
  const effects = parseEncounterState(map.encounterState).effects.filter(isBypassEffect)
  if (effects.length === 0) return null
  const handler: EncounterLifecycleTriggerHandler = {
    id: HANDLER_ID,
    resolve: ({ event }) => {
      if (event.kind !== 'turn-end') return []
      return effects.flatMap(effect => (
        effect.affected.placementIds.includes(event.placementId)
          ? [{
              effectId: effect.id,
              reasonCode: `${AA065_CORROSIVE_TOXINS_RESIDUAL_REASON}-trigger`,
              operations: [residualOperation({ eventId: event.eventId, effect })],
              emittedEvents: [],
            }]
          : []
      ))
    },
  }
  return Object.freeze(handler)
}

export const isAa065CorrosiveToxinsResidualOperation = (
  operation: MoveEffectOperation,
): operation is MoveDirectHpEffectOperation => operation.kind === 'direct-hp'
  && operation.reasonCode === AA065_CORROSIVE_TOXINS_RESIDUAL_REASON
  && operation.id.startsWith('ability.corrosive-toxins.residual.')

/** A cured target cannot keep taking residual damage from a scene-lived provenance marker. */
export const aa065CorrosiveToxinsLifecycleRecipientIds = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveEffectOperation
  readonly candidateRecipientIds: readonly string[]
}): readonly string[] => isAa065CorrosiveToxinsResidualOperation(input.operation)
  ? input.candidateRecipientIds.filter(placementId => {
      const token = input.context.queries.tokens.get(placementId)
      return token ? normalizeConditionNames(token.conditions).includes('Badly Poisoned') : false
    })
  : input.candidateRecipientIds

/** Advance the consecutive-round counter only after the authoritative HP reducer applied the residual. */
export const advanceAa065CorrosiveToxinsResidualCounters = (input: {
  readonly state: EncounterState
  readonly operations: readonly MoveEffectOperation[]
  readonly results: readonly MoveCoreTokenEffectOperationResult[]
}): EncounterState => {
  const operations = new Map(input.operations.filter(isAa065CorrosiveToxinsResidualOperation)
    .map(operation => [operation.id, operation] as const))
  const appliedEffectIds = new Set<string>()
  for (const result of input.results) {
    const operation = operations.get(result.operationId)
    if (!operation || operation.source.kind !== 'encounter-effect') continue
    if (result.recipients.some(recipient => (
      recipient.previous.kind === 'hp'
      && recipient.current.kind === 'hp'
      && recipient.current.currentHp < recipient.previous.currentHp
    ))) appliedEffectIds.add(operation.source.id)
  }
  if (appliedEffectIds.size === 0) return input.state
  return parseEncounterState({
    ...input.state,
    effects: input.state.effects.map(effect => (
      appliedEffectIds.has(effect.id) && isBypassEffect(effect)
        ? { ...effect, stacks: Math.min(MAX_BAD_POISON_STREAK, effect.stacks + 1) }
        : effect
    )),
  })
}
