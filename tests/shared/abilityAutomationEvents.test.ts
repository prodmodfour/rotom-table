import { describe, expect, it } from 'vitest'
import {
  AbilityEncounterEventValidationError,
  parseAbilityEncounterEvent,
  parseAbilityEncounterEventBatch,
  type AbilityEncounterEvent,
} from '#shared/abilityAutomation/events'

const event = (
  kind: AbilityEncounterEvent['kind'],
  payload: AbilityEncounterEvent['payload'],
  sequence = 1,
) => ({
  schemaVersion: 1,
  eventId: `event.${kind}.${sequence}`,
  kind,
  sequence,
  mapSlug: 'event-arena',
  mapRevision: sequence,
  sceneId: 'scene.one',
  occurredAt: 1_000 + sequence,
  actorPlacementId: 'actor-token',
  sourceResolutionId: 'resolution.root',
  parentEventId: null,
  payload,
})

const fixtures = (): unknown[] => [
  event('action', {
    actionKind: 'move',
    actionId: 'move.tackle',
    timing: 'declared',
    outcome: null,
    targetPlacementIds: ['target-token'],
    tags: ['damaging', 'contact'],
  }),
  event('hp', {
    placementId: 'target-token',
    changeKind: 'damage',
    before: 10,
    after: 0,
    maximumBefore: 20,
    maximumAfter: 20,
    fullMaximum: 30,
    temporaryBefore: 0,
    temporaryAfter: 0,
    requestedAmount: 10,
    appliedAmount: 10,
    crossedZero: true,
    crossedInjuryThreshold: false,
    injuriesBefore: 0,
    injuriesAfter: 0,
    massiveDamage: false,
    massiveDamageThreshold: 15,
    massiveDamageAmount: 10,
    massiveDamageInjuryApplied: false,
    faintedBefore: false,
    faintedAfter: true,
    faintTransition: 'fainted',
    sourceOperationId: 'tackle.damage',
    applicationId: 'application.tackle.target',
    reasonCode: 'move.tackle.damage',
  }, 2),
  event('condition', {
    placementId: 'target-token',
    conditionId: 'burned',
    operation: 'apply',
    outcome: 'applied',
    before: false,
    after: true,
    saveRollId: null,
    transferPlacementId: null,
    sourcePlacementId: 'actor-token',
    sourceAbilityInstanceId: 'base:actor-token:0',
    sourceEffectId: 'effect.ember-burn',
    sourceOperationId: 'ember.burn',
    applicationId: 'application.ember-burn.target',
    preventionReasonCodes: [],
    reasonCode: 'move.ember.burn',
  }, 3),
  event('combat-stage', {
    placementId: 'actor-token',
    stat: 'attack',
    before: 0,
    requestedDelta: 2,
    appliedDelta: 2,
    after: 2,
    minimum: -6,
    maximum: 6,
    outcome: 'applied',
    transferPlacementId: null,
    sourcePlacementId: 'actor-token',
    sourceAbilityInstanceId: 'base:actor-token:0',
    sourceOperationId: 'moxie.raise',
    applicationId: 'application.moxie.raise',
    preventionReasonCodes: [],
    reasonCode: 'ability.moxie.raise',
  }, 4),
  event('stat', {
    placementId: 'actor-token',
    stat: 'attack',
    layer: 'base',
    before: 10,
    requestedDelta: 5,
    appliedDelta: 5,
    after: 15,
    minimum: 1,
    maximum: 1000,
    outcome: 'applied',
    transferPlacementId: null,
    sourcePlacementId: 'actor-token',
    sourceAbilityInstanceId: 'base:actor-token:0',
    sourceOperationId: 'color-theory.attack',
    applicationId: 'application.color-theory.attack',
    preventionReasonCodes: [],
    reasonCode: 'ability.color-theory.stat',
  }, 5),
  event('item', {
    change: 'consumed',
    outcome: 'applied',
    resourceKind: 'inventory',
    itemId: 'item.sitrus-berry',
    itemResourceId: 'inventory.actor.sitrus-berry',
    quantityRequested: 1,
    quantityApplied: 1,
    ownerIdBefore: 'sheet:pokemon:actor',
    ownerIdAfter: 'sheet:pokemon:actor',
    slotIdBefore: null,
    slotIdAfter: null,
    resourceRevisionBefore: 7,
    resourceRevisionAfter: 8,
    sourcePlacementId: 'actor-token',
    sourceAbilityInstanceId: null,
    sourceOperationId: 'item.berry.consume',
    applicationId: 'application.item.berry.consume',
    preventionReasonCodes: [],
    reasonCode: 'item.berry.consumed',
  }, 6),
  event('field', {
    fieldKind: 'weather',
    fieldId: 'weather.sun',
    zoneId: 'zone.weather.sun',
    change: 'applied',
    outcome: 'applied',
    presentBefore: false,
    presentAfter: true,
    layerBefore: 0,
    layerAfter: 1,
    remainingRoundsBefore: null,
    remainingRoundsAfter: 5,
    fieldRevisionBefore: 3,
    fieldRevisionAfter: 4,
    sourcePlacementId: 'actor-token',
    sourceAbilityInstanceId: null,
    sourceOperationId: 'move.sunny-day.weather',
    applicationId: 'application.field.weather.sun',
    preventionReasonCodes: [],
    reasonCode: 'move.sunny-day.weather',
  }, 7),
  event('lifecycle', {
    boundary: 'round',
    transition: 'started',
    subjectPlacementId: null,
    abilityInstanceId: null,
    ordinal: 3,
    reasonCode: 'encounter.round.started',
  }, 8),
]

const expectEventError = (callback: () => unknown, code: string): void => {
  try {
    callback()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityEncounterEventValidationError)
    expect((error as AbilityEncounterEventValidationError).code).toBe(code)
  }
}

describe('closed ability encounter-event vocabulary', () => {
  it('parses action, HP, condition, stage, item, field, and lifecycle facts', () => {
    const parsed = parseAbilityEncounterEventBatch(fixtures())

    expect(parsed.map(value => value.kind)).toEqual([
      'action', 'hp', 'condition', 'combat-stage', 'stat', 'item', 'field', 'lifecycle',
    ])
    expect(parsed[1]).toMatchObject({
      kind: 'hp',
      payload: { before: 10, after: 0, crossedZero: true },
    })
    expect(parsed[7]).toMatchObject({
      kind: 'lifecycle',
      payload: { boundary: 'round', transition: 'started', ordinal: 3 },
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed[0]?.payload)).toBe(true)
  })

  it('preserves semantic target/tag order while detaching source objects', () => {
    const source = fixtures()[0] as ReturnType<typeof event>
    const parsed = parseAbilityEncounterEvent(source)
    ;(source.payload as unknown as { targetPlacementIds: string[] }).targetPlacementIds.reverse()

    expect(parsed.kind).toBe('action')
    if (parsed.kind !== 'action') expect.unreachable()
    expect(parsed.payload.targetPlacementIds).toEqual(['target-token'])
    expect(parsed.payload.tags).toEqual(['damaging', 'contact'])
  })

  it('enforces terminal action, HP crossing, and combat-stage outcome consistency', () => {
    const action = fixtures()[0] as ReturnType<typeof event>
    ;(action.payload as Record<string, unknown>).timing = 'completed'
    expectEventError(() => parseAbilityEncounterEvent(action), 'invalid-event')

    const hp = fixtures()[1] as ReturnType<typeof event>
    ;(hp.payload as Record<string, unknown>).crossedZero = false
    expectEventError(() => parseAbilityEncounterEvent(hp), 'invalid-event')

    const stage = fixtures()[3] as ReturnType<typeof event>
    ;(stage.payload as Record<string, unknown>).after = 1
    expectEventError(() => parseAbilityEncounterEvent(stage), 'invalid-event')
  })

  it('enforces boundary-specific lifecycle facts', () => {
    const valid = parseAbilityEncounterEvent(event('lifecycle', {
      boundary: 'effective-ability',
      transition: 'became-ineffective',
      subjectPlacementId: 'actor-token',
      abilityInstanceId: 'base:actor-token:0',
      ordinal: null,
      reasonCode: 'ability.suppressed',
    }))
    expect(valid).toMatchObject({ kind: 'lifecycle' })

    expectEventError(() => parseAbilityEncounterEvent(event('lifecycle', {
      boundary: 'presence',
      transition: 'started',
      subjectPlacementId: null,
      abilityInstanceId: null,
      ordinal: 1,
      reasonCode: 'invalid.lifecycle',
    })), 'invalid-event')
  })

  it('rejects unknown kinds and fields, callbacks, sparse arrays, and duplicate IDs', () => {
    expectEventError(() => parseAbilityEncounterEvent({
      ...fixtures()[0] as object,
      kind: 'damage',
    }), 'unknown-event-kind')

    expectEventError(() => parseAbilityEncounterEvent({
      ...fixtures()[0] as object,
      unknown: true,
    }), 'invalid-event')

    expectEventError(() => parseAbilityEncounterEvent({
      ...fixtures()[0] as object,
      callback: () => true,
    }), 'not-json')

    const sparse = new Array(2)
    sparse[1] = fixtures()[0]
    expectEventError(() => parseAbilityEncounterEventBatch(sparse), 'not-json')

    const duplicate = [fixtures()[0], { ...fixtures()[0] as object, sequence: 2, mapRevision: 2, occurredAt: 1_002 }]
    expectEventError(() => parseAbilityEncounterEventBatch(duplicate), 'duplicate-event-id')
  })

  it('rejects non-monotonic sequence, revision, and event time', () => {
    const batch = fixtures().slice(0, 2) as Array<Record<string, unknown>>
    batch[1] = { ...batch[1], sequence: 1 }
    expectEventError(() => parseAbilityEncounterEventBatch(batch), 'invalid-sequence')

    const revision = fixtures().slice(0, 2) as Array<Record<string, unknown>>
    revision[1] = { ...revision[1], mapRevision: 0 }
    expectEventError(() => parseAbilityEncounterEventBatch(revision), 'invalid-sequence')

    const time = fixtures().slice(0, 2) as Array<Record<string, unknown>>
    time[1] = { ...time[1], occurredAt: 999 }
    expectEventError(() => parseAbilityEncounterEventBatch(time), 'invalid-sequence')
  })
})
