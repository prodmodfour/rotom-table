import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
  parseEncounterEvents,
  type EncounterEvent,
  type EncounterEventKind,
  type EncounterMoveIdentity,
} from '#shared/moveAutomation/events'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createMoveAutomationHistoryResolver } from '~~/server/domain/moveAutomation/history'
import { reduceEncounterLifecycle } from '~~/server/domain/moveAutomation/reduceLifecycle'
import type { EncounterLifecycleTriggerHandler } from '~~/server/domain/moveAutomation/reduceLifecycle'

const envelope = (
  kind: EncounterEventKind,
  eventId: string,
  causalParentEventId: string | null = null,
): Record<string, unknown> => ({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId,
  kind,
  sourceOperationId: 'op.history.test',
  causalParentEventId,
  reasonCode: `history.${kind}`,
})

const move = (
  resolutionId: string,
  canonicalId: string,
  actorPlacementId: string,
  options: Partial<Pick<
    EncounterMoveIdentity,
    'specVersion' | 'actionType' | 'origin' | 'moveListSource'
  >> = {},
): EncounterMoveIdentity => ({
  resolutionId,
  canonicalId,
  specVersion: options.specVersion ?? 2,
  actorPlacementId,
  actionType: options.actionType ?? 'standard',
  origin: options.origin ?? { kind: 'direct' },
  moveListSource: options.moveListSource ?? { kind: 'placement', placementId: actorPlacementId },
})

const moveEvent = (
  kind: Extract<
    EncounterEventKind,
    'move-declared' | 'move-hit' | 'move-damaged' | 'move-ko' | 'move-completed'
  >,
  eventId: string,
  moveIdentity: EncounterMoveIdentity,
  fields: Record<string, unknown>,
  parent: string | null = null,
): EncounterEvent => parseEncounterEvent({
  ...envelope(kind, eventId, parent),
  move: moveIdentity,
  ...fields,
})

const historyEvents = (): readonly EncounterEvent[] => {
  const furyOne = move('resolution.fury.1', 'Fury Cutter', 'actor-token')
  const child = move('resolution.child.1', 'Follow Up', 'helper-token', {
    specVersion: 3,
    actionType: 'free',
    origin: { kind: 'random', sourceResolutionId: 'resolution.fury.1' },
    moveListSource: { kind: 'reviewed-pool', poolId: 'pool.follow-up' },
  })
  const furyTwo = move('resolution.fury.2', 'Fury Cutter', 'actor-token')
  return parseEncounterEvents([
    { ...envelope('scene-start', 'event.scene.start'), sceneId: 'scene.history.1' },
    { ...envelope('round-start', 'event.round.start'), round: 2 },
    {
      ...envelope('turn-start', 'event.turn.start'),
      round: 2,
      turn: 4,
      placementId: 'actor-token',
      sideId: 'heroes',
    },
    moveEvent(
      'move-declared',
      'event.fury.1.declared',
      furyOne,
      { targetPlacementIds: ['target-token'] },
    ),
    moveEvent(
      'move-damaged',
      'event.fury.1.damage.1',
      furyOne,
      {
        targetPlacementId: 'target-token',
        hitIndex: 1,
        damage: {
          hitPointLoss: 7,
          temporaryHitPointLoss: 3,
          damageClass: 'physical',
          moveType: 'bug',
        },
      },
      'event.fury.1.declared',
    ),
    moveEvent(
      'move-damaged',
      'event.fury.1.damage.2',
      furyOne,
      {
        targetPlacementId: 'target-token',
        hitIndex: 2,
        damage: {
          hitPointLoss: 5,
          temporaryHitPointLoss: 0,
          damageClass: 'physical',
          moveType: 'bug',
        },
      },
      'event.fury.1.damage.1',
    ),
    moveEvent(
      'move-ko',
      'event.fury.1.ko',
      furyOne,
      { targetPlacementId: 'target-token', hitIndex: 2 },
      'event.fury.1.damage.2',
    ),
    moveEvent(
      'move-declared',
      'event.child.declared',
      child,
      { targetPlacementIds: ['target-token'] },
      'event.fury.1.ko',
    ),
    moveEvent(
      'move-completed',
      'event.child.completed',
      child,
      {
        attackedTargetIds: ['target-token'],
        hitTargetIds: [],
        outcome: 'miss',
        succeeded: false,
        branches: [{
          selectionId: 'follow-up.outcome',
          recipientId: 'target-token',
          branchId: 'follow-up.miss',
        }],
      },
      'event.child.declared',
    ),
    moveEvent(
      'move-completed',
      'event.fury.1.completed',
      furyOne,
      {
        attackedTargetIds: ['target-token'],
        hitTargetIds: ['target-token'],
        outcome: 'hit',
        succeeded: true,
        branches: [{
          selectionId: 'fury.outcome',
          recipientId: 'target-token',
          branchId: 'fury.hit',
        }],
      },
      'event.child.completed',
    ),
    moveEvent(
      'move-declared',
      'event.fury.2.declared',
      furyTwo,
      { targetPlacementIds: ['target-token'] },
    ),
    moveEvent(
      'move-completed',
      'event.fury.2.completed',
      furyTwo,
      {
        attackedTargetIds: ['target-token'],
        hitTargetIds: [],
        outcome: 'miss',
        succeeded: false,
        branches: [{
          selectionId: 'fury.outcome',
          recipientId: 'target-token',
          branchId: 'fury.miss',
        }],
      },
      'event.fury.2.declared',
    ),
    {
      ...envelope('switch', 'event.target.switch'),
      recalledPlacementId: 'target-token',
      sentOutPlacementId: 'replacement-token',
    },
  ])
}

describe('bounded encounter move history', () => {
  it('indexes authoritative move, damage, action, switch, KO, chain, and ancestry facts', () => {
    const result = reduceEncounterLifecycle(createEmptyEncounterState(), historyEvents())
    const { history } = result.state
    const queries = createMoveAutomationHistoryResolver(history)

    expect(history).toMatchObject({
      sceneId: 'scene.history.1',
      currentRound: 2,
      currentTurn: { round: 2, turn: 4, placementId: 'actor-token' },
      actedThisTurnPlacementIds: ['actor-token', 'helper-token'],
      actedThisRoundPlacementIds: ['actor-token', 'helper-token'],
      switchedPlacementIds: ['target-token', 'replacement-token'],
      faintedPlacementIds: ['target-token'],
    })
    expect(queries.lastDeclaredMove('actor-token')).toMatchObject({
      resolutionId: 'resolution.fury.2',
      canonicalId: 'Fury Cutter',
    })
    expect(queries.lastCompletedMove('actor-token')).toMatchObject({
      resolutionId: 'resolution.fury.2',
      canonicalId: 'Fury Cutter',
      specVersion: 2,
      actionType: 'standard',
      origin: { kind: 'direct' },
      moveListSource: { kind: 'placement', placementId: 'actor-token' },
      outcome: 'miss',
      succeeded: false,
      branches: [{
        selectionId: 'fury.outcome',
        recipientId: 'target-token',
        branchId: 'fury.miss',
      }],
    })
    expect(queries.lastCompletedMove()).toMatchObject({
      resolutionId: 'resolution.fury.2',
    })
    expect(queries.previousCompletedMove()).toMatchObject({
      resolutionId: 'resolution.fury.1',
    })
    expect(queries.previousCompletedMove('actor-token')).toMatchObject({
      resolutionId: 'resolution.fury.1',
    })
    expect(queries.previousDeclaredMove('actor-token')).toMatchObject({
      resolutionId: 'resolution.fury.1',
    })
    expect(queries.completedMovesThisScene().map(entry => entry.resolutionId)).toEqual([
      'resolution.child.1',
      'resolution.fury.1',
      'resolution.fury.2',
    ])
    expect(queries.declaredMovesThisScene().map(entry => entry.resolutionId)).toEqual([
      'resolution.fury.1',
      'resolution.child.1',
      'resolution.fury.2',
    ])
    expect(queries.usedMoveThisScene('actor-token', 'Fury Cutter')).toBe(true)
    expect(queries.usedMoveThisScene('actor-token', 'Follow Up')).toBe(false)
    expect(queries.moveUse('resolution.child.1')).toMatchObject({
      specVersion: 3,
      actionType: 'free',
      origin: { kind: 'random', sourceResolutionId: 'resolution.fury.1' },
      moveListSource: { kind: 'reviewed-pool', poolId: 'pool.follow-up' },
      declaration: { order: 2 },
      completion: { order: 1, succeeded: false },
    })
    expect(queries.lastDamagingMoveReceived('target-token')).toMatchObject({
      resolutionId: 'resolution.fury.1',
      canonicalId: 'Fury Cutter',
      hitIndex: 2,
      hitPointLoss: 5,
      temporaryHitPointLoss: 0,
      damageClass: 'physical',
      moveType: 'bug',
    })
    expect(queries.damageBySourceThisTurn('actor-token', 'target-token')).toEqual([{
      resolutionId: 'resolution.fury.1',
      canonicalId: 'Fury Cutter',
      sourcePlacementId: 'actor-token',
      targetPlacementId: 'target-token',
      hitPointLoss: 12,
      temporaryHitPointLoss: 3,
    }])
    expect(queries.damageDealtThisTurn('actor-token')).toEqual({
      hitPointLoss: 12,
      temporaryHitPointLoss: 3,
      totalLoss: 15,
    })
    expect(queries.damageReceivedThisRound('target-token').totalLoss).toBe(15)
    expect(queries.actedThisTurn('actor-token')).toBe(true)
    expect(queries.actedThisTurn('target-token')).toBe(false)
    expect(queries.actedThisRound('helper-token')).toBe(true)
    expect(queries.consecutiveUseCount('actor-token')).toBe(2)
    expect(queries.consecutiveUseCount('actor-token', 'Fury Cutter')).toBe(2)
    expect(queries.consecutiveUseCount('actor-token', 'Scratch')).toBe(0)
    expect(queries.switchedThisScene('target-token')).toBe(true)
    expect(queries.switchedThisScene('replacement-token')).toBe(true)
    expect(queries.faintedThisScene('target-token')).toBe(true)
    expect(queries.parentResolutionId('resolution.child.1')).toBe('resolution.fury.1')
    expect(queries.childResolutionIds('resolution.fury.1')).toEqual(['resolution.child.1'])

    expect(queries.query('actor-token', 'last-declared-move-id')).toBe('Fury Cutter')
    expect(queries.query('actor-token', 'last-completed-move-id')).toBe('Fury Cutter')
    expect(queries.query('target-token', 'last-damaging-move-id')).toBe('Fury Cutter')
    expect(queries.query('actor-token', 'consecutive-use-count')).toBe(2)
    expect(queries.query('actor-token', 'damage-dealt-this-turn')).toBe(15)
    expect(queries.query('target-token', 'damage-received-this-turn')).toBe(15)
    expect(queries.query('helper-token', 'acted-this-turn')).toBe(true)
    expect(queries.query('target-token', 'switched-this-scene')).toBe(true)
    expect(queries.query('target-token', 'fainted-this-scene')).toBe(true)
    expect(queries.query('unknown-token', 'last-completed-move-id')).toBeNull()

    expect(history.switches).toHaveLength(1)
    expect(history.knockouts).toHaveLength(1)
    expect(Object.isFrozen(result.state)).toBe(true)
    expect(Object.isFrozen(history.moveAncestry)).toBe(true)
    expect(Object.isFrozen(history.moveUses)).toBe(true)
    expect(Object.isFrozen(queries.completedMovesThisScene())).toBe(true)
  })

  it('rejects conflicting move identity and completion without declaration', () => {
    const populated = reduceEncounterLifecycle(
      createEmptyEncounterState(),
      historyEvents(),
    ).state
    const changedIdentity = move('resolution.fury.2', 'Fury Cutter', 'actor-token', {
      specVersion: 3,
    })

    expect(() => reduceEncounterLifecycle(populated, [moveEvent(
      'move-hit',
      'event.fury.2.conflicting-hit',
      changedIdentity,
      { targetPlacementId: 'target-token', hitIndex: 1 },
    )])).toThrow('changed canonical identity, version, actor, action, origin, or move-list source')

    const undeclared = move('resolution.undeclared.1', 'Scratch', 'actor-token')
    expect(() => reduceEncounterLifecycle(createEmptyEncounterState(), [moveEvent(
      'move-completed',
      'event.undeclared.completed',
      undeclared,
      {
        attackedTargetIds: [],
        hitTargetIds: [],
        outcome: 'no-target',
        succeeded: true,
        branches: [],
      },
    )])).toThrow('completed before it was declared')
  })

  it('resets turn and round windows at authoritative boundaries and scene indexes after handlers', () => {
    const populated = reduceEncounterLifecycle(createEmptyEncounterState(), historyEvents()).state
    const nextTurn = parseEncounterEvent({
      ...envelope('turn-start', 'event.turn.next'),
      round: 2,
      turn: 5,
      placementId: 'target-token',
      sideId: 'villains',
    })
    const turnResult = reduceEncounterLifecycle(populated, [nextTurn])
    const turnQueries = createMoveAutomationHistoryResolver(turnResult.state.history)

    expect(turnResult.state.history.damageBySourceThisTurn).toEqual([])
    expect(turnResult.state.history.actedThisTurnPlacementIds).toEqual([])
    expect(turnQueries.damageDealtThisRound('actor-token').totalLoss).toBe(15)
    expect(turnQueries.actedThisRound('actor-token')).toBe(true)
    expect(turnQueries.switchedThisScene('target-token')).toBe(true)

    const roundResult = reduceEncounterLifecycle(turnResult.state, [parseEncounterEvent({
      ...envelope('round-start', 'event.round.next'),
      round: 3,
    })])
    const roundQueries = createMoveAutomationHistoryResolver(roundResult.state.history)
    expect(roundResult.state.history.currentRound).toBe(3)
    expect(roundResult.state.history.currentTurn).toBeNull()
    expect(roundQueries.damageDealtThisRound('actor-token').totalLoss).toBe(0)
    expect(roundQueries.actedThisRound('actor-token')).toBe(false)
    expect(roundQueries.lastCompletedMove('actor-token')?.canonicalId).toBe('Fury Cutter')
    expect(roundQueries.switchedThisScene('target-token')).toBe(true)

    let outgoingSwitchObserved = false
    const sceneEndObserver: EncounterLifecycleTriggerHandler = {
      id: 'handler.history.scene-end-observer',
      resolve: ({ event, state }) => {
        if (event.kind === 'scene-end') {
          outgoingSwitchObserved = createMoveAutomationHistoryResolver(state.history)
            .switchedThisScene('target-token')
        }
        return []
      },
    }
    const sceneEnd = parseEncounterEvent({
      ...envelope('scene-end', 'event.scene.end'),
      sceneId: 'scene.history.1',
    })
    const ended = reduceEncounterLifecycle(roundResult.state, [sceneEnd], [sceneEndObserver])

    expect(outgoingSwitchObserved).toBe(true)
    expect(ended.state.history).toEqual(createEmptyEncounterState().history)
  })
})
