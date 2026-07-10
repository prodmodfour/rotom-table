import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT,
  parseLivePlayMoveStatePatchPayload,
  isLivePlayMoveStatePatchPayload,
} from '#shared/livePlayMoveState'
import {
  createEmptyEncounterState,
  createEncounterTurnResourceLedger,
} from '#shared/moveAutomation/encounterState'

const move = () => ({
  schemaVersion: 1,
  actorPlacementId: 'token-a',
  moveName: 'Tackle',
  canonicalMoveName: 'Tackle',
  moveKey: 'tackle',
  frequency: null,
  damageFormula: null,
  selectedTargetIds: ['token-b'],
  rollLedger: [],
  script: { type: 'Normal' },
  transaction: {
    userId: 'token-a',
    userName: 'Pika',
    moveName: 'Tackle',
    scriptKind: 'explicit',
    scriptVersion: 1,
    attackedTargetIds: ['token-b'],
    hitTargetIds: ['token-b'],
    hpUpdates: [],
    conditionUpdates: [],
    combatStageUpdates: [],
    hazardsToAdd: [],
    fieldEffectsToApply: [],
    logLines: ['Pika used Tackle.'],
  },
})

const payload = () => ({
  command: 'resolveMove',
  updatedAt: 1000,
  move: move(),
  presentation: {
    schemaVersion: 1,
    operationId: 'op_movestate01',
    actorPlacementId: 'token-a',
    move: { name: 'Tackle', type: 'Normal' },
    attackedTargetIds: ['token-b'],
    hitTargetIds: ['token-b'],
    outcomeKind: 'hit',
  },
  sheets: [{
    kind: 'pokemon',
    slug: 'pikachu',
    expectedRevision: 2,
    revision: 3,
    placementIds: ['token-a'],
    changedFields: ['hp', 'conditions'],
  }],
  changes: {
    placements: {
      previous: [{ id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 0, y: 0, z: 0 }, sideId: 'heroes' }],
      current: [{ id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 1, y: 0, z: 0 }, sideId: 'heroes', facing: 'north-east', turned: false }],
    },
    temporaryHitPoints: {
      previous: null,
      current: { scene: { name: 'Scene', startedAt: 1 }, byPlacementId: { 'token-a': 5 } },
    },
    moveUsage: {
      previous: null,
      current: { scene: { name: 'Scene', startedAt: 1 }, byPlacementId: { 'token-a': { tackle: { moveName: 'Tackle', frequency: 'scene', uses: 1, lastUsedRound: null, updatedAt: 1000 } } } },
    },
    hazards: { previous: [], current: [{ kind: 'fire', x: 1, y: 0, z: 1, layer: 1, owner: 'actor' }] },
    fieldEffects: { previous: { weather: [], terrains: [], rooms: [] }, current: { weather: [{ kind: 'sunny', rounds: 2, source: 'Tackle' }], terrains: [], rooms: [] } },
    metadata: { previous: null, current: { moveLog: [{ at: 1000 }] } },
    encounterState: {
      previous: createEmptyEncounterState(),
      current: {
        ...createEmptyEncounterState(),
        turnResources: {
          'token-a': createEncounterTurnResourceLedger({
            placementId: 'token-a',
            round: 1,
            turn: 0,
            movementBudget: 6,
          }),
        },
      },
    },
  },
})

describe('livePlayMoveState patch contract', () => {
  it('exports the canonical resolveMove scope limit', () => {
    expect(LIVE_PLAY_RESOLVE_MOVE_SCOPE_LIMIT).toBe(128)
  })

  it('parses, validates, and detaches complete MOVE_STATE payloads', () => {
    const raw = payload()
    const result = parseLivePlayMoveStatePatchPayload(raw)
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected valid payload')
    expect(result.payload).toEqual(raw)
    expect(result.payload).not.toBe(raw)
    expect(result.payload.move).not.toBe(raw.move)
    expect(result.payload.presentation).not.toBe(raw.presentation)
    expect(result.payload.changes.placements?.current).not.toBe(raw.changes.placements.current)
    expect(result.payload.changes.encounterState?.current)
      .not.toBe(raw.changes.encounterState.current)
    expect(isLivePlayMoveStatePatchPayload(raw)).toBe(true)
  })

  it('requires exact command, safe timestamps, valid move data, unique sheet refs, and valid lanes', () => {
    expect(parseLivePlayMoveStatePatchPayload({ ...payload(), command: 'useMove' }).valid).toBe(false)
    expect(parseLivePlayMoveStatePatchPayload({ ...payload(), updatedAt: -1 }).valid).toBe(false)
    expect(parseLivePlayMoveStatePatchPayload({ ...payload(), move: { actorPlacementId: 'token-a' } }).valid).toBe(false)
    expect(parseLivePlayMoveStatePatchPayload({
      ...payload(),
      presentation: { ...payload().presentation, hitTargetIds: [], outcomeKind: 'miss' },
    }).valid).toBe(false)
    expect(parseLivePlayMoveStatePatchPayload({
      ...payload(),
      sheets: [payload().sheets[0], payload().sheets[0]],
    }).valid).toBe(false)
    expect(parseLivePlayMoveStatePatchPayload({
      ...payload(),
      changes: { placements: { previous: [], current: [{ id: '', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 0, y: 0, z: 0 } }] } },
    }).valid).toBe(false)
    expect(parseLivePlayMoveStatePatchPayload({
      ...payload(),
      changes: {
        placements: {
          previous: [],
          current: [{ id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 0, y: 0, z: 0 }, sideId: 'Team Heroes' }],
        },
      },
    }).valid).toBe(false)
    expect(parseLivePlayMoveStatePatchPayload({
      ...payload(),
      changes: { fieldEffects: { previous: {}, current: { weather: [{ kind: 'fog' }] } } },
    }).valid).toBe(false)
    expect(parseLivePlayMoveStatePatchPayload({
      ...payload(),
      changes: {
        encounterState: {
          previous: createEmptyEncounterState(),
          current: { ...createEmptyEncounterState(), turnResources: { actor: {} } },
        },
      },
    }).valid).toBe(false)
  })

  it('uses null to represent optional map-state deletions', () => {
    const result = parseLivePlayMoveStatePatchPayload({
      ...payload(),
      changes: {
        temporaryHitPoints: { previous: payload().changes.temporaryHitPoints.current, current: null },
        moveUsage: { previous: payload().changes.moveUsage.current, current: null },
        metadata: { previous: { moveLog: [] }, current: null },
      },
    })
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected valid deletion payload')
    expect(result.payload.changes.temporaryHitPoints?.current).toBeNull()
    expect(result.payload.changes.moveUsage?.current).toBeNull()
    expect(result.payload.changes.metadata?.current).toBeNull()
  })
})
