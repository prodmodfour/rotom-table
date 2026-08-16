import { describe, expect, it, vi } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { activeEquipmentState } from '../fixtures/equipment'
import {
  resolveEquipmentEventProviders,
} from '../../server/domain/itemAutomation/equipmentEventProviders'
import {
  projectEquipmentProviderRoute,
  routeEquipmentEventProviders,
} from '../../server/domain/itemAutomation/equipmentEventProviderRouter'
import {
  executeEquipmentProviderRoute,
  replayAcceptedEquipmentProviderEvent,
} from '../../server/domain/itemAutomation/equipmentProviderReceipts'
import { projectAbilityAutomationEncounterStateForPlayer } from '../../server/domain/abilityAutomation/clientStateProjection'
import { createEquipmentProviderTriggerChainCoordinator } from '../../server/domain/itemAutomation/equipmentProviderTriggerChain'

const focusState = () => activeEquipmentState({
  ownerKind: 'pokemon', ownerSlug: 'focus-mon', slotId: 'held', canonicalItemId: 'Focus Band',
})
const providers = (state: unknown = focusState(), suppressed = false) => resolveEquipmentEventProviders({
  equipmentState: state,
  owner: { kind: 'pokemon', slug: 'focus-mon' },
  isSuppressed: () => suppressed,
})
const faintEvent = (id = 'event.hp.focus-one') => ({
  schemaVersion: 1,
  eventId: id,
  kind: 'hp',
  sequence: id.endsWith('one') ? 1 : 2,
  mapSlug: 'provider-arena',
  mapRevision: 9,
  sceneId: 'scene.one',
  occurredAt: 1_000,
  actorPlacementId: 'attacker-token',
  sourceResolutionId: 'resolution.move-one',
  parentEventId: 'event.strike.one',
  payload: {
    placementId: 'focus-token', changeKind: 'damage', before: 100, after: 0,
    maximumBefore: 100, maximumAfter: 100, fullMaximum: 100,
    temporaryBefore: 0, temporaryAfter: 0, requestedAmount: 100, appliedAmount: 100,
    crossedZero: true, crossedInjuryThreshold: true, injuriesBefore: 0, injuriesAfter: 1,
    massiveDamage: true, massiveDamageThreshold: 50, massiveDamageAmount: 100,
    massiveDamageInjuryApplied: true, faintedBefore: false, faintedAfter: true,
    faintTransition: 'fainted', sourceOperationId: 'move.damage.one',
    applicationId: `application.${id.replaceAll('.', '-')}`,
    reasonCode: 'move.damage.applied',
  },
})
const route = (event = faintEvent(), resolved = providers()) => routeEquipmentEventProviders({
  event,
  checkpoint: 'pre-effect',
  mapSlug: 'provider-arena',
  mapRevision: 9,
  placements: [{ placementId: 'focus-token', providers: resolved }],
}).routes[0]!

describe('authoritative equipment event providers', () => {
  it('resolves only active, current, unsuppressed whole-item sources', () => {
    expect(providers().active).toHaveLength(1)
    expect(providers().active[0]).toMatchObject({
      canonicalItemId: 'Focus Band',
      provider: { providerId: 'equipment.focus-band.prevent-faint' },
    })
    expect(providers().active[0]!.sourceBindingSha256).toMatch(/^[a-f0-9]{64}$/)

    const suppressed = providers(focusState(), true)
    expect(suppressed.active).toEqual([])
    expect(suppressed.inactive[0]?.reasonCode).toBe('equipment-provider.suppressed')

    const stale = structuredClone(focusState()) as any
    stale.instances[0].canonicalRecordSha256 = '0'.repeat(64)
    expect(providers(stale).inactive[0]?.reasonCode).toBe('equipment-provider.definition-stale')

    const inactive = structuredClone(focusState()) as any
    inactive.instances[0].activity = { status: 'inactive', reasons: [{ code: 'other', sourceId: null }] }
    expect(providers(inactive).inactive[0]?.reasonCode).toBe('equipment-provider.inactive')
  })

  it('routes typed facts deterministically by priority without polling client state', () => {
    const result = routeEquipmentEventProviders({
      event: faintEvent(), checkpoint: 'pre-effect', mapSlug: 'provider-arena', mapRevision: 9,
      placements: [{ placementId: 'focus-token', providers: providers() }],
    })
    expect(result.routes).toHaveLength(1)
    expect(result.routes[0]).toMatchObject({
      ownerPlacementId: 'focus-token', priority: 95, response: 'mandatory',
      effect: { kind: 'survive-at-one', reasonCode: 'equipment.focus-band.prevent-faint' },
    })
    expect(result.routes[0]!.routeId).toMatch(/^equipment-provider-route:v1:[a-f0-9]{32}$/)

    expect(routeEquipmentEventProviders({
      event: { ...faintEvent(), payload: { ...faintEvent().payload, after: 1, appliedAmount: 99, crossedZero: false, faintedAfter: false, faintTransition: 'none' } },
      checkpoint: 'pre-effect', mapSlug: 'provider-arena', mapRevision: 9,
      placements: [{ placementId: 'focus-token', providers: providers() }],
    }).routes).toEqual([])
  })

  it('suppresses repeated and cyclic bindings in an equipment-only causal chain', () => {
    const root = route()
    const chain = createEquipmentProviderTriggerChainCoordinator({
      chainId: 'equipment-chain.one', rootEventId: root.eventId, routes: [root],
    })
    expect(chain.current()?.route.providerId).toBe('equipment.focus-band.prevent-faint')
    const childRoute = {
      ...root,
      routeId: 'equipment-provider-route:v1:11111111111111111111111111111111',
      eventId: 'event.hp.focus-child',
    }
    const completed = chain.completeCurrent({
      triggerId: root.routeId,
      disposition: 'executed',
      childEvents: [{
        eventId: childRoute.eventId,
        parentEventId: root.eventId,
        routes: [childRoute],
      }],
    })
    expect(completed.status).toBe('completed')
    expect(completed.terminal.map(entry => entry.disposition)).toEqual([
      'executed', 'suppressed-cycle',
    ])
    expect(JSON.stringify(completed)).not.toContain('abilityInstanceId')

    const duplicate = {
      ...root,
      routeId: 'equipment-provider-route:v1:ffffffffffffffffffffffffffffffff',
    }
    const once = createEquipmentProviderTriggerChainCoordinator({
      chainId: 'equipment-chain.once', rootEventId: root.eventId, routes: [root, duplicate],
    }).snapshot()
    expect(once.pending).toHaveLength(1)
    expect(once.terminal.map(entry => entry.disposition)).toEqual(['suppressed-once'])
  })

  it('records exact rolls and scene frequency, and never rerolls an exact replay', () => {
    const event = faintEvent()
    const routed = route(event)
    const roll = vi.fn(() => 16)
    const accepted = executeEquipmentProviderRoute({
      encounterState: createEmptyEncounterState(), event, route: routed, rollDie: roll,
      applyEffect: () => ({ outcome: 'applied', evidence: { remainingHp: 1 } }),
    })
    expect(accepted.status).toBe('applied')
    expect(accepted.receipt).toMatchObject({ outcome: 'applied', rolls: [{ sides: 20, result: 16 }] })
    expect(accepted.encounterState.abilityEventReceipts?.entries).toHaveLength(1)
    expect(accepted.encounterState.equipmentProviderReceipts?.entries).toHaveLength(1)

    const replay = executeEquipmentProviderRoute({
      encounterState: accepted.encounterState, event, route: routed,
      rollDie: () => { throw new Error('must not reroll') },
    })
    expect(replay.status).toBe('duplicate')
    expect(replay.receipt).toEqual(accepted.receipt)
    expect(roll).toHaveBeenCalledTimes(1)

    const nextEvent = faintEvent('event.hp.focus-two')
    expect(executeEquipmentProviderRoute({
      encounterState: accepted.encounterState,
      event: nextEvent,
      route: route(nextEvent),
      rollDie: () => { throw new Error('frequency must reject before roll') },
    }).status).toBe('frequency-spent')
  })

  it('does not consume scene frequency on a failed Focus Band roll', () => {
    const firstEvent = faintEvent()
    const first = executeEquipmentProviderRoute({
      encounterState: createEmptyEncounterState(), event: firstEvent, route: route(firstEvent),
      rollDie: () => 15,
    })
    expect(first.status).toBe('no-effect')

    const secondEvent = faintEvent('event.hp.focus-two')
    const second = executeEquipmentProviderRoute({
      encounterState: first.encounterState, event: secondEvent, route: route(secondEvent),
      rollDie: () => 20,
    })
    expect(second.status).toBe('applied')
  })

  it('withdraws future subscriptions on source loss while accepted receipts remain replayable', () => {
    const event = faintEvent()
    const accepted = executeEquipmentProviderRoute({
      encounterState: createEmptyEncounterState(), event, route: route(event), rollDie: () => 20,
    })
    expect(routeEquipmentEventProviders({
      event: faintEvent('event.hp.focus-two'), checkpoint: 'pre-effect',
      mapSlug: 'provider-arena', mapRevision: 9,
      placements: [{ placementId: 'focus-token', providers: null }],
    }).routes).toEqual([])
    expect(replayAcceptedEquipmentProviderEvent({ encounterState: accepted.encounterState, event }))
      .toEqual([accepted.receipt])
  })

  it('strips provider receipts and source-bound frequency markers from player encounter state', () => {
    const event = faintEvent()
    const accepted = executeEquipmentProviderRoute({
      encounterState: createEmptyEncounterState(), event, route: route(event), rollDie: () => 20,
    })
    const sourceBinding = route(event).sourceBindingSha256
    const projected = projectAbilityAutomationEncounterStateForPlayer({
      ...accepted.encounterState,
      effects: [{
        id: 'equipment-provider-frequency:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        kind: 'capability',
        source: { operationId: 'operation.marker', moveId: 'move.marker', placementId: 'focus-token' },
        affected: { placementIds: ['focus-token'], sideIds: [], cells: [] },
        createdRound: 1, createdTurn: 1,
        duration: { kind: 'scene', remaining: null }, stacks: 1, charges: null,
        stackPolicy: { kind: 'replace', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null },
        tags: ['equipment-provider-frequency', `equipment-provider-frequency:${sourceBinding}`],
        payload: { capabilityId: 'equipment-provider-frequency', action: 'grant', value: 1 },
        dispel: { policy: 'matching-tags', tags: [`equipment-provider-frequency:${sourceBinding}`] },
        transferPolicy: 'retain', suppression: { sources: [] },
      }],
    })
    expect(projected.equipmentProviderReceipts?.entries).toEqual([])
    expect(projected.effects).toEqual([])
    expect(JSON.stringify(projected)).not.toContain(sourceBinding)
  })

  it('projects no serialized identity, hashes, configuration, provenance, or private item label', () => {
    const routed = route()
    const publicView = projectEquipmentProviderRoute({ route: routed, audience: 'public' })
    expect(publicView).toMatchObject({ label: null, choice: null, effectKind: 'survive-at-one' })
    const serialized = JSON.stringify(publicView)
    expect(serialized).not.toContain(routed.sourceInstanceId)
    expect(serialized).not.toContain(routed.sourceBindingSha256)
    expect(serialized).not.toContain(routed.providerDefinitionSha256)
    expect(serialized).not.toContain('Focus Band')
    expect(projectEquipmentProviderRoute({ route: routed, audience: 'owner' }).label).toBe('Focus Band')
  })
})
