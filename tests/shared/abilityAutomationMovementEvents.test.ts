import { describe, expect, it } from 'vitest'
import {
  AbilityEncounterEventValidationError,
  parseAbilityEncounterEvent,
  parseAbilityEncounterEventBatch,
} from '#shared/abilityAutomation/events'
import { parseAbilityMovementEventPredicate } from '#shared/abilityAutomation/movementEventPredicates'
import { evaluateAbilityMovementEventPredicate } from '../../server/domain/abilityAutomation/movementEventPredicates'
import { ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY } from '../../server/domain/abilityAutomation/sharedKernelExtensions'
import { ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY } from '../../server/domain/abilityAutomation/subscriptionRouter'
import { recordAcceptedAbilityEvent } from '../../server/domain/abilityAutomation/eventReceipts'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'

const movementEvent = (checkpoint: 'pre-step' | 'post-step' = 'post-step') => ({
  schemaVersion: 1,
  eventId: `event.movement.${checkpoint}`,
  kind: 'movement',
  sequence: checkpoint === 'pre-step' ? 10 : 11,
  mapSlug: 'movement-arena',
  mapRevision: checkpoint === 'pre-step' ? 20 : 21,
  sceneId: 'scene.one',
  occurredAt: checkpoint === 'pre-step' ? 1_000 : 1_001,
  actorPlacementId: 'source-token',
  sourceResolutionId: 'resolution.force-move',
  parentEventId: 'event.force-move',
  payload: {
    placementId: 'mover-token',
    movementId: 'movement.force.one',
    checkpoint,
    mode: 'forced',
    step: 2,
    stepCount: 2,
    pathCells: [
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 1, z: 0 },
      { x: 3, y: 1, z: 1 },
    ],
    from: { x: 2, y: 1, z: 0 },
    to: { x: 3, y: 1, z: 1 },
    distanceBefore: 1,
    distanceAfter: 3,
    totalDistance: 3,
    groundedBefore: false,
    groundedAfter: true,
    adjacentPlacementIdsBefore: ['ally-token', 'source-token'],
    adjacentPlacementIdsAfter: ['ally-token', 'holder-token'],
    terrainIdsBefore: ['air'],
    terrainIdsAfter: ['grass', 'rough'],
    zoneTransitions: [
      {
        zoneId: 'zone.spikes',
        zoneKind: 'hazard',
        transition: 'entered',
        sourcePlacementId: 'source-token',
        sourceAbilityInstanceId: 'base:source-token:0',
        sourceOperationId: 'ability.spikes.zone',
      },
      {
        zoneId: 'zone.updraft',
        zoneKind: 'vortex',
        transition: 'exited',
        sourcePlacementId: null,
        sourceAbilityInstanceId: null,
        sourceOperationId: 'move.updraft.zone',
      },
    ],
    sourcePlacementId: 'source-token',
    sourceAbilityInstanceId: 'base:source-token:0',
    sourceOperationId: 'ability.force-move',
    applicationId: `application.movement.step-2.${checkpoint}`,
    reasonCode: 'ability.forced-movement.step',
  },
})

const expectMovementError = (callback: () => unknown): void => {
  expect(callback).toThrow(AbilityEncounterEventValidationError)
}

describe('ability movement, adjacency, terrain, hazard, and zone events', () => {
  it('retains immutable authoritative paths at pre-step and post-step checkpoints', () => {
    const events = parseAbilityEncounterEventBatch([
      movementEvent('pre-step'),
      movementEvent('post-step'),
    ])
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      kind: 'movement',
      payload: {
        checkpoint: 'pre-step', mode: 'forced', step: 2, stepCount: 2,
        distanceBefore: 1, distanceAfter: 3, groundedBefore: false, groundedAfter: true,
      },
    })
    expect(events[1]).toMatchObject({
      kind: 'movement', payload: { checkpoint: 'post-step' },
    })
    expect(Object.isFrozen(events[0]!.payload)).toBe(true)
    if (events[0]!.kind !== 'movement') expect.unreachable()
    expect(Object.isFrozen(events[0]!.payload.pathCells)).toBe(true)
  })

  it('retains adjacency, terrain, hazard, and source-zone transitions', () => {
    expect(parseAbilityEncounterEvent(movementEvent())).toMatchObject({
      kind: 'movement',
      payload: {
        adjacentPlacementIdsBefore: ['ally-token', 'source-token'],
        adjacentPlacementIdsAfter: ['ally-token', 'holder-token'],
        terrainIdsBefore: ['air'],
        terrainIdsAfter: ['grass', 'rough'],
        zoneTransitions: [
          {
            zoneId: 'zone.spikes', zoneKind: 'hazard', transition: 'entered',
            sourceAbilityInstanceId: 'base:source-token:0',
          },
          { zoneId: 'zone.updraft', zoneKind: 'vortex', transition: 'exited' },
        ],
      },
    })
  })

  it('rejects path, distance, adjacency, grounding, and zone-source contradictions', () => {
    const path = movementEvent()
    path.payload.to.x = 4
    expectMovementError(() => parseAbilityEncounterEvent(path))

    const distance = movementEvent()
    distance.payload.totalDistance = 4
    expectMovementError(() => parseAbilityEncounterEvent(distance))

    const adjacency = movementEvent()
    adjacency.payload.adjacentPlacementIdsBefore = ['source-token', 'ally-token']
    expectMovementError(() => parseAbilityEncounterEvent(adjacency))

    const self = movementEvent()
    self.payload.adjacentPlacementIdsAfter = ['mover-token']
    expectMovementError(() => parseAbilityEncounterEvent(self))

    const grounding = movementEvent()
    Object.assign(grounding.payload, { groundedAfter: 'yes' })
    expectMovementError(() => parseAbilityEncounterEvent(grounding))

    const source = movementEvent()
    source.payload.zoneTransitions[0]!.sourcePlacementId = null
    expectMovementError(() => parseAbilityEncounterEvent(source))
  })

  it('registers and evaluates movement predicates at owner-relative boundaries', () => {
    expect(ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY.resolve('predicate', 'ability-movement-fact'))
      .toMatchObject({ version: 1 })
    expect(ABILITY_SUBSCRIPTION_PREDICATE_REGISTRY.resolve('ability-movement-fact'))
      .toMatchObject({ version: 1 })
    const event = parseAbilityEncounterEvent(movementEvent())
    const predicate = parseAbilityMovementEventPredicate({
      kind: 'ability-movement-fact',
      checkpoints: ['post-step'],
      modes: ['forced'],
      ownerRole: 'other',
      stepPosition: 'final',
      grounding: 'became-grounded',
      ownerAdjacency: 'gained',
      terrainChange: 'entered',
      zoneKinds: ['hazard'],
      zoneTransitions: ['entered'],
      minimumStepDistance: 2,
    })
    if (event.kind !== 'movement') expect.unreachable()
    expect(evaluateAbilityMovementEventPredicate({
      event,
      ownerPlacementId: 'holder-token',
      predicate,
    })).toBe(true)
    expect(evaluateAbilityMovementEventPredicate({
      event,
      ownerPlacementId: 'mover-token',
      predicate,
    })).toBe(false)
  })

  it('suppresses exact replay while rejecting changed reuse of a movement application', () => {
    const event = movementEvent()
    const first = recordAcceptedAbilityEvent(createEmptyEncounterState(), event)
    expect(recordAcceptedAbilityEvent(first.encounterState, event).status).toBe('duplicate')
    const changed = movementEvent()
    changed.payload.reasonCode = 'ability.forced-movement.changed'
    expect(() => recordAcceptedAbilityEvent(first.encounterState, changed)).toThrow(/reused/)
  })
})
