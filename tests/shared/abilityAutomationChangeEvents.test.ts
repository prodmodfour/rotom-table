import { describe, expect, it } from 'vitest'
import {
  AbilityEncounterEventValidationError,
  parseAbilityEncounterEvent,
} from '#shared/abilityAutomation/events'
import { parseAbilityConditionEventPredicate } from '#shared/abilityAutomation/conditionEventPredicates'
import { parseAbilityValueChangeEventPredicate } from '#shared/abilityAutomation/changeEventPredicates'
import {
  evaluateAbilityConditionEventPredicate,
  evaluateAbilityValueChangeEventPredicate,
} from '../../server/domain/abilityAutomation/changeEventPredicates'
import { ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY } from '../../server/domain/abilityAutomation/sharedKernelExtensions'
import { ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY } from '../../server/domain/abilityAutomation/subscriptionRouter'
import { recordAcceptedAbilityEvent } from '../../server/domain/abilityAutomation/eventReceipts'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'

const envelope = <Payload extends object>(
  kind: 'condition' | 'combat-stage' | 'stat',
  payload: Payload,
) => ({
  schemaVersion: 1,
  eventId: `event.${kind}.one`,
  kind,
  sequence: 5,
  mapSlug: 'change-arena',
  mapRevision: 14,
  sceneId: 'scene.one',
  occurredAt: 5_000,
  actorPlacementId: 'source-token',
  sourceResolutionId: 'resolution.ability',
  parentEventId: 'event.ability.effect',
  payload,
})

const condition = () => envelope('condition', {
  placementId: 'target-token',
  conditionId: 'burned',
  operation: 'apply',
  outcome: 'applied',
  before: false,
  after: true,
  saveRollId: null,
  transferPlacementId: null,
  sourcePlacementId: 'source-token',
  sourceAbilityInstanceId: 'base:source-token:0',
  sourceEffectId: 'effect.flame-body',
  sourceOperationId: 'flame-body.burn',
  applicationId: 'application.flame-body.target',
  preventionReasonCodes: [],
  reasonCode: 'ability.flame-body.burn',
})

const stage = () => envelope('combat-stage', {
  placementId: 'target-token',
  stat: 'attack',
  before: 5,
  requestedDelta: 3,
  appliedDelta: 1,
  after: 6,
  minimum: -6,
  maximum: 6,
  outcome: 'capped',
  transferPlacementId: null,
  sourcePlacementId: 'source-token',
  sourceAbilityInstanceId: 'base:source-token:0',
  sourceOperationId: 'ability.stage.raise',
  applicationId: 'application.stage.target',
  preventionReasonCodes: ['combat-stage.maximum'],
  reasonCode: 'ability.stage.capped',
})

const stat = () => envelope('stat', {
  placementId: 'target-token',
  stat: 'defense',
  layer: 'temporary',
  before: 20,
  requestedDelta: -5,
  appliedDelta: -5,
  after: 15,
  minimum: 1,
  maximum: 1000,
  outcome: 'applied',
  transferPlacementId: null,
  sourcePlacementId: 'source-token',
  sourceAbilityInstanceId: 'base:source-token:0',
  sourceOperationId: 'ability.stat.lower',
  applicationId: 'application.stat.target',
  preventionReasonCodes: [],
  reasonCode: 'ability.stat.lowered',
})

const expectChangeError = (callback: () => unknown): void => {
  expect(callback).toThrow(AbilityEncounterEventValidationError)
}

describe('condition, save, cure, stage, and stat events', () => {
  it('distinguishes attempted, applied, capped, and source-specific outcomes', () => {
    expect(parseAbilityEncounterEvent(condition())).toMatchObject({
      kind: 'condition',
      payload: {
        operation: 'apply', outcome: 'applied', before: false, after: true,
        sourceAbilityInstanceId: 'base:source-token:0',
      },
    })
    expect(parseAbilityEncounterEvent(stage())).toMatchObject({
      kind: 'combat-stage',
      payload: {
        requestedDelta: 3, appliedDelta: 1, outcome: 'capped',
        preventionReasonCodes: ['combat-stage.maximum'],
      },
    })
    expect(parseAbilityEncounterEvent(stat())).toMatchObject({
      kind: 'stat', payload: { layer: 'temporary', appliedDelta: -5 },
    })
  })

  it('covers prevented, reset, transferred, save, and cure transitions', () => {
    const prevented = stage()
    Object.assign(prevented.payload, {
      before: 2, requestedDelta: -1, appliedDelta: 0, after: 2,
      outcome: 'prevented', preventionReasonCodes: ['ability.clear-body'],
    })
    expect(parseAbilityEncounterEvent(prevented)).toMatchObject({
      kind: 'combat-stage', payload: { outcome: 'prevented' },
    })

    const reset = stage()
    Object.assign(reset.payload, {
      before: 4, requestedDelta: -4, appliedDelta: -4, after: 0,
      outcome: 'reset', preventionReasonCodes: [],
    })
    expect(parseAbilityEncounterEvent(reset)).toMatchObject({
      kind: 'combat-stage', payload: { outcome: 'reset' },
    })

    const transferred = stage()
    Object.assign(transferred.payload, {
      before: 2, requestedDelta: -2, appliedDelta: -2, after: 0,
      outcome: 'transferred', transferPlacementId: 'recipient-token', preventionReasonCodes: [],
    })
    expect(parseAbilityEncounterEvent(transferred)).toMatchObject({
      kind: 'combat-stage', payload: { outcome: 'transferred', transferPlacementId: 'recipient-token' },
    })

    const save = condition()
    Object.assign(save.payload, {
      operation: 'save', outcome: 'succeeded', before: true, after: false,
      saveRollId: 'roll.burn-save', sourceEffectId: null,
    })
    expect(parseAbilityEncounterEvent(save)).toMatchObject({
      kind: 'condition', payload: { operation: 'save', outcome: 'succeeded' },
    })

    const cure = condition()
    Object.assign(cure.payload, {
      operation: 'cure', outcome: 'applied', before: true, after: false,
      sourceEffectId: null,
    })
    expect(parseAbilityEncounterEvent(cure)).toMatchObject({
      kind: 'condition', payload: { operation: 'cure', after: false },
    })
  })

  it('rejects contradictory condition operations, outcomes, and source provenance', () => {
    const apply = condition()
    apply.payload.after = false
    expectChangeError(() => parseAbilityEncounterEvent(apply))

    const save = condition()
    Object.assign(save.payload, { operation: 'save', outcome: 'succeeded', before: true, after: false })
    expectChangeError(() => parseAbilityEncounterEvent(save))

    const transfer = condition()
    Object.assign(transfer.payload, {
      operation: 'transfer', outcome: 'transferred', before: true, after: false,
      transferPlacementId: null,
    })
    expectChangeError(() => parseAbilityEncounterEvent(transfer))

    const source = condition()
    Object.assign(source.payload, { sourceAbilityInstanceId: null })
    expectChangeError(() => parseAbilityEncounterEvent(source))
  })

  it('rejects contradictory stage/stat arithmetic and outcome claims', () => {
    const arithmetic = stage()
    arithmetic.payload.after = 5
    expectChangeError(() => parseAbilityEncounterEvent(arithmetic))

    const capped = stage()
    capped.payload.preventionReasonCodes = []
    expectChangeError(() => parseAbilityEncounterEvent(capped))

    const reset = stage()
    Object.assign(reset.payload, { outcome: 'reset', before: 3, appliedDelta: -2, after: 1 })
    expectChangeError(() => parseAbilityEncounterEvent(reset))

    const transfer = stat()
    Object.assign(transfer.payload, { outcome: 'transferred', transferPlacementId: null })
    expectChangeError(() => parseAbilityEncounterEvent(transfer))
  })

  it('registers and evaluates condition and value-change predicates', () => {
    expect(ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY.resolve('predicate', 'ability-condition-fact'))
      .toMatchObject({ version: 1 })
    expect(ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY.resolve('ability-value-change-fact'))
      .toMatchObject({ version: 1 })

    const conditionEvent = parseAbilityEncounterEvent(condition())
    const conditionPredicate = parseAbilityConditionEventPredicate({
      kind: 'ability-condition-fact',
      operations: ['apply'],
      outcomes: ['applied'],
      conditionIds: ['burned'],
      ownerRole: 'subject',
      sourceRelation: 'other',
      resultingState: 'present',
      save: 'forbidden',
    })
    if (conditionEvent.kind !== 'condition') expect.unreachable()
    expect(evaluateAbilityConditionEventPredicate({
      event: conditionEvent,
      ownerPlacementId: 'target-token',
      predicate: conditionPredicate,
    })).toBe(true)

    const stageEvent = parseAbilityEncounterEvent(stage())
    const changePredicate = parseAbilityValueChangeEventPredicate({
      kind: 'ability-value-change-fact',
      eventKinds: ['combat-stage'],
      combatStageStats: ['attack'],
      statKinds: [],
      statLayers: [],
      outcomes: ['capped'],
      ownerRole: 'subject',
      sourceRelation: 'other',
      direction: 'raised',
      minimumAbsoluteDelta: 1,
    })
    if (stageEvent.kind !== 'combat-stage') expect.unreachable()
    expect(evaluateAbilityValueChangeEventPredicate({
      event: stageEvent,
      ownerPlacementId: 'target-token',
      predicate: changePredicate,
    })).toBe(true)
  })

  it('suppresses duplicate derived condition events by application identity', () => {
    const first = recordAcceptedAbilityEvent(createEmptyEncounterState(), condition())
    const replay = recordAcceptedAbilityEvent(first.encounterState, condition())
    expect(first.status).toBe('emitted')
    expect(replay).toMatchObject({ status: 'duplicate', event: null })
  })
})
