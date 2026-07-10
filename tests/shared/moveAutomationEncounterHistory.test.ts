import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_HISTORY_LIMITS,
  EncounterHistoryValidationError,
  createEmptyEncounterHistory,
  parseEncounterHistory,
} from '#shared/moveAutomation/encounterHistory'

const declared = () => ({
  eventId: 'event.scratch.declared',
  sourceOperationId: 'op.scratch.1',
  resolutionId: 'resolution.scratch.1',
  canonicalId: 'Scratch',
  actorPlacementId: 'actor-token',
  targetPlacementIds: ['target-token'],
})

const populatedHistory = () => ({
  ...createEmptyEncounterHistory(),
  sceneId: 'scene.test.1',
  currentRound: 2,
  currentTurn: { round: 2, turn: 4, placementId: 'actor-token' },
  lastDeclaredMoves: [declared()],
  lastCompletedMoves: [{
    ...declared(),
    eventId: 'event.scratch.completed',
    attackedTargetIds: ['target-token'],
    hitTargetIds: ['target-token'],
    outcome: 'hit' as const,
  }].map(({ targetPlacementIds: _ignored, ...entry }) => entry),
  lastDamagingMovesReceived: [{
    ...declared(),
    eventId: 'event.scratch.damage',
    targetPlacementId: 'target-token',
    hitIndex: 1,
    hitPointLoss: 8,
    temporaryHitPointLoss: 2,
    damageClass: 'physical' as const,
    moveType: 'normal',
  }].map(({ targetPlacementIds: _ignored, ...entry }) => entry),
  damageBySourceThisTurn: [{
    resolutionId: 'resolution.scratch.1',
    canonicalId: 'Scratch',
    sourcePlacementId: 'actor-token',
    targetPlacementId: 'target-token',
    hitPointLoss: 8,
    temporaryHitPointLoss: 2,
  }],
  damageBySourceThisRound: [{
    resolutionId: 'resolution.scratch.1',
    canonicalId: 'Scratch',
    sourcePlacementId: 'actor-token',
    targetPlacementId: 'target-token',
    hitPointLoss: 8,
    temporaryHitPointLoss: 2,
  }],
  actedThisTurnPlacementIds: ['actor-token'],
  actedThisRoundPlacementIds: ['actor-token'],
  consecutiveMoves: [{
    placementId: 'actor-token',
    canonicalId: 'Scratch',
    count: 1,
    lastResolutionId: 'resolution.scratch.1',
  }],
  switchedPlacementIds: ['target-token', 'replacement-token'],
  faintedPlacementIds: ['target-token'],
  switches: [{
    eventId: 'event.target.switch',
    sourceOperationId: 'op.scratch.1',
    kind: 'switch' as const,
    recalledPlacementId: 'target-token',
    sentOutPlacementId: 'replacement-token',
  }],
  knockouts: [{
    ...declared(),
    eventId: 'event.scratch.ko',
    targetPlacementId: 'target-token',
    hitIndex: 1,
  }].map(({ targetPlacementIds: _ignored, ...entry }) => entry),
  moveAncestry: [{
    resolutionId: 'resolution.scratch.1',
    parentResolutionId: null,
    childResolutionIds: ['resolution.child.1'],
  }, {
    resolutionId: 'resolution.child.1',
    parentResolutionId: 'resolution.scratch.1',
    childResolutionIds: [],
  }],
  eventMoveLinks: [{
    eventId: 'event.scratch.declared',
    resolutionId: 'resolution.scratch.1',
  }],
})

describe('encounter history contract', () => {
  it('canonicalizes the reserved empty object and returns fresh typed indexes', () => {
    const legacy = {}
    const parsed = parseEncounterHistory(legacy)

    expect(parsed).toEqual(createEmptyEncounterHistory())
    expect(parsed).not.toBe(legacy)
    expect(parsed.lastDeclaredMoves).not.toBe(createEmptyEncounterHistory().lastDeclaredMoves)
  })

  it('strictly round-trips bounded structured indexes without retaining input containers', () => {
    const source = populatedHistory()
    const parsed = parseEncounterHistory(JSON.parse(JSON.stringify(source)))

    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)
    expect(parsed.currentTurn).not.toBe(source.currentTurn)
    expect(parsed.lastDeclaredMoves).not.toBe(source.lastDeclaredMoves)
    expect(parsed.lastDeclaredMoves[0]).not.toBe(source.lastDeclaredMoves[0])
    expect(parsed.moveAncestry[0]?.childResolutionIds)
      .not.toBe(source.moveAncestry[0]?.childResolutionIds)
  })

  it('rejects partial records, inconsistent windows, duplicates, and broken ancestry', () => {
    expect(() => parseEncounterHistory({ currentRound: 2 }))
      .toThrow('must contain exactly the supported fields')
    expect(() => parseEncounterHistory({
      ...populatedHistory(),
      currentTurn: { round: 3, turn: 4, placementId: 'actor-token' },
    })).toThrow('currentTurn.round: must match currentRound')
    expect(() => parseEncounterHistory({
      ...populatedHistory(),
      actedThisTurnPlacementIds: ['actor-token', 'actor-token'],
    })).toThrowError(expect.objectContaining({
      name: EncounterHistoryValidationError.name,
      code: 'duplicate-id',
    }))
    expect(() => parseEncounterHistory({
      ...populatedHistory(),
      moveAncestry: [{
        resolutionId: 'resolution.child.1',
        parentResolutionId: 'resolution.scratch.1',
        childResolutionIds: [],
      }, {
        resolutionId: 'resolution.scratch.1',
        parentResolutionId: null,
        childResolutionIds: [],
      }],
    })).toThrow('parent resolution.scratch.1 does not list child resolution.child.1')
    expect(() => parseEncounterHistory({
      ...populatedHistory(),
      eventMoveLinks: [{
        eventId: 'event.unknown',
        resolutionId: 'resolution.unknown',
      }],
    })).toThrow('references unknown resolution resolution.unknown')
  })

  it('enforces per-window and per-scene payload ceilings', () => {
    const damage = populatedHistory().damageBySourceThisTurn[0]!
    expect(() => parseEncounterHistory({
      ...populatedHistory(),
      damageBySourceThisTurn: Array.from(
        { length: ENCOUNTER_HISTORY_LIMITS.damageSourcesPerWindow + 1 },
        (_, index) => ({
          ...damage,
          resolutionId: `resolution.damage.${index}`,
        }),
      ),
    })).toThrow(
      `damageBySourceThisTurn: must contain at most ${ENCOUNTER_HISTORY_LIMITS.damageSourcesPerWindow} entries`,
    )

    expect(() => parseEncounterHistory({
      ...populatedHistory(),
      moveAncestry: [{
        resolutionId: 'resolution.loop',
        parentResolutionId: 'resolution.loop',
        childResolutionIds: [],
      }],
      eventMoveLinks: [],
    })).toThrow('cannot be its own parent or child')
  })
})
