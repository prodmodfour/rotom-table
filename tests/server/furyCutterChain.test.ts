import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_EVENT_SCHEMA_VERSION,
  parseEncounterEvent,
} from '#shared/moveAutomation/events'
import {
  createEmptyEncounterHistory,
  parseEncounterHistory,
  type EncounterHistory,
} from '#shared/moveAutomation/encounterHistory'
import {
  FURY_CUTTER_MAX_CHAIN_COUNT,
  reduceFuryCutterChainCompletion,
  resetFuryCutterChainForDifferentMove,
} from '~~/server/domain/moveAutomation/furyCutter'
import { createMoveAutomationHistoryResolver } from '~~/server/domain/moveAutomation/history'
import { reduceEncounterHistoryEvent } from '~~/server/domain/moveAutomation/reduceEncounterHistory'

const ACTOR_ID = 'actor-token'
const TARGET_ID = 'target-token'
const OTHER_TARGET_ID = 'other-target-token'

const resolve = (
  history: EncounterHistory,
  options: {
    readonly resolutionId: string
    readonly targetPlacementId?: string
    readonly hit?: boolean
    readonly damaged?: boolean
  },
) => reduceFuryCutterChainCompletion({
  history,
  actorPlacementId: ACTOR_ID,
  attackedTargetIds: [options.targetPlacementId ?? TARGET_ID],
  hitTargetIds: options.hit === false ? [] : [options.targetPlacementId ?? TARGET_ID],
  damagedTargetIds: options.damaged === false ? [] : [options.targetPlacementId ?? TARGET_ID],
  resolutionId: options.resolutionId,
})

const advance = (
  history: EncounterHistory,
  resolutionId: string,
  targetPlacementId = TARGET_ID,
): EncounterHistory => resolve(history, { resolutionId, targetPlacementId }).history

const chainHistory = (count = 2): EncounterHistory => {
  let history = createEmptyEncounterHistory()
  for (let index = 1; index <= count; index += 1) {
    history = advance(history, `resolution.fury.${index}`)
  }
  return history
}

const eventEnvelope = (kind: 'switch' | 'scene-end', eventId: string) => ({
  schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
  eventId,
  kind,
  sourceOperationId: 'op.fury.lifecycle',
  causalParentEventId: null,
  reasonCode: `fury-cutter.${kind}`,
})

describe('Fury Cutter authoritative chain state', () => {
  it('advances only successful same-target damage and caps retained count at DB 16', () => {
    const source = createEmptyEncounterHistory()
    const snapshot = structuredClone(source)
    const first = resolve(source, { resolutionId: 'resolution.fury.1' })

    expect(first).toMatchObject({
      changed: true,
      outcome: 'advanced',
      previousCount: 0,
      currentCount: 1,
      targetPlacementId: TARGET_ID,
    })
    expect(source).toEqual(snapshot)
    expect(first.history.consecutiveMoves).toEqual([{
      placementId: ACTOR_ID,
      canonicalId: 'Fury Cutter',
      targetPlacementId: TARGET_ID,
      count: 1,
      lastResolutionId: 'resolution.fury.1',
    }])

    let history = first.history
    for (let index = 2; index <= 6; index += 1) {
      history = advance(history, `resolution.fury.${index}`)
    }
    expect(history.consecutiveMoves[0]).toMatchObject({
      count: FURY_CUTTER_MAX_CHAIN_COUNT,
      lastResolutionId: 'resolution.fury.6',
    })
    const queries = createMoveAutomationHistoryResolver(history)
    expect(queries.consecutiveUseCount(ACTOR_ID, 'Fury Cutter', TARGET_ID)).toBe(4)
    expect(queries.consecutiveUseCount(ACTOR_ID, 'Fury Cutter', OTHER_TARGET_ID)).toBe(0)
  })

  it('restarts on a target change and resets on a miss or zero effective damage', () => {
    const chained = chainHistory(3)
    const changedTarget = resolve(chained, {
      resolutionId: 'resolution.fury.changed-target',
      targetPlacementId: OTHER_TARGET_ID,
    })
    expect(changedTarget).toMatchObject({
      outcome: 'restarted-target-change',
      previousTargetPlacementId: TARGET_ID,
      targetPlacementId: OTHER_TARGET_ID,
      previousCount: 3,
      currentCount: 1,
    })

    const missed = resolve(changedTarget.history, {
      resolutionId: 'resolution.fury.miss',
      targetPlacementId: OTHER_TARGET_ID,
      hit: false,
    })
    expect(missed).toMatchObject({ outcome: 'reset-miss', currentCount: 0 })
    expect(missed.history.consecutiveMoves).toEqual([])

    const noDamage = resolve(chainHistory(), {
      resolutionId: 'resolution.fury.no-damage',
      damaged: false,
    })
    expect(noDamage).toMatchObject({ outcome: 'reset-no-damage', currentCount: 0 })
    expect(noDamage.history.consecutiveMoves).toEqual([])
  })

  it('does not increment twice for one resolution and a different move clears the actor chain', () => {
    const chained = chainHistory()
    const duplicate = resolve(chained, {
      resolutionId: 'resolution.fury.2',
    })
    expect(duplicate).toMatchObject({
      changed: false,
      outcome: 'duplicate',
      previousCount: 2,
      currentCount: 2,
    })
    expect(duplicate.history).toEqual(chained)

    const reset = resetFuryCutterChainForDifferentMove({
      history: chained,
      actorPlacementId: ACTOR_ID,
      canonicalMoveId: 'Scratch',
    })
    expect(reset.changed).toBe(true)
    expect(reset.history.consecutiveMoves).toEqual([])
    expect(chained.consecutiveMoves).toHaveLength(1)
  })

  it('queries target-bound counts and safely normalizes legacy targetless rows', () => {
    const current = chainHistory(2)
    const queries = createMoveAutomationHistoryResolver(current)
    expect(queries.consecutiveUseCount(ACTOR_ID, 'Fury Cutter', TARGET_ID)).toBe(2)
    expect(queries.consecutiveUseCount(ACTOR_ID, 'Fury Cutter', OTHER_TARGET_ID)).toBe(0)

    const legacy = parseEncounterHistory({
      ...createEmptyEncounterHistory(),
      consecutiveMoves: [{
        placementId: ACTOR_ID,
        canonicalId: 'Fury Cutter',
        count: 3,
        lastResolutionId: 'resolution.legacy.fury',
      }],
    })
    expect(legacy.consecutiveMoves[0]?.targetPlacementId).toBeNull()
    expect(createMoveAutomationHistoryResolver(legacy)
      .consecutiveUseCount(ACTOR_ID, 'Fury Cutter', TARGET_ID)).toBe(0)
  })

  it('clears the chain when its actor or target switches and at scene end', () => {
    const actorSwitched = reduceEncounterHistoryEvent(chainHistory(), parseEncounterEvent({
      ...eventEnvelope('switch', 'event.fury.actor-switch'),
      recalledPlacementId: ACTOR_ID,
      sentOutPlacementId: 'replacement-token',
    }))
    expect(actorSwitched.consecutiveMoves).toEqual([])

    const targetSwitched = reduceEncounterHistoryEvent(chainHistory(), parseEncounterEvent({
      ...eventEnvelope('switch', 'event.fury.target-switch'),
      recalledPlacementId: TARGET_ID,
      sentOutPlacementId: 'replacement-target-token',
    }))
    expect(targetSwitched.consecutiveMoves).toEqual([])

    const ended = reduceEncounterHistoryEvent(chainHistory(), parseEncounterEvent({
      ...eventEnvelope('scene-end', 'event.fury.scene-end'),
      sceneId: 'scene.fury',
    }))
    expect(ended).toEqual(createEmptyEncounterHistory())
  })
})
