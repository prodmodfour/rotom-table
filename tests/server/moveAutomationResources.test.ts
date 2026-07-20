import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
  parseEncounterEvents,
  type EncounterEvent,
  type EncounterEventKind,
} from '#shared/moveAutomation/events'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { MoveSpecCostDeclaration } from '#shared/moveAutomation/spec'
import {
  ENCOUNTER_ACTED_SINCE_ENTRY_FLAG_ID,
  ENCOUNTER_EXHAUST_COMMAND_FLAG_ID,
  ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID,
  ENCOUNTER_PRIORITY_ADVANCED_NEXT_TURN_FLAG_ID,
  EncounterResourceReductionError,
  clearEncounterSetupExecuteState,
  observeEncounterMoveResources,
  setEncounterSetupExecuteState,
  spendEncounterMoveResourceCosts,
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

const cost = (
  id: string,
  resourceCost: MoveSpecCostDeclaration['cost'],
  phase: MoveSpecCostDeclaration['phase'] = 'pay',
): MoveSpecCostDeclaration => ({ id, phase, cost: resourceCost })

const spend = (
  resources: Parameters<typeof spendEncounterMoveResourceCosts>[0],
  costs: readonly MoveSpecCostDeclaration[],
  overrides: Partial<Parameters<typeof spendEncounterMoveResourceCosts>[1]> = {},
) => spendEncounterMoveResourceCosts(resources, {
  placementId: 'actor-token',
  canonicalMoveId: 'Test Move',
  resolutionId: 'resolution.resources.test',
  sourceOperationId: 'op.resources.test',
  costs,
  movementBudget: 6,
  movementDistance: 0,
  round: 2,
  turn: 4,
  actedThisRound: false,
  ...overrides,
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

  it('enforces every action family and Full action coupling without mutating failures', () => {
    const standard = spend({}, [cost('cost.standard', {
      kind: 'action-resource', resource: 'standard', amount: 1,
    })])
    const afterStandard = structuredClone(standard.resources)

    expect(() => spend(standard.resources, [cost('cost.standard-again', {
      kind: 'action-resource', resource: 'standard', amount: 1,
    })])).toThrowError(expect.objectContaining({
      name: EncounterResourceReductionError.name,
      code: 'action-unavailable',
    }))
    expect(standard.resources).toEqual(afterStandard)

    const standardThenShift = spend(standard.resources, [cost('cost.shift', {
      kind: 'action-resource', resource: 'shift', amount: 1,
    })])
    expect(createMoveAutomationResourceResolver(standardThenShift.resources)
      .actionSpent('actor-token', 'shift')).toBe(1)
    expect(() => spend(standard.resources, [cost('cost.full', {
      kind: 'action-resource', resource: 'full', amount: 1,
    })])).toThrowError(expect.objectContaining({ code: 'action-unavailable' }))

    const full = spend({}, [cost('cost.full', {
      kind: 'action-resource', resource: 'full', amount: 1,
    })])
    const fullQueries = createMoveAutomationResourceResolver(full.resources)
    expect(fullQueries.actionSpent('actor-token', 'full')).toBe(1)
    expect(fullQueries.actionAvailable('actor-token', 'standard')).toBe(false)
    expect(fullQueries.actionAvailable('actor-token', 'shift')).toBe(false)

    const freeTwice = spend(spend({}, [cost('cost.free-one', {
      kind: 'action-resource', resource: 'free', amount: 1,
    })]).resources, [cost('cost.free-two', {
      kind: 'action-resource', resource: 'free', amount: 1,
    })])
    expect(createMoveAutomationResourceResolver(freeTwice.resources)
      .actionSpent('actor-token', 'free')).toBe(2)

    for (const resourceType of ['swift', 'interrupt', 'reaction'] as const) {
      const first = spend({}, [cost(`cost.${resourceType}`, {
        kind: 'action-resource', resource: resourceType, amount: 1,
      })])
      expect(() => spend(first.resources, [cost(`cost.${resourceType}.again`, {
        kind: 'action-resource', resource: resourceType, amount: 1,
      })])).toThrowError(EncounterResourceReductionError)
    }
    const interrupt = spend({}, [cost('cost.interrupt', {
      kind: 'action-resource', resource: 'interrupt', amount: 1,
    })])
    expect(() => spend(interrupt.resources, [cost('cost.reaction', {
      kind: 'action-resource', resource: 'reaction', amount: 1,
    })])).toThrowError(expect.objectContaining({ code: 'reaction-unavailable' }))
  })

  it('enforces oracle distance and explicit once-per-turn resources atomically', () => {
    const first = spend({}, [
      cost('cost.distance', { kind: 'movement-distance', amount: 'resolved-distance' }, 'movement'),
      cost('cost.once', { kind: 'once-per-turn', flagId: 'feature.test-once' }, 'usage'),
    ], { movementDistance: 4 })
    const queries = createMoveAutomationResourceResolver(first.resources)
    expect(queries.movementBudget('actor-token')).toBe(6)
    expect(queries.movementSpent('actor-token')).toBe(4)
    expect(queries.hasOncePerTurnFlag('actor-token', 'feature.test-once')).toBe(true)

    const snapshot = structuredClone(first.resources)
    expect(() => spend(first.resources, [cost('cost.too-far', {
      kind: 'movement-distance', amount: 'resolved-distance',
    }, 'movement')], { movementDistance: 3 })).toThrowError(expect.objectContaining({
      code: 'movement-unavailable',
    }))
    expect(() => spend(first.resources, [cost('cost.once-again', {
      kind: 'once-per-turn', flagId: 'feature.test-once',
    }, 'usage')])).toThrowError(expect.objectContaining({
      code: 'once-per-turn-unavailable',
    }))
    expect(() => spend(first.resources, [cost('cost.no-current-budget', {
      kind: 'movement-distance', amount: 'resolved-distance',
    }, 'movement')], {
      movementBudget: null,
      movementDistance: 1,
    })).toThrowError(expect.objectContaining({ code: 'movement-unavailable' }))
    const actionOnly = spend(first.resources, [cost('cost.free', {
      kind: 'action-resource', resource: 'free', amount: 1,
    })], { movementBudget: null })
    expect(createMoveAutomationResourceResolver(actionOnly.resources)
      .movementBudget('actor-token')).toBe(6)
    expect(first.resources).toEqual(snapshot)

    const nextTurn = reduceEncounterLifecycle({
      ...createEmptyEncounterState(),
      turnResources: first.resources,
    }, [turnStart(2, 5)])
    const resetQueries = createMoveAutomationResourceResolver(nextTurn.state.turnResources)
    expect(resetQueries.hasOncePerTurnFlag('actor-token', 'feature.test-once')).toBe(false)
    expect(resetQueries.movementSpent('actor-token')).toBe(0)
  })

  it('tracks opening-action eligibility until an authoritative leave or scene boundary', () => {
    const marked = spend({}, [], { markActedSinceEntry: true })
    const markedAgain = spend(marked.resources, [], { markActedSinceEntry: true })
    const queries = createMoveAutomationResourceResolver(markedAgain.resources)

    expect(queries.actedSinceEntry('actor-token')).toBe(true)
    expect(queries.actedSinceEntry('untracked-token')).toBe(false)
    expect(queries.hasOncePerTurnFlag(
      'actor-token',
      ENCOUNTER_ACTED_SINCE_ENTRY_FLAG_ID,
    )).toBe(true)
    expect(queries.ledger('actor-token')?.oncePerTurnFlags.filter(
      flag => flag.id === ENCOUNTER_ACTED_SINCE_ENTRY_FLAG_ID,
    )).toHaveLength(1)

    const nextTurn = reduceEncounterLifecycle({
      ...createEmptyEncounterState(),
      turnResources: marked.resources,
    }, [turnStart(2, 5)])
    expect(createMoveAutomationResourceResolver(nextTurn.state.turnResources)
      .actedSinceEntry('actor-token')).toBe(true)

    const recalled = reduceEncounterLifecycle(nextTurn.state, [event(
      'recall',
      'event.opening.recall',
      { placementId: 'actor-token', sideId: 'heroes' },
    )])
    expect(createMoveAutomationResourceResolver(recalled.state.turnResources)
      .actedSinceEntry('actor-token')).toBe(false)

    const turnEnded = reduceEncounterLifecycle(createEmptyEncounterState(), [event(
      'turn-end',
      'event.opening.turn-end',
      { round: 2, turn: 5, placementId: 'actor-token', sideId: 'heroes' },
    )])
    expect(createMoveAutomationResourceResolver(turnEnded.state.turnResources)
      .actedSinceEntry('actor-token')).toBe(true)

    const sentOut = reduceEncounterLifecycle(turnEnded.state, [event(
      'send-out',
      'event.opening.send-out',
      { placementId: 'actor-token', sideId: 'heroes' },
    )])
    expect(createMoveAutomationResourceResolver(sentOut.state.turnResources)
      .actedSinceEntry('actor-token')).toBe(false)
  })

  it('schedules Exhaust and advanced Priority forfeits at the next authoritative turn', () => {
    const exhausted = spend({}, [
      cost('cost.standard', { kind: 'action-resource', resource: 'standard', amount: 1 }),
      cost('cost.exhaust', {
        kind: 'exhaust', timing: 'next-turn', forfeitCommand: true,
      }, 'cleanup'),
    ])
    const exhaustedQueries = createMoveAutomationResourceResolver(exhausted.resources)
    expect(exhaustedQueries.hasOncePerTurnFlag(
      'actor-token',
      ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID,
    )).toBe(true)
    expect(exhaustedQueries.hasOncePerTurnFlag(
      'actor-token',
      ENCOUNTER_EXHAUST_COMMAND_FLAG_ID,
    )).toBe(true)

    const nextTurn = reduceEncounterLifecycle({
      ...createEmptyEncounterState(),
      turnResources: exhausted.resources,
    }, [turnStart(2, 5)])
    const nextTurnQueries = createMoveAutomationResourceResolver(nextTurn.state.turnResources)
    expect(nextTurnQueries.actionSpent('actor-token', 'standard')).toBe(1)
    expect(nextTurnQueries.actionSpent('actor-token', 'shift')).toBe(1)
    expect(nextTurnQueries.hasOncePerTurnFlag(
      'actor-token',
      ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID,
    )).toBe(false)

    const shifted = spend({}, [cost('cost.shift', {
      kind: 'action-resource', resource: 'shift', amount: 1,
    })])
    expect(() => spend(shifted.resources, [cost('cost.exhaust', {
      kind: 'exhaust', timing: 'next-turn', forfeitCommand: false,
    })])).toThrowError(expect.objectContaining({ code: 'exhaust-prerequisite-failed' }))

    const advanced = spend({}, [cost('cost.priority', {
      kind: 'priority', mode: 'advanced',
    }, 'declare')], { actedThisRound: true })
    expect(createMoveAutomationResourceResolver(advanced.resources).hasOncePerTurnFlag(
      'actor-token',
      ENCOUNTER_PRIORITY_ADVANCED_NEXT_TURN_FLAG_ID,
    )).toBe(true)
    expect(() => spend({}, [cost('cost.priority', {
      kind: 'priority', mode: 'standard',
    }, 'declare')], { actedThisRound: true })).toThrowError(expect.objectContaining({
      code: 'priority-unavailable',
    }))
  })

  it('enforces Set-Up/Execute identity while allowing reviewed no-cost exceptions', () => {
    const setup = spend({}, [cost('cost.setup', {
      kind: 'setup-execute', step: 'set-up',
    }, 'schedule')])
    expect(createMoveAutomationResourceResolver(setup.resources)
      .setupExecuteState('actor-token')).toMatchObject({
      canonicalMoveId: 'Test Move',
      status: 'setting-up',
    })
    expect(() => spend(setup.resources, [cost('cost.setup-again', {
      kind: 'setup-execute', step: 'set-up',
    }, 'schedule')])).toThrowError(expect.objectContaining({ code: 'setup-state-conflict' }))

    const readiedByTurn = reduceEncounterLifecycle({
      ...createEmptyEncounterState(),
      turnResources: setup.resources,
    }, [turnStart(2, 5)]).state.turnResources
    expect(createMoveAutomationResourceResolver(readiedByTurn)
      .setupExecuteState('actor-token')).toMatchObject({ status: 'ready-to-execute' })

    const settingUp = setup.resources['actor-token']!
    const ready = {
      ...setup.resources,
      'actor-token': {
        ...settingUp,
        setupExecute: { ...settingUp.setupExecute!, status: 'ready-to-execute' as const },
      },
    }
    expect(() => spend(ready, [cost('cost.execute-wrong-move', {
      kind: 'setup-execute', step: 'execute',
    }, 'declare')], {
      canonicalMoveId: 'Different Move',
    })).toThrowError(expect.objectContaining({ code: 'setup-state-conflict' }))
    const executed = spend(ready, [cost('cost.execute', {
      kind: 'setup-execute', step: 'execute',
    }, 'declare')])
    expect(createMoveAutomationResourceResolver(executed.resources)
      .setupExecuteState('actor-token')).toBeNull()

    const autoSetup = spend({}, [cost('cost.setup-auto', {
      kind: 'setup-execute', step: 'auto',
    }, 'declare')])
    expect(createMoveAutomationResourceResolver(autoSetup.resources)
      .setupExecuteState('actor-token')).toMatchObject({ status: 'setting-up' })
    const autoExecute = spend(ready, [cost('cost.execute-auto', {
      kind: 'setup-execute', step: 'auto',
    }, 'declare')])
    expect(createMoveAutomationResourceResolver(autoExecute.resources)
      .setupExecuteState('actor-token')).toBeNull()

    const waivedInput = {}
    const waived = spend(waivedInput, [cost('cost.waived', {
      kind: 'no-cost', reasonCode: 'move.triggered-child',
    }, 'declare')])
    const waivedQueries = createMoveAutomationResourceResolver(waived.resources)
    expect(waived.resources).toEqual(waivedInput)
    expect(waivedQueries.actionSpent('actor-token', 'standard')).toBe(0)
    expect(waived.spends).toEqual([expect.objectContaining({
      costId: 'cost.waived',
      resourceId: null,
      amount: 0,
    })])
    expect(Object.isFrozen(waived)).toBe(true)
    expect(Object.isFrozen(waived.spends)).toBe(true)
  })

  it('rejects malformed runtime declarations before reducing any resource', () => {
    const resources = spend({}, [cost('cost.free', {
      kind: 'action-resource', resource: 'free', amount: 1,
    })]).resources
    const snapshot = structuredClone(resources)

    expect(() => spend(resources, [{
      id: 'cost.client-authored',
      phase: 'pay',
      cost: {
        kind: 'action-resource',
        resource: 'standard',
        amount: 1,
        patch: { standard: 0 },
      },
    } as never])).toThrowError(expect.objectContaining({
      name: EncounterResourceReductionError.name,
      code: 'invalid-resource-cost',
    }))
    expect(resources).toEqual(snapshot)
  })
})
