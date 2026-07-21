import { describe, expect, it } from 'vitest'
import {
  AbilityEncounterEventValidationError,
  parseAbilityEncounterEvent,
} from '#shared/abilityAutomation/events'
import { parseAbilityItemEventPredicate } from '#shared/abilityAutomation/itemEventPredicates'
import { parseAbilityFieldEventPredicate } from '#shared/abilityAutomation/fieldEventPredicates'
import {
  evaluateAbilityFieldEventPredicate,
  evaluateAbilityItemEventPredicate,
} from '../../server/domain/abilityAutomation/resourceEventPredicates'
import { ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY } from '../../server/domain/abilityAutomation/sharedKernelExtensions'
import { ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY } from '../../server/domain/abilityAutomation/subscriptionRouter'
import { recordAcceptedAbilityEvent } from '../../server/domain/abilityAutomation/eventReceipts'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'

const event = <Payload extends object>(kind: 'item' | 'field', payload: Payload) => ({
  schemaVersion: 1,
  eventId: `event.${kind}.one`,
  kind,
  sequence: 50,
  mapSlug: 'resource-arena',
  mapRevision: 90,
  sceneId: 'scene.one',
  occurredAt: 9_000,
  actorPlacementId: 'owner-token',
  sourceResolutionId: 'resolution.resource',
  parentEventId: null,
  payload,
})

const item = () => event('item', {
  change: 'consumed',
  outcome: 'applied',
  resourceKind: 'inventory',
  itemId: 'item.sitrus-berry',
  itemResourceId: 'inventory.owner.sitrus',
  quantityRequested: 1,
  quantityApplied: 1,
  ownerIdBefore: 'owner-token',
  ownerIdAfter: 'owner-token',
  slotIdBefore: null,
  slotIdAfter: null,
  resourceRevisionBefore: 4,
  resourceRevisionAfter: 5,
  sourcePlacementId: 'owner-token',
  sourceAbilityInstanceId: 'base:owner-token:0',
  sourceOperationId: 'ability.cud-chew.consume',
  applicationId: 'application.item.consume',
  preventionReasonCodes: [],
  reasonCode: 'ability.cud-chew.consume',
})

const field = () => event('field', {
  fieldKind: 'weather',
  fieldId: 'weather.rain',
  zoneId: 'zone.weather.rain',
  change: 'applied',
  outcome: 'applied',
  presentBefore: false,
  presentAfter: true,
  layerBefore: 0,
  layerAfter: 1,
  remainingRoundsBefore: null,
  remainingRoundsAfter: 5,
  fieldRevisionBefore: 2,
  fieldRevisionAfter: 3,
  sourcePlacementId: 'owner-token',
  sourceAbilityInstanceId: 'base:owner-token:0',
  sourceOperationId: 'ability.drizzle.weather',
  applicationId: 'application.field.rain',
  preventionReasonCodes: [],
  reasonCode: 'ability.drizzle.weather',
})

const expectResourceError = (callback: () => unknown): void => {
  expect(callback).toThrow(AbilityEncounterEventValidationError)
}

describe('ability item, inventory, held-item, weather, terrain, room, and hazard events', () => {
  it('retains accepted inventory and held-item ownership/resource revisions', () => {
    expect(parseAbilityEncounterEvent(item())).toMatchObject({
      kind: 'item', payload: { change: 'consumed', outcome: 'applied', resourceRevisionAfter: 5 },
    })
    const transfer = item()
    Object.assign(transfer.payload, {
      change: 'transferred', ownerIdBefore: 'owner-token', ownerIdAfter: 'recipient-token',
      sourceAbilityInstanceId: null, sourceOperationId: 'inventory.transfer',
    })
    expect(parseAbilityEncounterEvent(transfer)).toMatchObject({
      kind: 'item', payload: { change: 'transferred', ownerIdAfter: 'recipient-token' },
    })
    const held = item()
    Object.assign(held.payload, {
      change: 'equipped', resourceKind: 'held-item', ownerIdBefore: 'owner-token',
      ownerIdAfter: 'owner-token', slotIdAfter: 'held', itemResourceId: 'held.owner.sitrus',
    })
    expect(parseAbilityEncounterEvent(held)).toMatchObject({
      kind: 'item', payload: { resourceKind: 'held-item', slotIdAfter: 'held' },
    })
    const prevented = item()
    Object.assign(prevented.payload, {
      outcome: 'prevented', quantityApplied: 0, resourceRevisionAfter: 4,
      preventionReasonCodes: ['ability.sticky-hold'],
    })
    expect(parseAbilityEncounterEvent(prevented)).toMatchObject({
      kind: 'item', payload: { outcome: 'prevented', quantityApplied: 0 },
    })
  })

  it('retains add, refresh, remove, expiry, and prevention for every field family', () => {
    expect(parseAbilityEncounterEvent(field())).toMatchObject({
      kind: 'field', payload: { fieldKind: 'weather', presentAfter: true },
    })
    for (const fieldKind of ['terrain', 'room', 'hazard'] as const) {
      const applied = field()
      Object.assign(applied.payload, {
        fieldKind,
        fieldId: `${fieldKind}.one`,
        zoneId: `zone.${fieldKind}.one`,
        applicationId: `application.field.${fieldKind}`,
      })
      expect(parseAbilityEncounterEvent(applied)).toMatchObject({ kind: 'field', payload: { fieldKind } })
    }
    const refreshed = field()
    Object.assign(refreshed.payload, {
      change: 'refreshed', presentBefore: true, layerBefore: 1,
      remainingRoundsBefore: 1, remainingRoundsAfter: 5,
    })
    expect(parseAbilityEncounterEvent(refreshed)).toMatchObject({ kind: 'field', payload: { change: 'refreshed' } })
    const removed = field()
    Object.assign(removed.payload, {
      change: 'removed', presentBefore: true, presentAfter: false,
      layerBefore: 1, layerAfter: 0, remainingRoundsBefore: 2, remainingRoundsAfter: null,
    })
    expect(parseAbilityEncounterEvent(removed)).toMatchObject({ kind: 'field', payload: { change: 'removed' } })
    const prevented = field()
    Object.assign(prevented.payload, {
      outcome: 'prevented', presentAfter: false, layerAfter: 0,
      remainingRoundsAfter: null, fieldRevisionAfter: 2,
      preventionReasonCodes: ['ability.air-lock'],
    })
    expect(parseAbilityEncounterEvent(prevented)).toMatchObject({ kind: 'field', payload: { outcome: 'prevented' } })
  })

  it('rejects contradictory quantity, slot, ownership, field, and revision claims', () => {
    const quantity = item()
    quantity.payload.quantityApplied = 0
    expectResourceError(() => parseAbilityEncounterEvent(quantity))
    const slot = item()
    Object.assign(slot.payload, { slotIdAfter: 'held' })
    expectResourceError(() => parseAbilityEncounterEvent(slot))
    const revision = item()
    revision.payload.resourceRevisionAfter = 4
    expectResourceError(() => parseAbilityEncounterEvent(revision))
    const layer = field()
    layer.payload.layerBefore = 1
    expectResourceError(() => parseAbilityEncounterEvent(layer))
    const fieldRevision = field()
    fieldRevision.payload.fieldRevisionAfter = 2
    expectResourceError(() => parseAbilityEncounterEvent(fieldRevision))
  })

  it('registers and evaluates item and field predicates', () => {
    for (const kind of ['ability-item-fact', 'ability-field-fact']) {
      expect(ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY.resolve('predicate', kind)).toMatchObject({ version: 1 })
      expect(ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY.resolve(kind)).toMatchObject({ version: 1 })
    }
    const itemEvent = parseAbilityEncounterEvent(item())
    const itemPredicate = parseAbilityItemEventPredicate({
      kind: 'ability-item-fact', changes: ['consumed'], outcomes: ['applied'],
      resourceKinds: ['inventory'], itemIds: ['item.sitrus-berry'], ownerRole: 'either',
      sourceRelation: 'owner', minimumQuantityApplied: 1,
    })
    if (itemEvent.kind !== 'item') expect.unreachable()
    expect(evaluateAbilityItemEventPredicate({
      event: itemEvent, ownerPlacementId: 'owner-token', predicate: itemPredicate,
    })).toBe(true)

    const fieldEvent = parseAbilityEncounterEvent(field())
    const fieldPredicate = parseAbilityFieldEventPredicate({
      kind: 'ability-field-fact', fieldKinds: ['weather'], changes: ['applied'],
      outcomes: ['applied'], fieldIds: ['weather.rain'], sourceRelation: 'owner',
      resultingPresence: 'present', minimumLayerAfter: 1,
    })
    if (fieldEvent.kind !== 'field') expect.unreachable()
    expect(evaluateAbilityFieldEventPredicate({
      event: fieldEvent, ownerPlacementId: 'owner-token', predicate: fieldPredicate,
    })).toBe(true)
  })

  it('makes item and field emissions replay-safe by accepted application identity', () => {
    const first = recordAcceptedAbilityEvent(createEmptyEncounterState(), item())
    expect(recordAcceptedAbilityEvent(first.encounterState, item()).status).toBe('duplicate')
    const second = recordAcceptedAbilityEvent(first.encounterState, field())
    expect(second.encounterState.abilityEventReceipts?.entries).toHaveLength(2)
  })
})
