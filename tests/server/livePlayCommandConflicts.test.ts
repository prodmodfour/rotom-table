import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createClearHazardsCommandScopes,
  createEditTerrainVoxelsCommandScopes,
  createLivePlayAcceptedResult,
  type BuildTerrainVoxelLivePlayCommand,
  type ClearHazardsLivePlayCommand,
  type ClearHazardsPayload,
  type EditTerrainVoxelsLivePlayCommand,
  type EditTerrainVoxelsPayload,
  type LivePlayCommandAccepted,
  type LivePlayCommandEnvelope,
  type LivePlayMapScope,
  type LivePlayPatch,
  type LivePlayScope,
  type LivePlayTokenScope,
  type MoveTokenLivePlayCommand,
  type SetInitiativeLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  evaluateLivePlayCommandConflicts,
  type LivePlayAcceptedOperationMetadata,
} from '~~/server/livePlay/conflicts'

const tokenScope = (placementId: string): LivePlayTokenScope => ({
  kind: 'token',
  placementId,
  field: 'position',
})

const initiativeScope = (): LivePlayMapScope => ({ kind: 'map', lane: 'initiative' })
const terrainScope = (): LivePlayMapScope => ({ kind: 'map', lane: 'terrain' })

const moveCommand = (
  placementId: string,
  overrides: Partial<MoveTokenLivePlayCommand> = {},
): MoveTokenLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: `op_move${placementId.replace(/[^A-Za-z0-9_-]/g, '')}000000`.slice(0, 20),
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [tokenScope(placementId)],
  payload: { placementId, position: { x: 2, y: 0, z: 2 } },
  ...overrides,
})

const initiativeCommand = (
  overrides: Partial<SetInitiativeLivePlayCommand> = {},
): SetInitiativeLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_initiative0001',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
  scopes: [initiativeScope()],
  payload: { tokenId: 'token-a', initiative: 12 },
  ...overrides,
})

const terrainCommand = (
  x: number,
  z: number,
  overrides: Partial<BuildTerrainVoxelLivePlayCommand> = {},
): BuildTerrainVoxelLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: `op_terrain${x}${z}000000`,
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
  scopes: [terrainScope()],
  payload: { voxel: { x, y: 0, z, materialId: 'stone' } },
  ...overrides,
})

const editTerrainCommand = (
  payload: EditTerrainVoxelsPayload,
  overrides: Partial<EditTerrainVoxelsLivePlayCommand> = {},
): EditTerrainVoxelsLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_editterrain1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS,
  scopes: createEditTerrainVoxelsCommandScopes(payload),
  payload,
  ...overrides,
})

const clearHazardsCommand = (
  payload: ClearHazardsPayload,
  overrides: Partial<ClearHazardsLivePlayCommand> = {},
): ClearHazardsLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_clearhaz001',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
  scopes: createClearHazardsCommandScopes(payload),
  payload,
  ...overrides,
})

const acceptedResult = (
  command: LivePlayCommandEnvelope,
  revision: number,
  scopes: readonly LivePlayScope[] = command.scopes,
): LivePlayCommandAccepted => {
  const patch: LivePlayPatch = {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    type: command.type === LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL || command.type === LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS
      ? LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN
      : command.type === LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE
        ? LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE
        : LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
    mapSlug: command.mapSlug,
    revision,
    scopes,
    payload: command.type === LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL
      ? { command: command.type, cell: (command.payload as { readonly voxel: unknown }).voxel, previous: null, current: (command.payload as { readonly voxel: unknown }).voxel }
      : command.type === LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS
        ? { command: command.type, changes: [] }
        : command.payload,
  }
  return createLivePlayAcceptedResult({
    opId: command.opId,
    mapSlug: command.mapSlug,
    previousRevision: revision - 1,
    revision,
    patches: [patch],
  })
}

const acceptedOp = (
  command: LivePlayCommandEnvelope,
  revision: number,
): LivePlayAcceptedOperationMetadata => ({
  mapSlug: command.mapSlug,
  opId: command.opId,
  revision,
  scopes: command.scopes,
  command,
  result: acceptedResult(command, revision),
})

describe('live-play command conflict detection', () => {
  it('rejects stale commands when an intervening accepted operation touched the same token field', () => {
    const prior = acceptedOp(moveCommand('token-a', { opId: 'op_prioraaaa1' }), 5)

    const decision = evaluateLivePlayCommandConflicts({
      command: moveCommand('token-a', { opId: 'op_sameaaaaa1' }),
      baseRevision: 4,
      currentRevision: 5,
      recentAcceptedOps: [prior],
    })

    expect(decision).toMatchObject({
      ok: false,
      reason: 'conflict',
      currentRevision: 5,
      conflictingOp: expect.objectContaining({ opId: 'op_prioraaaa1', revision: 5 }),
      message: expect.stringContaining('token token-a position'),
    })
  })

  it('allows stale commands when intervening accepted operations touched different token fields', () => {
    const decision = evaluateLivePlayCommandConflicts({
      command: moveCommand('token-b', { opId: 'op_tokenbbbb1' }),
      baseRevision: 4,
      currentRevision: 5,
      recentAcceptedOps: [acceptedOp(moveCommand('token-a', { opId: 'op_priorbbbb1' }), 5)],
    })

    expect(decision).toEqual({ ok: true })
  })

  it('rejects stale commands when an intervening accepted operation touched the same map lane', () => {
    const decision = evaluateLivePlayCommandConflicts({
      command: initiativeCommand({ opId: 'op_initcurrent' }),
      baseRevision: 4,
      currentRevision: 5,
      recentAcceptedOps: [acceptedOp(initiativeCommand({ opId: 'op_initprior1' }), 5)],
    })

    expect(decision).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('map lane initiative'),
    })
  })

  it('rejects same terrain cell conflicts while allowing different terrain cells', () => {
    const prior = acceptedOp(terrainCommand(2, 3, { opId: 'op_terrainprior' }), 5)

    expect(evaluateLivePlayCommandConflicts({
      command: terrainCommand(2, 3, { opId: 'op_terrainsame1' }),
      baseRevision: 4,
      currentRevision: 5,
      recentAcceptedOps: [prior],
    })).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('terrain cell 2,0,3'),
    })

    expect(evaluateLivePlayCommandConflicts({
      command: terrainCommand(4, 3, { opId: 'op_terraindiff1' }),
      baseRevision: 4,
      currentRevision: 5,
      recentAcceptedOps: [prior],
    })).toEqual({ ok: true })
  })

  it('applies editTerrainVoxels explicit and broad terrain conflict scopes conservatively', () => {
    const prior = acceptedOp(editTerrainCommand(
      { operations: [{ action: 'remove', cell: { x: 2, y: 0, z: 3 } }] },
      { opId: 'op_editprior1' },
    ), 5)

    expect(evaluateLivePlayCommandConflicts({
      command: editTerrainCommand(
        { operations: [{ action: 'upsert', voxel: { x: 2, y: 0, z: 3, materialId: 'stone' } }] },
        { opId: 'op_editsame01' },
      ),
      baseRevision: 4,
      currentRevision: 5,
      recentAcceptedOps: [prior],
    })).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('terrain cell 2,0,3'),
    })

    expect(evaluateLivePlayCommandConflicts({
      command: editTerrainCommand(
        { operations: [{ action: 'remove', cell: { x: 4, y: 0, z: 3 } }] },
        { opId: 'op_editdiff01' },
      ),
      baseRevision: 4,
      currentRevision: 5,
      recentAcceptedOps: [prior],
    })).toEqual({ ok: true })

    expect(evaluateLivePlayCommandConflicts({
      command: editTerrainCommand(
        {
          operations: Array.from(
            { length: 33 },
            (_, index) => ({ action: 'remove' as const, cell: { x: index, y: 0, z: 1 } }),
          ),
        },
        { opId: 'op_editbroad1' },
      ),
      baseRevision: 4,
      currentRevision: 5,
      recentAcceptedOps: [prior],
    })).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('terrain cell 2,0,3'),
    })
  })

  it('rejects same hazard cell conflicts while allowing different explicit clearHazards cells', () => {
    const prior = acceptedOp(clearHazardsCommand(
      { mode: 'cells', cells: [{ x: 2, y: 0, z: 3 }] },
      { opId: 'op_clearprior1' },
    ), 5)

    expect(evaluateLivePlayCommandConflicts({
      command: clearHazardsCommand(
        { mode: 'cells', cells: [{ x: 2, y: 0, z: 3 }] },
        { opId: 'op_clearsame01' },
      ),
      baseRevision: 4,
      currentRevision: 5,
      recentAcceptedOps: [prior],
    })).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('hazard cell 2,0,3'),
    })

    expect(evaluateLivePlayCommandConflicts({
      command: clearHazardsCommand(
        { mode: 'cells', cells: [{ x: 4, y: 0, z: 3 }] },
        { opId: 'op_cleardiff01' },
      ),
      baseRevision: 4,
      currentRevision: 5,
      recentAcceptedOps: [prior],
    })).toEqual({ ok: true })

    expect(evaluateLivePlayCommandConflicts({
      command: clearHazardsCommand({ mode: 'all' }, { opId: 'op_clearall001' }),
      baseRevision: 4,
      currentRevision: 5,
      recentAcceptedOps: [prior],
    })).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('hazard cell 2,0,3'),
    })
  })

  it('rejects stale commands safely when accepted operation history is unavailable or incomplete', () => {
    expect(evaluateLivePlayCommandConflicts({
      command: moveCommand('token-b', { opId: 'op_missinghist1' }),
      baseRevision: 4,
      currentRevision: 5,
      recentAcceptedOps: null,
    })).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 5,
      message: expect.stringContaining('history through revision 5 is unavailable'),
    })

    expect(evaluateLivePlayCommandConflicts({
      command: moveCommand('token-b', { opId: 'op_missinghist2' }),
      baseRevision: 4,
      currentRevision: 6,
      recentAcceptedOps: [acceptedOp(moveCommand('token-a', { opId: 'op_onlyrevfive1' }), 5)],
    })).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 6,
      message: expect.stringContaining('history through revision 6 is incomplete'),
    })
  })
})
