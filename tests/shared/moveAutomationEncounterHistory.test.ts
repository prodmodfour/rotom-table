import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_HISTORY_LIMITS,
  EncounterHistoryValidationError,
  createEmptyEncounterHistory,
  parseEncounterHistory,
} from '#shared/moveAutomation/encounterHistory'

const moveIdentity = () => ({
  resolutionId: 'resolution.scratch.1',
  canonicalId: 'Scratch',
  specVersion: 2,
  actorPlacementId: 'actor-token',
  actionType: 'standard' as const,
  origin: { kind: 'direct' as const },
  moveListSource: { kind: 'placement' as const, placementId: 'actor-token' },
})

const declared = () => ({
  eventId: 'event.scratch.declared',
  sourceOperationId: 'op.scratch.1',
  ...moveIdentity(),
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
    succeeded: true,
    branches: [{
      selectionId: 'scratch.target-result',
      recipientId: 'target-token',
      branchId: 'scratch.hit',
    }],
  }].map(({ targetPlacementIds: _ignored, ...entry }) => entry),
  lastDamagingMovesReceived: [{
    ...declared(),
    eventId: 'event.scratch.damage',
    round: null,
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
    targetPlacementId: 'target-token',
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
    round: null,
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
  moveUses: [{
    ...moveIdentity(),
    declaration: {
      eventId: 'event.scratch.declared',
      sourceOperationId: 'op.scratch.1',
      order: 1,
      round: null,
      targetPlacementIds: ['target-token'],
    },
    completion: {
      eventId: 'event.scratch.completed',
      sourceOperationId: 'op.scratch.1',
      order: 1,
      round: null,
      attackedTargetIds: ['target-token'],
      hitTargetIds: ['target-token'],
      outcome: 'hit' as const,
      succeeded: true,
      branches: [{
        selectionId: 'scratch.target-result',
        recipientId: 'target-token',
        branchId: 'scratch.hit',
      }],
    },
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

  it('normalizes legacy MA-063 indexes without inventing provenance and remains idempotent', () => {
    const { moveUses: _moveUses, ...legacyEmpty } = createEmptyEncounterHistory()
    const legacy = {
      ...legacyEmpty,
      lastDeclaredMoves: [{
        eventId: 'event.legacy.declared',
        sourceOperationId: 'op.legacy.1',
        resolutionId: 'resolution.legacy.1',
        canonicalId: 'Scratch',
        actorPlacementId: 'actor-token',
        targetPlacementIds: ['target-token'],
      }],
      lastCompletedMoves: [{
        eventId: 'event.legacy.completed',
        sourceOperationId: 'op.legacy.1',
        resolutionId: 'resolution.legacy.1',
        canonicalId: 'Scratch',
        actorPlacementId: 'actor-token',
        attackedTargetIds: ['target-token'],
        hitTargetIds: [],
        outcome: 'miss',
      }],
    }

    const parsed = parseEncounterHistory(legacy)

    expect(parsed.moveUses).toEqual([])
    expect(parsed.lastDeclaredMoves[0]).toMatchObject({
      specVersion: null,
      actionType: null,
      origin: null,
      moveListSource: null,
    })
    expect(parsed.lastCompletedMoves[0]).toMatchObject({
      succeeded: null,
      branches: null,
    })
    expect(parseEncounterHistory(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
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
    expect(() => parseEncounterHistory({
      ...populatedHistory(),
      lastCompletedMoves: populatedHistory().lastCompletedMoves.map(entry => ({
        ...entry,
        specVersion: 3,
      })),
    })).toThrow('conflicts with a retained move index')
    expect(() => parseEncounterHistory({
      ...populatedHistory(),
      moveUses: populatedHistory().moveUses.map(entry => ({
        ...entry,
        origin: {
          kind: 'copied',
          sourceResolutionId: 'resolution.source.1',
        },
      })),
    })).toThrow('a copied move must name its source resolution')
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

    const use = populatedHistory().moveUses[0]!
    expect(() => parseEncounterHistory({
      ...populatedHistory(),
      moveAncestry: [],
      moveUses: Array.from(
        { length: ENCOUNTER_HISTORY_LIMITS.moveUsesPerScene + 1 },
        (_, index) => ({ ...use, resolutionId: `resolution.use.${index}` }),
      ),
      eventMoveLinks: [],
    })).toThrow(
      `moveUses: must contain at most ${ENCOUNTER_HISTORY_LIMITS.moveUsesPerScene} entries`,
    )
  })
})
