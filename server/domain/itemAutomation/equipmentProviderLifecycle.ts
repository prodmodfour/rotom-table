import { createHash } from 'node:crypto'
import {
  parseMoveEffectOperation,
  type MoveConditionEffectOperation,
  type MoveEffectOperation,
  type MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import type {
  EncounterLifecycleTriggerContext,
  EncounterLifecycleTriggerHandler,
} from '../moveAutomation/reduceLifecycle'
import type { AuthoritativeMoveEquipmentEventProviderQueries } from '../moveAutomation/equipmentEventProviderQueries'

const suffix = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000'))
  .digest('hex').slice(0, 32)
const inducedConditionOperation = (input: {
  readonly eventId: string
  readonly placementId: string
  readonly conditionId: string
  readonly reasonCode: string
  readonly sourceBindingSha256: string
}): MoveConditionEffectOperation => parseMoveEffectOperation({
  id: `equipment-provider-condition:v1:${suffix(input.eventId, input.sourceBindingSha256)}`,
  kind: 'condition', source: { kind: 'lifecycle-event', id: input.eventId },
  recipients: { kind: 'attacked-targets' }, phase: 'cleanup',
  reasonCode: input.reasonCode,
  payload: {
    action: 'apply', conditionId: input.conditionId.toLowerCase(), conditionSource: null,
    filter: null, randomChoice: null, duration: null, saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
    applyMoveImmunity: false, applyTypeImmunity: false,
  },
}, 'equipmentProviderLifecycle.inducedCondition') as MoveConditionEffectOperation

const choiceSuppressionOperation = (input: {
  readonly eventId: string
  readonly placementId: string
  readonly sourceBindingSha256: string
  readonly globalBoundary: boolean
}): MoveTemporaryEffectOperation => {
  const operationIdentity = suffix(input.eventId, input.placementId, input.sourceBindingSha256)
  const effectIdentity = suffix(input.placementId, input.sourceBindingSha256)
  return parseMoveEffectOperation({
    id: `equipment-provider-choice-operation:v1:${operationIdentity}`,
    kind: 'temporary-effect',
    source: { kind: 'lifecycle-event', id: input.eventId },
    recipients: { kind: input.globalBoundary ? 'area-targets' : 'attacked-targets' },
    phase: 'cleanup',
    reasonCode: 'equipment.choice-item.suppression',
    payload: {
      action: 'add',
      effectId: `equipment-provider-choice:v1:${effectIdentity}`,
      recipientScope: 'placements',
      definition: {
        kind: 'condition',
        duration: { kind: 'encounter', remaining: null },
        stacks: 1,
        charges: null,
        stackPolicy: { kind: 'replace', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null },
        tags: [
          'equipment-provider-accepted',
          'equipment-choice-item-suppression',
          `equipment-provider-owner:${input.placementId}`,
        ],
        payload: { conditionId: 'suppressed', action: 'apply', saveTiming: null },
        dispel: { policy: 'matching-tags', tags: ['equipment-choice-item-suppression'] },
        transferPolicy: 'retain',
      },
    },
  }, 'equipmentProviderLifecycle.choiceSuppression') as MoveTemporaryEffectOperation
}

/** Emit current-source subscriptions from lifecycle events; accepted effects are independent thereafter. */
export const createEquipmentProviderEncounterLifecycleHandler = (input: {
  readonly queries: AuthoritativeMoveEquipmentEventProviderQueries
  readonly placementIds?: readonly string[]
}): EncounterLifecycleTriggerHandler => Object.freeze({
  id: 'handler.equipment-event-providers',
  resolve: ({ event }: EncounterLifecycleTriggerContext) => {
    const placementIds = event.kind === 'turn-start'
      ? [event.placementId]
      : event.kind === 'scene-start'
        ? [...(input.placementIds ?? [])]
        : []
    return placementIds.flatMap(placementId => {
      const sources = input.queries.resolve(placementId)?.active ?? []
      return sources.flatMap(source => {
        const provider = source.provider
        if (provider.effect.kind !== 'apply-condition') return []
        const lifecycle = provider.predicate.kind === 'lifecycle' ? provider.predicate : null
        const matchesTurn = event.kind === 'turn-start'
          && lifecycle?.boundaries.includes('turn')
          && lifecycle.transitions.includes('started')
        const matchesScene = event.kind === 'scene-start'
          && lifecycle?.boundaries.includes('scene')
          && lifecycle.transitions.includes('started')
        if (!matchesTurn && !matchesScene) return []
        const operation: MoveEffectOperation = provider.effect.conditionId === 'Suppressed'
          ? choiceSuppressionOperation({
              eventId: event.eventId,
              placementId,
              sourceBindingSha256: source.sourceBindingSha256,
              globalBoundary: event.kind === 'scene-start',
            })
          : inducedConditionOperation({
              eventId: event.eventId,
              placementId,
              conditionId: provider.effect.conditionId,
              reasonCode: provider.effect.reasonCode,
              sourceBindingSha256: source.sourceBindingSha256,
            })
        return [{
          effectId: null,
          reasonCode: `${provider.effect.reasonCode}-trigger`,
          operations: [operation],
          emittedEvents: [],
        }]
      })
    })
  },
})
