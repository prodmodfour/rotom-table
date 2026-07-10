import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
  parseEncounterEvents,
  type EncounterEvent,
  type EncounterEventKind,
} from '#shared/moveAutomation/events'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  clearEncounterSetupExecuteState,
  observeEncounterMoveResources,
  setEncounterSetupExecuteState,
} from '~~/server/domain/moveAutomation/reduceEncounterResources'
import { createMoveAutomationResourceResolver } from '~~/server/domain/moveAutomation/resources'
import {
  reduceEncounterLifecycle,
  type EncounterLifecycleTriggerHandler,
} from '~~/server/domain/moveAutomation/reduceLifecycle'

const envelope = (
  kind: EncounterEventKind,
  eventId: string,
): Record<string, unknown> => ({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId,
  kind,
  sourceOperationId: 'op.resources.test',
  causalParentEventId: null,
  reasonCode: `resources.${kind}`,
})

const event = (
  kind: EncounterEventKind,
  eventId: string,
  fields: Record<string, unknown>,
): EncounterEvent => parseEncounterEvent({ ...envelope(kind, eventId), ...fields })

const turnStart = (round: number, turn: number): EncounterEvent => event(
  'turn-start',
  `event.turn.${round}.${turn}`,
  { round, turn, placementId: 'actor-token', sideId: 'heroes' },
)

const resource = (
  kind: 'resource-spent' | 'resource-restored',
  eventId: string,
  resourceId: string,
  amount = 1,
): EncounterEvent => event(kind, eventId, {
  placementId: 'actor-token',
  resourceId,
  amount,
})

describe('authoritative encounter action resources', () => {
  it('observes accepted spends without enforcing budget and resets exact timing windows', () => {
    const events = parseEncounterEvents([
      event('round-start', 'event.round.2', { round: 2 }),
      turnStart(2, 4),
      resource('resource-spent', 'event.action.standard.1', 'action.standard'),
      resource('resource-spent', 'event.action.standard.2', 'action.standard'),
      resource('resource-spent', 'event.action.swift.1', 'action.swift'),
      resource('resource-spent', 'event.reaction.1', 'reaction.available'),
      resource('resource-spent', 'event.movement.1', 'movement', 3),
      resource('resource-spent', 'event.flag.1', 'once-per-turn.move.scratch'),
    ])
    const spent = reduceEncounterLifecycle(createEmptyEncounterState(), events)
    const queries = createMoveAutomationResourceResolver(spent.state.turnResources)

    expect(queries.ledger('actor-token')).toMatchObject({ round: 2, turn: 4 })
    expect(queries.actionSpent('actor-token', 'standard')).toBe(2)
    expect(queries.actionRemaining('actor-token', 'standard')).toBe(0)
    expect(queries.actionAvailable('actor-token', 'standard')).toBe(false)
    expect(queries.actionSpent('actor-token', 'swift')).toBe(1)
    expect(queries.reactionAvailable('actor-token')).toBe(false)
    expect(queries.movementSpent('actor-token')).toBe(3)
    expect(queries.movementRemaining('actor-token')).toBeNull()
    expect(queries.hasOncePerTurnFlag('actor-token', 'move.scratch')).toBe(true)
    expect(queries.reactionAvailable('untracked-token')).toBe(false)

    const nextRound = reduceEncounterLifecycle(spent.state, [event(
      'round-start',
      'event.round.3',
      { round: 3 },
    )])
    const roundQueries = createMoveAutomationResourceResolver(nextRound.state.turnResources)
    expect(roundQueries.ledger('actor-token')).toMatchObject({ round: 3, turn: null })
    expect(roundQueries.actionSpent('actor-token', 'swift')).toBe(0)
    expect(roundQueries.reactionAvailable('actor-token')).toBe(true)
    expect(roundQueries.actionSpent('actor-token', 'standard')).toBe(2)

    const nextTurn = reduceEncounterLifecycle(nextRound.state, [turnStart(3, 8)])
    const turnQueries = createMoveAutomationResourceResolver(nextTurn.state.turnResources)
    expect(turnQueries.actionSpent('actor-token', 'standard')).toBe(0)
    expect(turnQueries.movementSpent('actor-token')).toBe(0)
    expect(turnQueries.hasOncePerTurnFlag('actor-token', 'move.scratch')).toBe(false)
  })

  it('records move action, reaction, movement, flags, and setup/execute state through pure helpers', () => {
    const observed = observeEncounterMoveResources({}, {
      placementId: 'actor-token',
      actionType: 'full',
      consumesReaction: true,
      movementBudget: 8,
      movementSpent: 5,
      oncePerTurnFlagId: 'move.fly',
      sourceOperationId: 'op_fly000001',
      round: 4,
      turn: 12,
    })
    const withSetup = setEncounterSetupExecuteState(observed, {
      placementId: 'actor-token',
      canonicalMoveId: 'Fly',
      resolutionId: 'resolution.fly.1',
      sourceOperationId: 'op_fly000001',
      status: 'ready-to-execute',
      round: 4,
      turn: 12,
    })
    const queries = createMoveAutomationResourceResolver(withSetup)

    expect(queries.actionSpent('actor-token', 'full')).toBe(1)
    expect(queries.actionSpent('actor-token', 'standard')).toBe(1)
    expect(queries.actionSpent('actor-token', 'shift')).toBe(1)
    expect(queries.reactionAvailable('actor-token')).toBe(false)
    expect(queries.movementBudget('actor-token')).toBe(8)
    expect(queries.movementSpent('actor-token')).toBe(5)
    expect(queries.movementRemaining('actor-token')).toBe(3)
    expect(queries.hasOncePerTurnFlag('actor-token', 'move.fly')).toBe(true)
    expect(queries.setupExecuteState('actor-token')).toMatchObject({
      canonicalMoveId: 'Fly',
      status: 'ready-to-execute',
      resetOn: ['scene-end', 'recall', 'knockout'],
    })

    const recalled = reduceEncounterLifecycle({
      ...createEmptyEncounterState(),
      turnResources: withSetup,
    }, [event('recall', 'event.recall.actor', {
      placementId: 'actor-token',
      sideId: 'heroes',
    })])
    expect(createMoveAutomationResourceResolver(recalled.state.turnResources)
      .setupExecuteState('actor-token')).toBeNull()
    expect(clearEncounterSetupExecuteState(withSetup, 'actor-token')['actor-token']?.setupExecute)
      .toBeNull()
  })

  it('lets scene-end handlers inspect outgoing resources and then clears them', () => {
    const populated = observeEncounterMoveResources({}, {
      placementId: 'actor-token',
      actionType: 'standard',
      consumesReaction: false,
      movementBudget: 6,
      movementSpent: 0,
      oncePerTurnFlagId: 'move.scratch',
      sourceOperationId: 'op_scratch01',
      round: 1,
      turn: 0,
    })
    let observedStandardSpend = 0
    const handler: EncounterLifecycleTriggerHandler = {
      id: 'handler.resources.scene-end-observer',
      resolve: ({ event: lifecycleEvent, state }) => {
        if (lifecycleEvent.kind === 'scene-end') {
          observedStandardSpend = createMoveAutomationResourceResolver(state.turnResources)
            .actionSpent('actor-token', 'standard')
        }
        return []
      },
    }
    const result = reduceEncounterLifecycle({
      ...createEmptyEncounterState(),
      turnResources: populated,
    }, [event('scene-end', 'event.scene.end', { sceneId: 'scene.resources.1' })], [handler])

    expect(observedStandardSpend).toBe(1)
    expect(result.state.turnResources).toEqual({})
  })
})
