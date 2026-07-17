import { describe, expect, it } from 'vitest'
import {
  parseEncounterEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
  type EncounterEvent,
  type EncounterEventKind,
} from '#shared/moveAutomation/events'
import type {
  MoveLogEffectOperation,
  MoveReactionRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  createEmptyEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  ENCOUNTER_LIFECYCLE_LIMITS,
  EncounterLifecycleReductionError,
  reduceEncounterLifecycle,
  type EncounterLifecycleTriggerHandler,
} from '~~/server/domain/moveAutomation/reduceLifecycle'
import {
  capabilityEncounterEffectFixture,
  conditionEncounterEffectFixture,
  numericEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const effectFrom = (
  base: EncounterEffect,
  overrides: Record<string, unknown>,
): EncounterEffect => parseEncounterEffect({ ...base, ...overrides })

const stateWithEffects = (
  effects: readonly EncounterEffect[],
): EncounterState => ({
  ...createEmptyEncounterState(),
  effects,
})

const eventEnvelope = (
  kind: EncounterEventKind,
  eventId: string,
  causalParentEventId: string | null = null,
): Record<string, unknown> => ({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId,
  kind,
  sourceOperationId: 'op.lifecycle.test',
  causalParentEventId,
  reasonCode: `${kind}.test`,
})

const roundEvent = (
  kind: 'round-start' | 'round-end',
  eventId: string,
  round = 2,
  parent: string | null = null,
): EncounterEvent => parseEncounterEvent({
  ...eventEnvelope(kind, eventId, parent),
  round,
})

const turnEvent = (
  kind: 'turn-start' | 'turn-end',
  eventId: string,
  placementId: string,
): EncounterEvent => parseEncounterEvent({
  ...eventEnvelope(kind, eventId),
  round: 2,
  turn: 5,
  placementId,
  sideId: null,
})

const lifecycleMoveIdentity = () => ({
  resolutionId: 'resolution.lifecycle.test',
  canonicalId: 'Lifecycle Test',
  specVersion: 2,
  actorPlacementId: 'actor-token',
  actionType: 'standard' as const,
  origin: { kind: 'direct' as const },
  moveListSource: { kind: 'placement' as const, placementId: 'actor-token' },
})

const moveHitEvent = (
  eventId: string,
  parent: string | null = null,
): EncounterEvent => parseEncounterEvent({
  ...eventEnvelope('move-hit', eventId, parent),
  move: lifecycleMoveIdentity(),
  targetPlacementId: 'target-token',
  hitIndex: 1,
})

const moveDeclaredEvent = (eventId: string): EncounterEvent => parseEncounterEvent({
  ...eventEnvelope('move-declared', eventId),
  move: lifecycleMoveIdentity(),
  targetPlacementIds: ['target-token'],
})

const moveCompletedEvent = (
  eventId: string,
  parent: string,
): EncounterEvent => parseEncounterEvent({
  ...eventEnvelope('move-completed', eventId, parent),
  move: lifecycleMoveIdentity(),
  attackedTargetIds: ['target-token'],
  hitTargetIds: ['target-token'],
  outcome: 'hit',
  succeeded: true,
  branches: [],
})

const logOperation = (
  id: string,
  source: MoveLogEffectOperation['source'],
): MoveLogEffectOperation => ({
  id,
  kind: 'log',
  source,
  recipients: { kind: 'none' },
  phase: 'cleanup',
  reasonCode: 'lifecycle.triggered-log',
  payload: {
    messageKey: 'move.lifecycle.triggered',
    arguments: [],
  },
})

const reactionOperation = (
  id: string,
  eventId: string,
): MoveReactionRequestEffectOperation => ({
  id,
  kind: 'reaction-request',
  source: { kind: 'lifecycle-event', id: eventId },
  recipients: { kind: 'actor' },
  phase: 'movement',
  reasonCode: 'lifecycle.pending-interrupt',
  payload: {
    requestId: `${id}.request`,
    promptKey: 'lifecycle.pending-interrupt',
    options: [{ id: 'option.react', labelKey: 'lifecycle.react' }],
    allowPass: true,
    timing: 'movement-step',
    priority: 0,
  },
})

const uncharged = {
  charges: null,
  chargePolicy: { kind: 'none', amount: null },
} as const

const permanent = { kind: 'permanent', remaining: null } as const

describe('pure encounter lifecycle reducer', () => {
  it('reduces root events in order, expires effects, updates counters, and stays immutable', () => {
    const turnEffect = effectFrom(conditionEncounterEffectFixture(), {
      id: 'effect.turn-end',
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
      ...uncharged,
    })
    const roundEffect = effectFrom(capabilityEncounterEffectFixture(), {
      id: 'effect.round-end',
      duration: { kind: 'rounds', boundary: 'end', remaining: 2 },
    })
    const sceneEffect = effectFrom(conditionEncounterEffectFixture(), {
      id: 'effect.scene-end',
      duration: { kind: 'scene', remaining: null },
      ...uncharged,
    })
    const lastingEffect = effectFrom(capabilityEncounterEffectFixture(), {
      id: 'effect.permanent',
      duration: permanent,
    })
    const state = stateWithEffects([
      turnEffect,
      roundEffect,
      sceneEffect,
      lastingEffect,
    ])
    const events = [
      turnEvent('turn-end', 'event.turn-end.1', 'target-token'),
      roundEvent('round-end', 'event.round-end.1'),
      parseEncounterEvent({
        ...eventEnvelope('scene-end', 'event.scene-end.1'),
        sceneId: 'scene.test.1',
      }),
    ]

    const first = reduceEncounterLifecycle(state, events)
    const replay = reduceEncounterLifecycle(state, events)

    expect(first).toEqual(replay)
    expect(first.processedEvents.map(event => event.eventId)).toEqual([
      'event.turn-end.1',
      'event.round-end.1',
      'event.scene-end.1',
    ])
    expect(first.state.effects.map(effect => effect.id)).toEqual([
      'effect.round-end',
      'effect.permanent',
    ])
    expect(first.state.effects[0]?.duration).toEqual({
      kind: 'rounds',
      boundary: 'end',
      remaining: 1,
    })
    expect(first.transitions.map(entry => entry.transition.kind)).toEqual([
      'expired',
      'duration-decremented',
      'expired',
    ])
    expect(first.counters).toEqual({
      initialEventCount: 3,
      processedEventCount: 3,
      emittedEventCount: 0,
      triggerCount: 0,
      operationCount: 0,
      effectTransitionCount: 3,
      fieldTransitionCount: 0,
      maximumDepth: 0,
    })
    expect(first.trace.map(entry => entry.kind)).toEqual([
      'event',
      'effect-transition',
      'event',
      'effect-transition',
      'event',
      'effect-transition',
    ])
    expect(first.trace.map(entry => entry.sequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(state.effects).toEqual([
      turnEffect,
      roundEffect,
      sceneEffect,
      lastingEffect,
    ])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.state)).toBe(true)
    expect(Object.isFrozen(first.trace)).toBe(true)
    expect(Object.isFrozen(first.trace[0])).toBe(true)
  })

  it('consumes exact active-effect charges and enqueues only parsed typed operations', () => {
    const charged = effectFrom(numericEncounterEffectFixture(), {
      id: 'effect.charged-trigger',
      duration: permanent,
      charges: 2,
      chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
    })
    let frozenContextObserved = false
    const handler: EncounterLifecycleTriggerHandler = {
      id: 'handler.charged-trigger',
      resolve: (context) => {
        frozenContextObserved = Object.isFrozen(context)
          && Object.isFrozen(context.state)
          && Object.isFrozen(context.effectsAtEventStart)
        if (context.event.kind !== 'move-hit') return []
        return [{
          effectId: charged.id,
          reasonCode: 'effect.triggered-on-hit',
          operations: [logOperation(
            `operation.log.${context.event.eventId}`,
            { kind: 'encounter-effect', id: charged.id },
          )],
          emittedEvents: [],
        }]
      },
    }

    const result = reduceEncounterLifecycle(
      stateWithEffects([charged]),
      [moveHitEvent('event.move-hit.1'), moveHitEvent('event.move-hit.2')],
      [handler],
    )

    expect(frozenContextObserved).toBe(true)
    expect(result.state.effects).toEqual([])
    expect(result.operations.map(operation => operation.id)).toEqual([
      'operation.log.event.move-hit.1',
      'operation.log.event.move-hit.2',
    ])
    expect(result.transitions.map(entry => ({
      eventId: entry.eventId,
      kind: entry.transition.kind,
      reasonCode: entry.transition.reasonCode,
    }))).toEqual([
      {
        eventId: 'event.move-hit.1',
        kind: 'charge-consumed',
        reasonCode: 'effect-charge-consumed',
      },
      {
        eventId: 'event.move-hit.2',
        kind: 'expired',
        reasonCode: 'effect-charges-depleted',
      },
    ])
    expect(result.counters).toMatchObject({
      processedEventCount: 2,
      triggerCount: 2,
      operationCount: 2,
      effectTransitionCount: 2,
    })
    expect(result.trace.map(entry => entry.kind)).toEqual([
      'event',
      'trigger',
      'effect-transition',
      'operation-enqueued',
      'event',
      'trigger',
      'effect-transition',
      'operation-enqueued',
    ])
    expect(result.operations.every(operation => Object.isFrozen(operation))).toBe(true)
  })

  it('surfaces typed reaction requests as explicit pending-interrupt signals', () => {
    const event = moveHitEvent('event.pending-interrupt')
    const handler: EncounterLifecycleTriggerHandler = {
      id: 'handler.pending-interrupt',
      resolve: ({ event: current }) => [{
        effectId: null,
        reasonCode: 'lifecycle.pending-interrupt',
        operations: [reactionOperation('operation.pending-interrupt', current.eventId)],
        emittedEvents: [],
      }],
    }

    const result = reduceEncounterLifecycle(
      stateWithEffects([]),
      [event],
      [handler],
    )

    expect(result.pendingInterrupts).toEqual([{
      eventId: event.eventId,
      eventKind: 'move-hit',
      operation: result.operations[0],
    }])
    expect(result.pendingInterrupts[0]?.operation.kind).toBe('reaction-request')
    expect(Object.isFrozen(result.pendingInterrupts)).toBe(true)
    expect(Object.isFrozen(result.pendingInterrupts[0])).toBe(true)
  })

  it('applies effect facts and reduces emitted children depth-first in declared order', () => {
    const effect = effectFrom(conditionEncounterEffectFixture(), {
      id: 'effect.recursive-child',
      source: {
        ...conditionEncounterEffectFixture().source,
        operationId: 'op.lifecycle.test',
      },
      duration: permanent,
      ...uncharged,
    })
    const handler: EncounterLifecycleTriggerHandler = {
      id: 'handler.recursive-events',
      resolve: ({ event }) => {
        if (event.eventId === 'event.root') {
          return [{
            effectId: null,
            reasonCode: 'lifecycle.emit-add',
            operations: [],
            emittedEvents: [parseEncounterEvent({
              ...eventEnvelope('effect-added', 'event.child.add', event.eventId),
              effect,
            })],
          }]
        }
        if (event.eventId === 'event.child.add') {
          return [{
            effectId: null,
            reasonCode: 'lifecycle.emit-remove',
            operations: [],
            emittedEvents: [parseEncounterEvent({
              ...eventEnvelope('effect-removed', 'event.grandchild.remove', event.eventId),
              effectId: effect.id,
            })],
          }]
        }
        return []
      },
    }

    const result = reduceEncounterLifecycle(
      stateWithEffects([]),
      [
        moveDeclaredEvent('event.root.declared'),
        moveCompletedEvent('event.root', 'event.root.declared'),
        roundEvent('round-end', 'event.second-root'),
      ],
      [handler],
    )

    expect(result.processedEvents.map(event => event.eventId)).toEqual([
      'event.root.declared',
      'event.root',
      'event.child.add',
      'event.grandchild.remove',
      'event.second-root',
    ])
    expect(result.emittedEvents.map(event => event.eventId)).toEqual([
      'event.child.add',
      'event.grandchild.remove',
    ])
    expect(result.transitions.map(entry => entry.transition.kind)).toEqual([
      'added',
      'removed',
    ])
    expect(result.state.effects).toEqual([])
    expect(result.state.history.lastCompletedMoves).toMatchObject([{
      resolutionId: 'resolution.lifecycle.test',
      canonicalId: 'Lifecycle Test',
      actorPlacementId: 'actor-token',
    }])
    expect(result.changed).toBe(true)
    expect(result.counters).toMatchObject({
      initialEventCount: 3,
      processedEventCount: 5,
      emittedEventCount: 2,
      triggerCount: 2,
      maximumDepth: 2,
    })
  })

  it('fails closed on invalid operation provenance and suppressed effect triggers', () => {
    const effect = effectFrom(numericEncounterEffectFixture(), {
      id: 'effect.source-check',
      duration: permanent,
      charges: 2,
    })
    const invalidSource: EncounterLifecycleTriggerHandler = {
      id: 'handler.invalid-source',
      resolve: ({ event }) => [{
        effectId: effect.id,
        reasonCode: 'effect.invalid-source',
        operations: [logOperation('operation.invalid-source', {
          kind: 'move',
          id: 'move.forged',
        })],
        emittedEvents: [],
      }],
    }

    expect(() => reduceEncounterLifecycle(
      stateWithEffects([effect]),
      [moveHitEvent('event.source-check')],
      [invalidSource],
    )).toThrowError(expect.objectContaining({
      name: EncounterLifecycleReductionError.name,
      code: 'invalid-operation-source',
    }))

    const suppressor = effectFrom(capabilityEncounterEffectFixture(), {
      id: 'effect.suppressor',
      duration: permanent,
    })
    const suppressed = effectFrom(effect, {
      suppression: {
        sources: [{ effectId: suppressor.id, reasonCode: 'effect.suppressed' }],
      },
    })
    const suppressedHandler: EncounterLifecycleTriggerHandler = {
      id: 'handler.suppressed',
      resolve: () => [{
        effectId: suppressed.id,
        reasonCode: 'effect.illegal-trigger',
        operations: [],
        emittedEvents: [],
      }],
    }

    expect(() => reduceEncounterLifecycle(
      stateWithEffects([suppressor, suppressed]),
      [moveHitEvent('event.suppressed')],
      [suppressedHandler],
    )).toThrowError(expect.objectContaining({
      name: EncounterLifecycleReductionError.name,
      code: 'suppressed-trigger-effect',
    }))
  })

  it('enforces recursion and aggregate emitted-event limits before unbounded work', () => {
    const recursiveHandler: EncounterLifecycleTriggerHandler = {
      id: 'handler.recursion-limit',
      resolve: ({ event }) => {
        const match = /^event\.depth\.(\d+)$/.exec(event.eventId)
        if (!match) return []
        const next = Number(match[1]) + 1
        return [{
          effectId: null,
          reasonCode: 'lifecycle.recurse',
          operations: [],
          emittedEvents: [roundEvent(
            'round-start',
            `event.depth.${next}`,
            2,
            event.eventId,
          )],
        }]
      },
    }

    expect(() => reduceEncounterLifecycle(
      stateWithEffects([]),
      [roundEvent('round-start', 'event.depth.0')],
      [recursiveHandler],
    )).toThrowError(expect.objectContaining({
      name: EncounterLifecycleReductionError.name,
      code: 'recursion-limit-exceeded',
    }))

    const children = Array.from(
      { length: ENCOUNTER_LIFECYCLE_LIMITS.emittedEvents },
      (_, index) => roundEvent(
        'round-start',
        `event.emitted.${index}`,
        2,
        'event.emitted.root',
      ),
    )
    const emittedLimitHandler: EncounterLifecycleTriggerHandler = {
      id: 'handler.emitted-limit',
      resolve: ({ event }) => {
        if (event.eventId === 'event.emitted.root') {
          return [{
            effectId: null,
            reasonCode: 'lifecycle.fill-emitted-budget',
            operations: [],
            emittedEvents: children,
          }]
        }
        if (event.eventId === 'event.emitted.0') {
          return [{
            effectId: null,
            reasonCode: 'lifecycle.exceed-emitted-budget',
            operations: [],
            emittedEvents: [roundEvent(
              'round-start',
              'event.emitted.overflow',
              2,
              event.eventId,
            )],
          }]
        }
        return []
      },
    }

    expect(() => reduceEncounterLifecycle(
      stateWithEffects([]),
      [roundEvent('round-start', 'event.emitted.root')],
      [emittedLimitHandler],
    )).toThrowError(expect.objectContaining({
      name: EncounterLifecycleReductionError.name,
      code: 'emitted-event-limit-exceeded',
    }))
  })
})
