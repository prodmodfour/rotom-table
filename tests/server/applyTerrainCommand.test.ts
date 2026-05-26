import { describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
} from '#shared/sessionCommands'
import {
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import type { PlayerSessionActor } from '#shared/sessionPermissions'
import {
  parseMapRevision,
  parseSessionRevision,
} from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  getSessionMapState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import {
  BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
  REMOVE_TERRAIN_VOXEL_COMMAND_TYPE,
  createTerrainVoxelCommandScope,
  type BuildTerrainVoxelCommand,
  type RemoveTerrainVoxelCommand,
} from '#shared/sessionTerrainCommands'
import type { MapVoxelV2, TabletopMapV2 } from '~/types/map'
import { getTerrainVoxelsRevisionKey } from '~/utils/isometric/sceneState'
import {
  ApplyTerrainCommandUseCaseError,
  TERRAIN_RENDER_INVALIDATION_REASONS,
  TERRAIN_VOXELS_UPDATED_PATCH_EVENT_TYPE,
  applyTerrainCommandUseCase,
} from '~~/server/useCases/applyTerrainCommand'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { ROTOM_ENABLE_SESSION_HOST: '1' } as const
const sessionId = parseSessionId('session_terrainusecase01')
const joinCode = parseJoinCode('TRN263')
const gmKey = parseGmKey('gmkey_terrainusecase0000000001')
const gmClientId = parseClientId('client_terrainucgm')
const playerClientId = parseClientId('client_terrainucpl')
const playerId = parsePlayerId('player_terrainuc1')
const displayName = parseSessionDisplayName('Terrain Player')
const createdAt = '2026-05-26T20:00:00.000Z'
const processedAt = '2026-05-26T20:00:05.000Z'

const gmActor = {
  role: 'gm' as const,
  clientId: gmClientId,
}

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId,
  clientId: playerClientId,
  displayName,
}

const createMap = (voxels: MapVoxelV2[] = []): TabletopMapV2 => ({
  schemaVersion: 2,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels,
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  moveUsage: { byPlacementId: {} },
  metadata: {},
  createdAt: 1_000,
  updatedAt: 1_000,
})

const createState = (
  revision = 0,
  voxels: MapVoxelV2[] = [],
  placements: TabletopMapV2['placements'] = [],
): AuthoritativeSessionState<TabletopMapV2> => createAuthoritativeSessionState<TabletopMapV2>({
  sessionId,
  createdAt,
  updatedAt: createdAt,
  revision: parseSessionRevision(revision),
  selectedMapSlug: 'arena-map',
  maps: [
    createAuthoritativeSessionMapState<TabletopMapV2>({
      mapSlug: 'arena-map',
      revision: parseMapRevision(revision),
      document: {
        ...createMap(voxels),
        placements,
      },
    }),
  ],
  players: [
    {
      playerId,
      displayName,
      joinedAt: createdAt,
      updatedAt: createdAt,
    },
  ],
  assignments: [
    {
      playerId,
      displayName,
      controllableResources: [],
      visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }],
      updatedAt: createdAt,
      updatedByClientId: gmClientId,
    },
  ],
})

const createStoreWithState = (state: AuthoritativeSessionState<TabletopMapV2>) => {
  const store = createInMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>()
  store.create({
    sessionId,
    joinCode,
    gmKey,
    revision: state.revision,
    createdAt,
    updatedAt: createdAt,
    state,
  })
  return store
}

const buildCell = { x: 1, y: 0, z: 2 }

const createBuildCommand = (
  overrides: Partial<BuildTerrainVoxelCommand> = {},
): BuildTerrainVoxelCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
  opId: parseOpId('op_buildterrainuc'),
  baseRevision: parseSessionRevision(0),
  scopes: [createTerrainVoxelCommandScope(buildCell, 'arena-map')],
  payload: {
    mapSlug: 'arena-map',
    voxel: {
      ...buildCell,
      materialId: 'shallow_water',
      ghost: true,
      blocksMovement: false,
      tags: ['pool'],
    },
  },
  metadata: {
    traceId: 'trace-terrain-use-case',
  },
  ...overrides,
})

const createRemoveCommand = (
  overrides: Partial<RemoveTerrainVoxelCommand> = {},
): RemoveTerrainVoxelCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: REMOVE_TERRAIN_VOXEL_COMMAND_TYPE,
  opId: parseOpId('op_remterrainuc'),
  baseRevision: parseSessionRevision(0),
  scopes: [createTerrainVoxelCommandScope(buildCell, 'arena-map')],
  payload: {
    mapSlug: 'arena-map',
    cell: buildCell,
  },
  ...overrides,
})

const createSnapshotWriter = (calls: AuthoritativeSessionState<TabletopMapV2>[]) => (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options = {},
): WriteSessionSnapshotResult<TabletopMapV2> => {
  calls.push(state)
  const snapshot = createPersistedSessionSnapshot(state, options)
  return {
    directoryPath: '/tmp/session',
    filePath: '/tmp/session/snapshot.json',
    snapshot,
    bytesWritten: 1,
  }
}

describe('applyTerrainCommandUseCase', () => {
  it('builds a terrain voxel, increments revisions, writes a snapshot, and returns a renderer-safe small patch', () => {
    const store = createStoreWithState(createState())
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const beforeKey = getTerrainVoxelsRevisionKey([])

    const result = applyTerrainCommandUseCase({ command: createBuildCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted buildTerrainVoxel')
    expect(result.session.revision).toBe(parseSessionRevision(1))
    expect(result.patchEvent).toMatchObject({
      eventType: TERRAIN_VOXELS_UPDATED_PATCH_EVENT_TYPE,
      commandType: BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        mapSlug: 'arena-map',
        command: BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
        cell: buildCell,
        previous: null,
        current: {
          ...buildCell,
          materialId: 'shallow_water',
          ghost: true,
          blocksMovement: false,
          tags: ['pool'],
        },
        built: {
          ...buildCell,
          materialId: 'shallow_water',
          ghost: true,
          blocksMovement: false,
          tags: ['pool'],
        },
        rendererInvalidation: TERRAIN_RENDER_INVALIDATION_REASONS,
      },
    })
    expect(result.patchEvent.payload.current?.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(result.result).toMatchObject({
      status: 'accepted',
      accepted: true,
      commandType: BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
      currentRevision: parseSessionRevision(1),
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-terrain-use-case',
      },
    })
    expect(result.previousTerrain.voxel).toBeUndefined()
    expect(result.terrain.voxel).toMatchObject({ ...buildCell, materialId: 'shallow_water' })
    expect(snapshotCalls).toHaveLength(1)
    expect(snapshotCalls[0]?.revision).toBe(parseSessionRevision(1))
    expect(result.snapshot).toEqual({ writtenAt: processedAt, revision: parseSessionRevision(1) })
    expect(tracker.recordCount).toBe(1)

    const storedMap = getSessionMapState(store.get(sessionId)!.state!, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.voxels).toHaveLength(1)
    expect(getTerrainVoxelsRevisionKey(storedMap?.document.voxels ?? [])).not.toBe(beforeKey)
    expect(JSON.stringify(result.patchEvent.payload)).not.toContain('placements')
    expect(JSON.stringify(result.patchEvent.payload)).not.toContain('fieldEffects')
  })

  it('replaces and removes individual terrain voxels without whole-map fanout', () => {
    const existing: MapVoxelV2 = { ...buildCell, materialId: 'meadow_grass', color: '#33aa44' }
    const store = createStoreWithState(createState(0, [existing]))
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const replaced = applyTerrainCommandUseCase({
      command: createBuildCommand({
        opId: parseOpId('op_replterrain1'),
        payload: {
          mapSlug: 'arena-map',
          voxel: { ...buildCell, materialId: 'airship_floor_metal', blocksSight: true },
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(replaced.status).toBe('accepted')
    if (replaced.status !== 'accepted') throw new Error('expected replace accepted')
    expect(replaced.patchEvent.payload.previous).toEqual(existing)
    expect(replaced.patchEvent.payload.current).toEqual({ ...buildCell, materialId: 'airship_floor_metal', blocksSight: true })

    const removed = applyTerrainCommandUseCase({
      command: createRemoveCommand({
        opId: parseOpId('op_remterrain2'),
        baseRevision: parseSessionRevision(1),
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => '2026-05-26T20:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(removed.status).toBe('accepted')
    if (removed.status !== 'accepted') throw new Error('expected remove accepted')
    expect(removed.patchEvent.payload).toMatchObject({
      command: REMOVE_TERRAIN_VOXEL_COMMAND_TYPE,
      previous: { ...buildCell, materialId: 'airship_floor_metal', blocksSight: true },
      current: null,
      removed: { ...buildCell, materialId: 'airship_floor_metal', blocksSight: true },
    })
    expect(snapshotCalls).toHaveLength(2)
    expect(getSessionMapState(store.get(sessionId)!.state!, 'arena-map')?.document.voxels).toEqual([])
  })

  it('rejects player, out-of-bounds, occupied, no-op, and unbuildable terrain changes without snapshots', () => {
    const existing: MapVoxelV2 = { ...buildCell, materialId: 'meadow_grass' }
    const store = createStoreWithState(createState(0, [existing], [
      {
        id: 'token-1',
        sheetKind: 'pokemon',
        sheetSlug: 'bulbasaur',
        position: { x: 2, y: 0, z: 2 },
      },
    ]))
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const playerResult = applyTerrainCommandUseCase({
      command: createBuildCommand({ actor: playerActor }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(playerResult.status).toBe('rejected')
    if (playerResult.status !== 'rejected') throw new Error('expected player rejection')
    expect(playerResult.result).toMatchObject({
      reason: 'unauthorized',
      permission: { reason: 'gm-required' },
      currentRevision: parseSessionRevision(0),
    })

    const outOfBounds = applyTerrainCommandUseCase({
      command: createBuildCommand({
        opId: parseOpId('op_oobterrain1'),
        scopes: [createTerrainVoxelCommandScope({ x: 9, y: 0, z: 1 }, 'arena-map')],
        payload: {
          mapSlug: 'arena-map',
          voxel: { x: 9, y: 0, z: 1, materialId: 'meadow_grass' },
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(outOfBounds.status).toBe('rejected')
    if (outOfBounds.status !== 'rejected') throw new Error('expected out-of-bounds rejection')
    expect(outOfBounds.result).toMatchObject({ reason: 'conflict', currentRevision: parseSessionRevision(0) })

    const occupied = applyTerrainCommandUseCase({
      command: createBuildCommand({
        opId: parseOpId('op_occterrain1'),
        scopes: [createTerrainVoxelCommandScope({ x: 2, y: 0, z: 2 }, 'arena-map')],
        payload: {
          mapSlug: 'arena-map',
          voxel: { x: 2, y: 0, z: 2, materialId: 'meadow_grass' },
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(occupied.status).toBe('rejected')
    if (occupied.status !== 'rejected') throw new Error('expected occupied rejection')
    expect(occupied.result.message).toContain('a token occupies that cell')

    const noOp = applyTerrainCommandUseCase({
      command: createBuildCommand({
        opId: parseOpId('op_noopterrain1'),
        payload: { mapSlug: 'arena-map', voxel: existing },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(noOp.status).toBe('rejected')
    if (noOp.status !== 'rejected') throw new Error('expected no-op rejection')
    expect(noOp.result).toMatchObject({ reason: 'conflict', retryable: false })

    const glass = applyTerrainCommandUseCase({
      command: createBuildCommand({
        opId: parseOpId('op_glsterrain1'),
        scopes: [createTerrainVoxelCommandScope({ x: 3, y: 0, z: 2 }, 'arena-map')],
        payload: {
          mapSlug: 'arena-map',
          voxel: { x: 3, y: 0, z: 2, materialId: 'reinforced_glass' },
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(glass.status).toBe('rejected')
    if (glass.status !== 'rejected') throw new Error('expected glass rejection')
    expect(glass.result.message).toContain('not available to the Track 1 terrain builder palette')

    expect(snapshotCalls).toEqual([])
    expect(store.get(sessionId)?.state?.revision).toBe(parseSessionRevision(0))
  })

  it('rejects stale same-cell terrain changes while allowing tracked disjoint cells across small revision gaps', () => {
    const store = createStoreWithState(createState())
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const accepted = applyTerrainCommandUseCase({ command: createBuildCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(accepted.status).toBe('accepted')

    const disjointCell = { x: 4, y: 0, z: 4 }
    const disjoint = applyTerrainCommandUseCase({
      command: createBuildCommand({
        opId: parseOpId('op_disjterrain'),
        baseRevision: parseSessionRevision(0),
        scopes: [createTerrainVoxelCommandScope(disjointCell, 'arena-map')],
        payload: {
          mapSlug: 'arena-map',
          voxel: { ...disjointCell, materialId: 'meadow_grass' },
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T20:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(disjoint.status).toBe('accepted')
    if (disjoint.status !== 'accepted') throw new Error('expected disjoint accepted')
    expect(disjoint.session.revision).toBe(parseSessionRevision(2))

    const stale = applyTerrainCommandUseCase({
      command: createRemoveCommand({
        opId: parseOpId('op_staleterrain'),
        baseRevision: parseSessionRevision(0),
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T20:00:07.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(stale.status).toBe('rejected')
    if (stale.status !== 'rejected') throw new Error('expected stale rejection')
    expect(stale.result).toMatchObject({
      reason: 'stale',
      baseRevision: parseSessionRevision(0),
      currentRevision: parseSessionRevision(2),
      currentState: {
        mapSlug: 'arena-map',
        cell: buildCell,
        voxel: expect.objectContaining({ ...buildCell, materialId: 'shallow_water' }),
      },
    })
    expect(snapshotCalls).toHaveLength(2)
  })

  it('returns idempotent duplicate results and rolls back store state if snapshot writing fails', () => {
    const store = createStoreWithState(createState())
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const command = createBuildCommand({ opId: parseOpId('op_dupeterrain') })

    const first = applyTerrainCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(first.status).toBe('accepted')

    const duplicate = applyTerrainCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T20:00:08.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(duplicate.status).toBe('duplicate')
    if (duplicate.status !== 'duplicate') throw new Error('expected duplicate')
    expect(duplicate.result).toMatchObject({
      status: 'duplicate',
      commandType: BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
      currentRevision: parseSessionRevision(1),
      original: { status: 'accepted', revision: parseSessionRevision(1) },
    })
    expect(snapshotCalls).toHaveLength(1)

    expect(() => applyTerrainCommandUseCase({
      command: createRemoveCommand({
        opId: parseOpId('op_failterrain'),
        baseRevision: parseSessionRevision(1),
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => '2026-05-26T20:00:09.000Z',
      writeSnapshot: () => {
        throw new Error('disk full')
      },
    })).toThrow(ApplyTerrainCommandUseCaseError)

    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
    expect(getSessionMapState(store.get(sessionId)!.state!, 'arena-map')?.document.voxels)
      .toHaveLength(1)
  })

  it('fails closed when session hosting is disabled', () => {
    const store = createStoreWithState(createState())

    expect(() => applyTerrainCommandUseCase({ command: createBuildCommand() }, {
      env: {},
      store,
    })).toThrow('Track 2 session hosting is disabled')
  })
})
