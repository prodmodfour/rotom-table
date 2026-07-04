import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayMapScope,
  type LivePlayPatch,
  type LivePlayScope,
  type LivePlayTokenScope,
} from '#shared/livePlayCommands'
import {
  findLivePlayPredictionConflicts,
  livePlayPatchConflictDescriptors,
  type LivePlayPredictionConflictPrediction,
} from '~/utils/livePlayPredictionConflicts'

const tokenScope = (placementId: string, field: LivePlayTokenScope['field']): LivePlayTokenScope => ({
  kind: 'token',
  placementId,
  field,
})

const mapScope = (lane: LivePlayMapScope['lane']): LivePlayMapScope => ({
  kind: 'map',
  lane,
})

const prediction = (
  placementId: string,
  field: 'position' | 'facing',
  opId = `op_${placementId}_${field}`,
): LivePlayPredictionConflictPrediction => ({
  opId,
  placementId,
  commandType: field === 'position'
    ? LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN
    : LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
  scopes: [tokenScope(placementId, field)],
})

const patchBase = (overrides: Partial<LivePlayPatch> = {}): LivePlayPatch => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
  mapSlug: 'arena-map',
  revision: 8,
  scopes: [tokenScope('token-a', 'position')],
  payload: {
    placementId: 'token-a',
    position: { x: 2, y: 0, z: 3 },
  },
  ...overrides,
})

const tokenPatch = (
  type: typeof LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION | typeof LIVE_PLAY_PATCH_TYPES.TOKEN_FACING,
  placementId: string,
  field: 'position' | 'facing',
): LivePlayPatch => patchBase({
  type,
  scopes: [tokenScope(placementId, field)],
  payload: type === LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION
    ? { placementId, position: { x: 2, y: 0, z: 3 } }
    : { placementId, facing: 'north-east', turned: false },
})

describe('live-play prediction conflict detection', () => {
  it('converts accepted token patches into scope conflict descriptors', () => {
    expect(livePlayPatchConflictDescriptors(tokenPatch(
      LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
      'token-a',
      'position',
    ))).toEqual([
      {
        kind: 'token-field',
        placementId: 'token-a',
        field: 'position',
        label: 'token token-a position',
      },
    ])
  })

  it('derives terrain-cell descriptors from accepted terrain patches', () => {
    expect(livePlayPatchConflictDescriptors(patchBase({
      type: LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN,
      scopes: [mapScope('terrain')],
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
        cell: { x: 4, y: 0, z: 5 },
        previous: null,
        current: { x: 4, y: 0, z: 5, materialId: 'stone' },
      },
    }))).toEqual([
      { kind: 'terrain-cell', x: 4, y: 0, z: 5, label: 'terrain cell 4,0,5' },
    ])
  })

  it('does not conflict remote token-B movement with a local token-A movement prediction', () => {
    const summary = findLivePlayPredictionConflicts({
      pendingPredictions: [prediction('token-a', 'position', 'op_localmovea')],
      patches: [tokenPatch(LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION, 'token-b', 'position')],
    })

    expect(summary).toEqual({ hasConflicts: false, conflicts: [] })
  })

  it('conflicts remote token-A movement with a local token-A movement prediction', () => {
    const summary = findLivePlayPredictionConflicts({
      pendingPredictions: [prediction('token-a', 'position', 'op_localmovea')],
      patches: [tokenPatch(LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION, 'token-a', 'position')],
    })

    expect(summary).toMatchObject({
      hasConflicts: true,
      conflicts: [{
        opId: 'op_localmovea',
        placementId: 'token-a',
        commandType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
        patchType: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
        patchIndex: 0,
        conflict: {
          left: { kind: 'token-field', placementId: 'token-a', field: 'position' },
          right: { kind: 'token-field', placementId: 'token-a', field: 'position' },
        },
      }],
    })
  })

  it('conflicts same-token facing patches only with local facing predictions', () => {
    const summary = findLivePlayPredictionConflicts({
      pendingPredictions: {
        move: prediction('token-a', 'position', 'op_localmovea'),
        turn: prediction('token-a', 'facing', 'op_localturna'),
      },
      patches: [tokenPatch(LIVE_PLAY_PATCH_TYPES.TOKEN_FACING, 'token-a', 'facing')],
    })

    expect(summary.conflicts).toHaveLength(1)
    expect(summary.conflicts[0]).toMatchObject({
      opId: 'op_localturna',
      placementId: 'token-a',
      commandType: LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
      patchType: LIVE_PLAY_PATCH_TYPES.TOKEN_FACING,
      conflict: {
        left: { kind: 'token-field', placementId: 'token-a', field: 'facing' },
        right: { kind: 'token-field', placementId: 'token-a', field: 'facing' },
      },
    })
  })

  it('treats broad map-lane patches as conservative conflicts', () => {
    const summary = findLivePlayPredictionConflicts({
      pendingPredictions: [prediction('token-a', 'position', 'op_localmovea')],
      patches: [patchBase({
        type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
        scopes: [mapScope('metadata')],
        payload: { previous: {}, current: { scene: 'changed' } },
      })],
    })

    expect(summary).toMatchObject({
      hasConflicts: true,
      conflicts: [{
        opId: 'op_localmovea',
        patchType: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
        conflict: { right: { kind: 'unknown' } },
      }],
    })
  })

  it('treats unknown patch types as conservative conflicts', () => {
    const unknownPatch = {
      ...patchBase({
        scopes: [tokenScope('token-b', 'position')],
      }),
      type: 'future.patch',
    }
    const before = JSON.stringify(unknownPatch)

    const summary = findLivePlayPredictionConflicts({
      pendingPredictions: [prediction('token-a', 'position', 'op_localmovea')],
      patches: [unknownPatch],
    })

    expect(summary).toMatchObject({
      hasConflicts: true,
      conflicts: [{
        opId: 'op_localmovea',
        patchType: 'future.patch',
        conflict: { right: { kind: 'unknown' } },
      }],
    })
    expect(JSON.stringify(unknownPatch)).toBe(before)
  })

  it('treats malformed patch scopes as conservative conflicts', () => {
    const malformedPatch = {
      ...patchBase(),
      scopes: [{ kind: 'token', placementId: 'token-a', field: 'future-field' }] as unknown as LivePlayScope[],
    }

    expect(findLivePlayPredictionConflicts({
      pendingPredictions: [prediction('token-b', 'position', 'op_localmoveb')],
      patches: [malformedPatch],
    })).toMatchObject({
      hasConflicts: true,
      conflicts: [{ conflict: { right: { kind: 'unknown' } } }],
    })
  })
})
