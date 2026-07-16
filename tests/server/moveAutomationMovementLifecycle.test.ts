import { describe, expect, it } from 'vitest'
import type { MoveLogEffectOperation, MoveReactionRequestEffectOperation } from '#shared/moveAutomation/effects'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  resolveAuthoritativeDisplacement,
  resolveMovement,
  type AuthoritativeMovementSheets,
  type AuthoritativeMovementSuccess,
} from '~~/server/domain/movement/resolveMovement'
import {
  MovementLifecycleError,
  createAuthoritativeMovementLifecycleEvents,
  runAuthoritativeMovementLifecycle,
  type CreateAuthoritativeMovementLifecycleEventsInput,
} from '~~/server/domain/moveAutomation/movementLifecycle'
import type { EncounterLifecycleTriggerHandler } from '~~/server/domain/moveAutomation/reduceLifecycle'

const pokemonSheet = (slug: string): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Bulbasaur',
  level: 10,
  revision: 1,
  capabilities: { overland: 8 },
})

const placement = (id: string, x: number, z: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: id,
  position: { x, y: 0, z },
})

const movementMap = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'movement-lifecycle-arena',
  name: 'Movement Lifecycle Arena',
  revision: 4,
  dimensions: { x: 6, y: 2, z: 4 },
  groundLevelY: 0,
  voxels: [],
  placements: [
    placement('actor', 0, 1),
    placement('defender', 0, 0),
  ],
})

const movementSheets = (): AuthoritativeMovementSheets => ({
  pokemon: new Map([
    ['actor', pokemonSheet('actor')],
    ['defender', pokemonSheet('defender')],
  ]),
  trainer: new Map<string, TrainerSheet>(),
})

const resolvedMovement = (destinationX = 2): AuthoritativeMovementSuccess => {
  const movement = resolveMovement({
    map: movementMap(),
    sheets: movementSheets(),
    placementId: 'actor',
    mode: 'shift',
    destination: { x: destinationX, y: 0, z: 1 },
  })
  if (!movement.ok) throw new Error(`Expected legal test movement: ${movement.reasonCode}`)
  return movement
}

const lifecycleInput = (
  movement = resolvedMovement(),
): CreateAuthoritativeMovementLifecycleEventsInput => ({
  movement,
  movementId: 'movement.lifecycle.test',
  sourceOperationId: 'op.movement.lifecycle.test',
  mode: 'voluntary',
})

const logOperation = (
  eventId: string,
  step: number,
): MoveLogEffectOperation => ({
  id: `operation.hazard.${step}.${eventId.split('.').at(-1)}`,
  kind: 'log',
  source: { kind: 'lifecycle-event', id: eventId },
  recipients: { kind: 'none' },
  phase: 'movement',
  reasonCode: 'movement.hazard-entered',
  payload: {
    messageKey: 'movement.hazard.entered',
    arguments: [{ key: 'step', value: step }],
  },
})

const interruptOperation = (
  eventId: string,
  step: number,
): MoveReactionRequestEffectOperation => ({
  id: `operation.opportunity.${step}`,
  kind: 'reaction-request',
  source: { kind: 'lifecycle-event', id: eventId },
  recipients: { kind: 'actor' },
  phase: 'movement',
  reasonCode: 'movement.opportunity-attack',
  payload: {
    requestId: `request.opportunity.${step}`,
    promptKey: 'movement.opportunity-attack',
    options: [{ id: 'option.attack', labelKey: 'movement.opportunity-attack.use' }],
    allowPass: true,
    timing: 'movement-step',
    priority: 0,
  },
})

const movementHandler = (observedAdjacencyEvents: string[]): EncounterLifecycleTriggerHandler => ({
  id: 'handler.movement-lifecycle-test',
  resolve: ({ event }) => {
    if (event.kind === 'placement-entering') {
      return [{
        effectId: null,
        reasonCode: 'movement.hazard-entered',
        operations: [logOperation(event.eventId, event.movement.step)],
        emittedEvents: [],
      }]
    }
    if (event.kind === 'placement-leaving-adjacency') {
      observedAdjacencyEvents.push(event.eventId)
      return [{
        effectId: null,
        reasonCode: 'movement.opportunity-attack',
        operations: [interruptOperation(event.eventId, event.movement.step)],
        emittedEvents: [],
      }]
    }
    return []
  },
})

describe('authoritative movement lifecycle paths', () => {
  it('emits leave-adjacency, leave-cell, enter-cell, and final facts in path order', () => {
    const events = createAuthoritativeMovementLifecycleEvents(lifecycleInput())

    expect(events.map(event => event.kind)).toEqual([
      'placement-leaving',
      'placement-entering',
      'placement-moving',
      'placement-leaving-adjacency',
      'placement-leaving',
      'placement-entering',
      'placement-moving',
    ])
    expect(events.map(event => event.reasonCode)).toEqual([
      'movement.leave-cell',
      'movement.enter-cell',
      'movement.step-completed',
      'movement.leave-adjacency',
      'movement.leave-cell',
      'movement.enter-cell',
      'movement.final-destination',
    ])
    expect(events[3]).toMatchObject({
      kind: 'placement-leaving-adjacency',
      placementId: 'actor',
      adjacentPlacementId: 'defender',
      movement: {
        movementId: 'movement.lifecycle.test',
        mode: 'voluntary',
        step: 2,
        stepCount: 2,
      },
      from: { x: 1, y: 0, z: 1 },
      to: { x: 2, y: 0, z: 1 },
    })
    expect(events[2]).toMatchObject({
      kind: 'placement-moving',
      finalDestination: false,
    })
    expect(events[6]).toMatchObject({
      kind: 'placement-moving',
      finalDestination: true,
      to: { x: 2, y: 0, z: 1 },
    })
    expect(events[0]?.causalParentEventId).toBeNull()
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index]?.causalParentEventId).toBe(events[index - 1]?.eventId)
    }
    expect(JSON.parse(JSON.stringify(events))).toEqual(events)
    expect(Object.isFrozen(events)).toBe(true)
    expect(Object.isFrozen(events[3])).toBe(true)
  })

  it('carries the same lifecycle path evidence through forced displacement', () => {
    const displacement = resolveAuthoritativeDisplacement({
      map: movementMap(),
      sheets: movementSheets(),
      placementId: 'actor',
      movementMode: 'forced',
      vector: { x: 1, y: 0, z: 0 },
      requestedDistance: 2,
      distancePolicy: 'up-to-distance',
    })
    expect(displacement).toMatchObject({ ok: true })
    if (!displacement.ok) throw new Error('expected legal forced displacement')

    const events = createAuthoritativeMovementLifecycleEvents({
      movement: displacement,
      movementId: 'movement.lifecycle.forced',
      sourceOperationId: 'op.movement.lifecycle.forced',
      mode: displacement.movementMode,
    })

    expect(events.some(event => event.kind === 'placement-leaving-adjacency')).toBe(true)
    expect(events.every(event => (
      'movement' in event ? event.movement.mode === 'forced' : true
    ))).toBe(true)
    expect(events.at(-1)).toMatchObject({
      kind: 'placement-moving',
      finalDestination: true,
      to: displacement.destination,
    })
  })

  it('suspends before the provoking step, resumes after its exact fact, and never retriggers it', () => {
    const observedAdjacencyEvents: string[] = []
    const input = lifecycleInput()
    const handler = movementHandler(observedAdjacencyEvents)
    const pending = runAuthoritativeMovementLifecycle({
      ...input,
      state: createEmptyEncounterState(),
      handlers: [handler],
    })

    expect(pending).toMatchObject({
      status: 'pending-interrupt',
      currentPosition: { x: 1, y: 0, z: 1 },
      completedStepCount: 1,
      remainingStepCount: 1,
      remainingEventCount: 3,
    })
    if (pending.status !== 'pending-interrupt') throw new Error('expected pending movement')
    expect(pending.processedPathEvents.map(event => event.kind)).toEqual([
      'placement-leaving',
      'placement-entering',
      'placement-moving',
      'placement-leaving-adjacency',
    ])
    expect(pending.operations.map(operation => operation.kind)).toEqual([
      'log',
      'reaction-request',
    ])
    expect(pending.pendingInterrupts).toEqual([
      expect.objectContaining({
        eventId: pending.processedPathEvents.at(-1)?.eventId,
        eventKind: 'placement-leaving-adjacency',
        operation: expect.objectContaining({
          id: 'operation.opportunity.2',
          kind: 'reaction-request',
        }),
      }),
    ])
    expect(observedAdjacencyEvents).toHaveLength(1)

    const resumed = runAuthoritativeMovementLifecycle({
      ...input,
      state: pending.state,
      handlers: [handler],
      cursor: pending.cursor,
    })
    expect(resumed).toMatchObject({
      status: 'completed',
      currentPosition: { x: 2, y: 0, z: 1 },
      completedStepCount: 2,
      remainingStepCount: 0,
      remainingEventCount: 0,
    })
    expect(resumed.processedPathEvents.map(event => event.kind)).toEqual([
      'placement-leaving',
      'placement-entering',
      'placement-moving',
    ])
    expect(resumed.operations.map(operation => operation.id)).toEqual([
      expect.stringMatching(/^operation\.hazard\.2\./),
    ])
    expect(observedAdjacencyEvents).toHaveLength(1)

    const completedReplay = runAuthoritativeMovementLifecycle({
      ...input,
      state: resumed.state,
      handlers: [handler],
      cursor: resumed.cursor,
    })
    expect(completedReplay.status).toBe('completed')
    expect(completedReplay.processedPathEvents).toEqual([])
    expect(completedReplay.operations).toEqual([])
    expect(observedAdjacencyEvents).toHaveLength(1)
  })

  it('cancels remaining steps at the last committed position without replaying a trigger', () => {
    const observedAdjacencyEvents: string[] = []
    const input = lifecycleInput()
    const handler = movementHandler(observedAdjacencyEvents)
    const pending = runAuthoritativeMovementLifecycle({
      ...input,
      state: createEmptyEncounterState(),
      handlers: [handler],
    })
    if (pending.status !== 'pending-interrupt') throw new Error('expected pending movement')

    const cancelled = runAuthoritativeMovementLifecycle({
      ...input,
      state: pending.state,
      handlers: [handler],
      cursor: pending.cursor,
      action: 'cancel',
    })

    expect(cancelled).toMatchObject({
      status: 'cancelled',
      currentPosition: { x: 1, y: 0, z: 1 },
      completedStepCount: 1,
      remainingStepCount: 1,
      remainingEventCount: 3,
    })
    expect(cancelled.processedPathEvents).toEqual([])
    expect(cancelled.operations).toEqual([])
    expect(observedAdjacencyEvents).toHaveLength(1)
  })

  it('rejects a stale path cursor and a cursor forged inside an uncommitted step', () => {
    const input = lifecycleInput()
    const pending = runAuthoritativeMovementLifecycle({
      ...input,
      state: createEmptyEncounterState(),
      handlers: [movementHandler([])],
    })
    if (pending.status !== 'pending-interrupt') throw new Error('expected pending movement')

    expect(() => runAuthoritativeMovementLifecycle({
      ...lifecycleInput(resolvedMovement(3)),
      state: pending.state,
      cursor: pending.cursor,
    })).toThrowError(expect.objectContaining({
      name: MovementLifecycleError.name,
      code: 'cursor-path-mismatch',
    }))

    expect(() => runAuthoritativeMovementLifecycle({
      ...input,
      state: pending.state,
      cursor: { ...pending.cursor, nextEventIndex: 1 },
    })).toThrowError(expect.objectContaining({
      name: MovementLifecycleError.name,
      code: 'invalid-cursor',
    }))
  })
})
