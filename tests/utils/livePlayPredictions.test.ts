import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayScope,
} from '#shared/livePlayCommands'
import {
  applyLivePlayPredictionToMap,
  buildLivePlayPrediction,
  buildModifyConditionsPrediction,
  buildModifyHpPrediction,
  buildMoveTokenPrediction,
  buildTurnTokenPrediction,
  livePlayConditionsForPrediction,
  rollbackLivePlayPredictionFromMap,
} from '~/utils/livePlayPredictions'
import type { GridAnchor, MapSceneState, TabletopMap } from '~/types/map'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import { temporaryHpForPlacement } from '~/utils/mapTemporaryHitPoints'

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 7,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 8, y: 2, z: 8 },
  groundLevelY: 0,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'token-a',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-west',
      turned: false,
      initiative: 12,
    },
    {
      id: 'token-b',
      sheetKind: 'trainer',
      sheetSlug: 'misty',
      position: { x: 2, y: 0, z: 3 },
      initiative: 8,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: {
    movementLog: [{ userId: 'previous', to: { x: 0, y: 0, z: 0 } }],
  },
  updatedAt: 100,
  ...overrides,
})

const tokenScope = (placementId: string, field: 'position' | 'facing' | 'hp' | 'conditions'): LivePlayScope => ({
  kind: 'token',
  placementId,
  field,
})

const commandBase = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_prediction001',
  mapSlug: 'arena-map',
  baseRevision: 7,
  clientId: 'test-client',
  ...overrides,
})

const moveCommand = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => commandBase({
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [tokenScope('token-a', 'position')],
  payload: {
    placementId: 'token-a',
    position: { x: 4, y: 0, z: 0 },
  },
  ...overrides,
})

const turnCommand = (facing: TokenFacingDirection = 'north-west', overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => commandBase({
  type: LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
  scopes: [tokenScope('token-a', 'facing')],
  payload: {
    placementId: 'token-a',
    facing,
  },
  ...overrides,
})

const hpCommand = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => commandBase({
  type: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
  scopes: [
    tokenScope('token-a', 'hp'),
    { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'hp' },
  ],
  payload: {
    placementId: 'token-a',
    currentHp: 12,
    temporaryHp: 6,
  },
  ...overrides,
})

const conditionsCommand = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => commandBase({
  type: LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
  scopes: [
    tokenScope('token-a', 'conditions'),
    { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'conditions' },
  ],
  payload: {
    placementId: 'token-a',
    action: 'replace',
    conditions: ['Burned'],
  },
  ...overrides,
})

const mapScene: MapSceneState = { name: 'Test scene', startedAt: 10 }

const mapWithTemporaryHp = (temporaryHp = 2): TabletopMap => baseMap({
  activeScene: mapScene,
  temporaryHitPoints: {
    scene: mapScene,
    byPlacementId: { 'token-a': temporaryHp },
  },
})

const tokenPosition = (map: TabletopMap, placementId = 'token-a'): GridAnchor | null => (
  map.placements.find((placement) => placement.id === placementId)?.position ?? null
)

describe('live-play local prediction builders', () => {
  it('builds a local-only moveToken prediction that can be applied and rolled back without side effects', () => {
    const map = baseMap()
    const command = moveCommand()
    const originalCommand = JSON.stringify(command)
    const originalMetadata = JSON.stringify(map.metadata)

    const prediction = buildMoveTokenPrediction({ map, command })

    expect(prediction).toMatchObject({
      kind: 'live-play-local-prediction',
      localOnly: true,
      opId: 'op_prediction001',
      commandType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      mapSlug: 'arena-map',
      baseRevision: 7,
      placementId: 'token-a',
      changedFields: ['position', 'facing'],
      patches: [{
        localOnly: true,
        predictionOpId: 'op_prediction001',
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
        revision: 7,
        payload: {
          placementId: 'token-a',
          position: { x: 4, y: 0, z: 0 },
          facing: 'north-east',
          turned: false,
        },
      }],
    })
    expect(prediction?.patches[0]?.payload).not.toHaveProperty('movementLogEntry')
    expect(JSON.stringify(command)).toBe(originalCommand)

    expect(applyLivePlayPredictionToMap(map, prediction!)).toEqual({ ok: true, applied: true })
    expect(map.revision).toBe(7)
    expect(tokenPosition(map)).toEqual({ x: 4, y: 0, z: 0 })
    expect(map.placements[0]).toMatchObject({ facing: 'north-east', turned: false, initiative: 12 })
    expect(JSON.stringify(map.metadata)).toBe(originalMetadata)

    map.placements[0]!.initiative = 99
    expect(rollbackLivePlayPredictionFromMap(map, prediction!)).toEqual({ ok: true, applied: true })
    expect(map.revision).toBe(7)
    expect(tokenPosition(map)).toEqual({ x: 1, y: 0, z: 1 })
    expect(map.placements[0]).toMatchObject({ facing: 'south-west', turned: false, initiative: 99 })
    expect(JSON.stringify(map.metadata)).toBe(originalMetadata)
  })

  it('builds a local-only turnToken prediction that can restore the previous facing', () => {
    const map = baseMap()
    const prediction = buildTurnTokenPrediction({ map, command: turnCommand() })

    expect(prediction).toMatchObject({
      localOnly: true,
      commandType: LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
      changedFields: ['facing', 'turned'],
      patches: [{
        localOnly: true,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_FACING,
        payload: {
          placementId: 'token-a',
          facing: 'north-west',
          turned: true,
        },
      }],
      rollbackPatches: [{
        localOnly: true,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_FACING,
        payload: {
          placementId: 'token-a',
          facing: 'south-west',
          turned: false,
        },
      }],
    })

    expect(applyLivePlayPredictionToMap(map, prediction!)).toEqual({ ok: true, applied: true })
    expect(map.placements[0]).toMatchObject({ facing: 'north-west', turned: true })

    expect(rollbackLivePlayPredictionFromMap(map, prediction!)).toEqual({ ok: true, applied: true })
    expect(map.placements[0]).toMatchObject({ facing: 'south-west', turned: false })
  })

  it('builds a local-only modifyHp prediction for temporary HP map HUD metadata', () => {
    const map = mapWithTemporaryHp(2)
    const prediction = buildModifyHpPrediction({ map, command: hpCommand() })

    expect(prediction).toMatchObject({
      localOnly: true,
      commandType: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
      changedFields: ['temporaryHp'],
      previousTemporaryHp: 2,
      predictedTemporaryHp: 6,
      previousPlacement: expect.objectContaining({ sheetSlug: 'pikachu' }),
      predictedPlacement: expect.objectContaining({ sheetSlug: 'pikachu' }),
      patches: [{
        localOnly: true,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
        payload: {
          placementId: 'token-a',
          sheetKind: 'pokemon',
          sheetSlug: 'pikachu',
          previous: {},
          current: {},
          previousTemporaryHp: 2,
          currentTemporaryHp: 6,
        },
      }],
      rollbackPatches: [{
        localOnly: true,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
        payload: {
          placementId: 'token-a',
          previousTemporaryHp: 6,
          currentTemporaryHp: 2,
        },
      }],
    })

    expect(applyLivePlayPredictionToMap(map, prediction!)).toEqual({ ok: true, applied: true })
    expect(map.revision).toBe(7)
    expect(temporaryHpForPlacement(map, 'token-a')).toBe(6)
    expect(map.placements[0]).toMatchObject({ sheetSlug: 'pikachu', initiative: 12 })

    expect(rollbackLivePlayPredictionFromMap(map, prediction!)).toEqual({ ok: true, applied: true })
    expect(map.revision).toBe(7)
    expect(temporaryHpForPlacement(map, 'token-a')).toBe(2)
  })

  it('builds local-only modifyConditions metadata without mutating map or sheet state', () => {
    const map = baseMap()
    const originalMap = JSON.stringify(map)
    const prediction = buildModifyConditionsPrediction({
      map,
      command: conditionsCommand({
        payload: { placementId: 'token-a', action: 'replace', conditions: [' poisoned ', 'Burned'] },
      }),
    })

    expect(prediction).toMatchObject({
      localOnly: true,
      commandType: LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
      changedFields: ['conditions'],
      pendingConditionChange: {
        action: 'replace',
        conditions: ['Burned', 'Poisoned'],
      },
      previousPlacement: expect.objectContaining({ sheetSlug: 'pikachu' }),
      predictedPlacement: expect.objectContaining({ sheetSlug: 'pikachu' }),
      patches: [{
        localOnly: true,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_CONDITIONS,
        payload: {
          placementId: 'token-a',
          sheetKind: 'pokemon',
          sheetSlug: 'pikachu',
          action: 'replace',
          conditions: ['Burned', 'Poisoned'],
        },
      }],
      rollbackPatches: [],
    })

    expect(applyLivePlayPredictionToMap(map, prediction!)).toEqual({ ok: true, applied: true })
    expect(JSON.stringify(map)).toBe(originalMap)
    expect(livePlayConditionsForPrediction(['Sleep'], prediction!)).toEqual(['Burned', 'Poisoned'])

    expect(rollbackLivePlayPredictionFromMap(map, prediction!)).toEqual({ ok: true, applied: true })
    expect(JSON.stringify(map)).toBe(originalMap)
  })

  it('applies pending condition add and remove metadata to display conditions only', () => {
    const map = baseMap()
    const addPrediction = buildModifyConditionsPrediction({
      map,
      command: conditionsCommand({
        payload: { placementId: 'token-a', action: 'add', conditions: ['Poisoned'] },
      }),
    })
    const removePrediction = buildModifyConditionsPrediction({
      map,
      command: conditionsCommand({
        payload: { placementId: 'token-a', action: 'remove', conditions: ['Burned'] },
      }),
    })

    expect(livePlayConditionsForPrediction(['Burned'], addPrediction!)).toEqual(['Burned', 'Poisoned'])
    expect(livePlayConditionsForPrediction(['Burned', 'Poisoned'], removePrediction!)).toEqual(['Poisoned'])
  })

  it('returns no modifyHp prediction for sheet-only HP changes', () => {
    const prediction = buildLivePlayPrediction({
      map: mapWithTemporaryHp(2),
      command: hpCommand({
        payload: { placementId: 'token-a', currentHp: 12, injuries: 1 },
      }),
    })

    expect(prediction).toBeNull()
  })

  it('returns no modifyHp prediction when temporary HP cannot be represented on the map', () => {
    const prediction = buildLivePlayPrediction({
      map: baseMap(),
      command: hpCommand(),
    })

    expect(prediction).toBeNull()
  })

  it('returns no prediction for unsupported command types', () => {
    const prediction = buildLivePlayPrediction({
      map: baseMap(),
      command: commandBase({
        type: LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES,
        scopes: [{ kind: 'token', placementId: 'token-a', field: 'combatStages' }],
        payload: {
          placementId: 'token-a',
          stages: { atk: 1, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
        },
      }),
    })

    expect(prediction).toBeNull()
  })

  it('returns no prediction when the target placement is missing', () => {
    expect(buildLivePlayPrediction({
      map: baseMap(),
      command: moveCommand({
        scopes: [tokenScope('missing-token', 'position')],
        payload: { placementId: 'missing-token', position: { x: 4, y: 0, z: 0 } },
      }),
    })).toBeNull()
  })

  it('returns no prediction when the loaded map is stale for the command base revision', () => {
    expect(buildLivePlayPrediction({
      map: baseMap({ revision: 6 }),
      command: moveCommand(),
    })).toBeNull()
  })
})
