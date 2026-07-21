import { createHash } from 'node:crypto'
import {
  parseMoveEffectOperation,
  type MoveEffectOperation,
  type MoveHealEffectOperation,
} from '#shared/moveAutomation/effects'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { EncounterLifecycleTriggerHandler } from '../../moveAutomation/reduceLifecycle'
import { normalizeConditionNames } from '~/utils/statusConditions'

export const AA066_DEEP_SLEEP_HEAL_REASON = 'ability.deep-sleep.turn-end-healing' as const

const healingOperation = (eventId: string): MoveHealEffectOperation => parseMoveEffectOperation({
  id: `ability.deep-sleep.healing.${createHash('sha256').update(eventId).digest('hex').slice(0, 32)}`,
  kind: 'heal', source: { kind: 'lifecycle-event', id: eventId }, recipients: { kind: 'actor' },
  phase: 'cleanup', reasonCode: AA066_DEEP_SLEEP_HEAL_REASON,
  payload: {
    mode: 'gain', pool: 'hit-points', calculation: { kind: 'percent-max', percent: 10 },
    bounds: { minimum: null, maximum: null }, rounding: 'floor',
    injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  },
}, 'ability.deep-sleep.turnEndHealing') as MoveHealEffectOperation

export const createAa066DeepSleepLifecycleHandler = (
  eligiblePlacementIds: readonly string[],
): EncounterLifecycleTriggerHandler => {
  const eligible = new Set(eligiblePlacementIds)
  return Object.freeze({
    id: 'handler.ability.aa066.deep-sleep',
    resolve: ({ event }: Parameters<EncounterLifecycleTriggerHandler['resolve']>[0]) => (
      event.kind === 'turn-end' && eligible.has(event.placementId)
        ? [{
            effectId: null, reasonCode: `${AA066_DEEP_SLEEP_HEAL_REASON}-trigger`,
            operations: [healingOperation(event.eventId)], emittedEvents: [],
          }]
        : []
    ),
  })
}

export const aa066DeepSleepLifecycleRecipientIds = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveEffectOperation
  readonly candidateRecipientIds: readonly string[]
}): readonly string[] => input.operation.kind === 'heal'
  && input.operation.reasonCode === AA066_DEEP_SLEEP_HEAL_REASON
  ? input.candidateRecipientIds.filter(placementId => {
      const token = input.context.queries.tokens.get(placementId)
      return Boolean(token
        && input.context.queries.abilities.has(placementId, 'Deep Sleep')
        && normalizeConditionNames(token.conditions).includes('Sleep'))
    })
  : input.candidateRecipientIds
