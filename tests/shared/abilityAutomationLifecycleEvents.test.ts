import { describe, expect, it } from 'vitest'
import {
  AbilityEncounterEventValidationError,
  parseAbilityEncounterEvent,
} from '#shared/abilityAutomation/events'
import { parseAbilityPresenceEventPredicate } from '#shared/abilityAutomation/presenceEventPredicates'
import { parseAbilityInitiativeEventPredicate } from '#shared/abilityAutomation/initiativeEventPredicates'
import { parseAbilityLifecycleEventPredicate } from '#shared/abilityAutomation/lifecycleEventPredicates'
import {
  evaluateAbilityInitiativeEventPredicate,
  evaluateAbilityLifecycleEventPredicate,
  evaluateAbilityPresenceEventPredicate,
} from '../../server/domain/abilityAutomation/lifecycleEventPredicates'
import { ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY } from '../../server/domain/abilityAutomation/sharedKernelExtensions'
import { ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY } from '../../server/domain/abilityAutomation/subscriptionRouter'
import { recordAcceptedAbilityEvent } from '../../server/domain/abilityAutomation/eventReceipts'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'

const event = <Payload extends object>(kind: 'presence' | 'initiative' | 'lifecycle', payload: Payload) => ({
  schemaVersion: 1,
  eventId: `event.${kind}.one`,
  kind,
  sequence: 40,
  mapSlug: 'lifecycle-arena',
  mapRevision: 80,
  sceneId: 'scene.one',
  occurredAt: 8_000,
  actorPlacementId: 'trainer-token',
  sourceResolutionId: 'resolution.lifecycle',
  parentEventId: null,
  payload,
})

const presence = () => event('presence', {
  operation: 'switch',
  outgoingPlacementId: 'outgoing-token',
  incomingPlacementId: 'incoming-token',
  sideId: 'side.a',
  outgoingCell: { x: 2, y: 2, z: 0 },
  incomingCell: { x: 2, y: 2, z: 0 },
  initiativeRevision: 5,
  sourceOperationId: 'switch.accepted',
  applicationId: 'application.switch.one',
  reasonCode: 'encounter.switch.accepted',
})

const initiative = () => event('initiative', {
  change: 'delayed',
  placementId: 'owner-token',
  orderBefore: ['owner-token', 'other-token', 'third-token'],
  orderAfter: ['other-token', 'owner-token', 'third-token'],
  activePlacementIdBefore: 'owner-token',
  activePlacementIdAfter: 'other-token',
  roundBefore: 2,
  roundAfter: 2,
  turnBefore: 3,
  turnAfter: 3,
  initiativeRevisionBefore: 8,
  initiativeRevisionAfter: 9,
  sourceOperationId: 'initiative.delay',
  applicationId: 'application.initiative.delay',
  reasonCode: 'encounter.initiative.delayed',
})

const lifecycle = () => event('lifecycle', {
  boundary: 'turn',
  transition: 'started',
  subjectPlacementId: 'owner-token',
  abilityInstanceId: null,
  ordinal: 4,
  reasonCode: 'encounter.turn.started',
})

const expectLifecycleError = (callback: () => unknown): void => {
  expect(callback).toThrow(AbilityEncounterEventValidationError)
}

describe('ability presence, initiative, turn, round, and scene events', () => {
  it('models send-out, recall, and switch with exact placements and cells', () => {
    expect(parseAbilityEncounterEvent(presence())).toMatchObject({
      kind: 'presence',
      payload: {
        operation: 'switch', outgoingPlacementId: 'outgoing-token',
        incomingPlacementId: 'incoming-token', initiativeRevision: 5,
      },
    })
    const sendOut = presence()
    Object.assign(sendOut.payload, {
      operation: 'send-out', outgoingPlacementId: null, outgoingCell: null,
      applicationId: 'application.send-out.one',
    })
    expect(parseAbilityEncounterEvent(sendOut)).toMatchObject({
      kind: 'presence', payload: { operation: 'send-out', outgoingPlacementId: null },
    })
    const recall = presence()
    Object.assign(recall.payload, {
      operation: 'recall', incomingPlacementId: null, incomingCell: null,
      applicationId: 'application.recall.one',
    })
    expect(parseAbilityEncounterEvent(recall)).toMatchObject({
      kind: 'presence', payload: { operation: 'recall', incomingPlacementId: null },
    })
  })

  it('models initiative insertion, removal, delay, advance, and round reset', () => {
    expect(parseAbilityEncounterEvent(initiative())).toMatchObject({
      kind: 'initiative', payload: { change: 'delayed', placementId: 'owner-token' },
    })
    const inserted = initiative()
    Object.assign(inserted.payload, {
      change: 'inserted', placementId: 'owner-token',
      orderBefore: ['other-token', 'third-token'],
      orderAfter: ['owner-token', 'other-token', 'third-token'],
      activePlacementIdBefore: 'other-token', activePlacementIdAfter: 'other-token',
    })
    expect(parseAbilityEncounterEvent(inserted)).toMatchObject({ kind: 'initiative', payload: { change: 'inserted' } })
    const removed = initiative()
    Object.assign(removed.payload, {
      change: 'removed', placementId: 'owner-token',
      orderAfter: ['other-token', 'third-token'], activePlacementIdAfter: 'other-token',
    })
    expect(parseAbilityEncounterEvent(removed)).toMatchObject({ kind: 'initiative', payload: { change: 'removed' } })
    const advanced = initiative()
    Object.assign(advanced.payload, {
      change: 'advanced', placementId: null, orderAfter: [...advanced.payload.orderBefore],
      turnAfter: 4,
    })
    expect(parseAbilityEncounterEvent(advanced)).toMatchObject({ kind: 'initiative', payload: { change: 'advanced' } })
    const reset = initiative()
    Object.assign(reset.payload, {
      change: 'reset', placementId: null, orderAfter: [...reset.payload.orderBefore],
      roundAfter: 3, turnAfter: 0,
    })
    expect(parseAbilityEncounterEvent(reset)).toMatchObject({ kind: 'initiative', payload: { change: 'reset' } })
  })

  it('rejects contradictory presence and initiative transitions', () => {
    const switchEvent = presence()
    switchEvent.payload.incomingPlacementId = 'outgoing-token'
    expectLifecycleError(() => parseAbilityEncounterEvent(switchEvent))
    const sendOut = presence()
    Object.assign(sendOut.payload, { operation: 'send-out', outgoingPlacementId: null })
    expectLifecycleError(() => parseAbilityEncounterEvent(sendOut))
    const revision = initiative()
    revision.payload.initiativeRevisionAfter = 10
    expectLifecycleError(() => parseAbilityEncounterEvent(revision))
    const delayed = initiative()
    delayed.payload.orderAfter = [...delayed.payload.orderBefore]
    expectLifecycleError(() => parseAbilityEncounterEvent(delayed))
    const active = initiative()
    active.payload.activePlacementIdAfter = 'missing-token'
    expectLifecycleError(() => parseAbilityEncounterEvent(active))
  })

  it('registers and evaluates presence, initiative, and lifecycle predicates', () => {
    for (const kind of ['ability-presence-fact', 'ability-initiative-fact', 'ability-lifecycle-fact']) {
      expect(ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY.resolve('predicate', kind)).toMatchObject({ version: 1 })
      expect(ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY.resolve(kind)).toMatchObject({ version: 1 })
    }
    const presenceEvent = parseAbilityEncounterEvent(presence())
    const presencePredicate = parseAbilityPresenceEventPredicate({
      kind: 'ability-presence-fact', operations: ['switch'], ownerRole: 'incoming', sideId: 'side.a',
    })
    if (presenceEvent.kind !== 'presence') expect.unreachable()
    expect(evaluateAbilityPresenceEventPredicate({
      event: presenceEvent, ownerPlacementId: 'incoming-token', predicate: presencePredicate,
    })).toBe(true)

    const initiativeEvent = parseAbilityEncounterEvent(initiative())
    const initiativePredicate = parseAbilityInitiativeEventPredicate({
      kind: 'ability-initiative-fact', changes: ['delayed'], ownerRole: 'affected',
      ownerPosition: 'later', clock: 'unchanged',
    })
    if (initiativeEvent.kind !== 'initiative') expect.unreachable()
    expect(evaluateAbilityInitiativeEventPredicate({
      event: initiativeEvent, ownerPlacementId: 'owner-token', predicate: initiativePredicate,
    })).toBe(true)

    const lifecycleEvent = parseAbilityEncounterEvent(lifecycle())
    const lifecyclePredicate = parseAbilityLifecycleEventPredicate({
      kind: 'ability-lifecycle-fact', boundaries: ['turn'], transitions: ['started'],
      subjectRelation: 'owner', minimumOrdinal: 4,
    })
    if (lifecycleEvent.kind !== 'lifecycle') expect.unreachable()
    expect(evaluateAbilityLifecycleEventPredicate({
      event: lifecycleEvent, ownerPlacementId: 'owner-token', predicate: lifecyclePredicate,
    })).toBe(true)
  })

  it('keeps accepted presence and initiative applications replay-safe', () => {
    const first = recordAcceptedAbilityEvent(createEmptyEncounterState(), presence())
    expect(recordAcceptedAbilityEvent(first.encounterState, presence()).status).toBe('duplicate')
    const second = recordAcceptedAbilityEvent(first.encounterState, initiative())
    expect(second.status).toBe('emitted')
    expect(second.encounterState.abilityEventReceipts?.entries).toHaveLength(2)
  })
})
