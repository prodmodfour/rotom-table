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
  PLACE_HAZARD_COMMAND_TYPE,
  REMOVE_HAZARD_COMMAND_TYPE,
  createHazardCommandScope,
  type HazardCommand,
  type PlaceHazardCommand,
  type RemoveHazardCommand,
} from '#shared/sessionHazardCommands'
import type { MapHazardV2, TabletopMapV2 } from '~/types/map'
import {
  ApplyHazardCommandUseCaseError,
  HAZARDS_UPDATED_PATCH_EVENT_TYPE,
  applyHazardCommandUseCase,
} from '~~/server/useCases/applyHazardCommand'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { ROTOM_ENABLE_SESSION_HOST: '1' } as const
const sessionId = parseSessionId('session_hazardusecase001')
const joinCode = parseJoinCode('ABC263')
const gmKey = parseGmKey('gmkey_hazardusecase000000000001')
const gmClientId = parseClientId('client_hazarducgm')
const playerClientId = parseClientId('client_hazarducpl')
const playerId = parsePlayerId('player_hazarduc01')
const displayName = parseSessionDisplayName('Hazard Player')
const createdAt = '2026-05-26T19:00:00.000Z'
const processedAt = '2026-05-26T19:00:05.000Z'

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

const createMap = (hazards: MapHazardV2[] = []): TabletopMapV2 => ({
  schemaVersion: 2,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards,
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
  hazards: MapHazardV2[] = [],
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
      document: createMap(hazards),
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

const createPlaceCommand = (
  overrides: Partial<PlaceHazardCommand> = {},
): PlaceHazardCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: PLACE_HAZARD_COMMAND_TYPE,
  opId: parseOpId('op_placehazarduc1'),
  baseRevision: parseSessionRevision(0),
  scopes: [createHazardCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    hazard: {
      kind: 'spikes',
      x: 1,
      y: 0,
      z: 2,
      owner: 'Red side',
    },
  },
  metadata: {
    traceId: 'trace-hazard-use-case',
  },
  ...overrides,
})

const createRemoveCommand = (
  overrides: Partial<RemoveHazardCommand> = {},
): RemoveHazardCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: REMOVE_HAZARD_COMMAND_TYPE,
  opId: parseOpId('op_removehazarduc'),
  baseRevision: parseSessionRevision(0),
  scopes: [createHazardCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    cell: {
      x: 1,
      y: 0,
      z: 2,
      kind: 'spikes',
    },
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

describe('applyHazardCommandUseCase', () => {
  it('places a hazard, increments revisions, writes a snapshot, and returns a small hazards patch', () => {
    const store = createStoreWithState(createState())
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const result = applyHazardCommandUseCase({ command: createPlaceCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted placeHazard')
    expect(result.session.revision).toBe(parseSessionRevision(1))
    expect(result.patchEvent).toMatchObject({
      eventType: HAZARDS_UPDATED_PATCH_EVENT_TYPE,
      commandType: PLACE_HAZARD_COMMAND_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        mapSlug: 'arena-map',
        command: PLACE_HAZARD_COMMAND_TYPE,
        cell: { x: 1, y: 0, z: 2 },
        previous: [],
        current: [{ kind: 'spikes', x: 1, y: 0, z: 2, owner: 'Red side' }],
        placed: { kind: 'spikes', x: 1, y: 0, z: 2, owner: 'Red side' },
        removed: [],
      },
    })
    expect(result.result).toMatchObject({
      status: 'accepted',
      accepted: true,
      commandType: PLACE_HAZARD_COMMAND_TYPE,
      currentRevision: parseSessionRevision(1),
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-hazard-use-case',
      },
    })
    expect(result.previousHazards.hazards).toEqual([])
    expect(result.hazards.hazards).toEqual([{ kind: 'spikes', x: 1, y: 0, z: 2, owner: 'Red side' }])
    expect(snapshotCalls).toHaveLength(1)
    expect(snapshotCalls[0]?.revision).toBe(parseSessionRevision(1))
    expect(result.snapshot).toEqual({ writtenAt: processedAt, revision: parseSessionRevision(1) })
    expect(tracker.recordCount).toBe(1)

    const storedMap = getSessionMapState(store.get(sessionId)!.state!, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.hazards).toEqual([{ kind: 'spikes', x: 1, y: 0, z: 2, owner: 'Red side' }])
    expect(JSON.stringify(result.patchEvent.payload)).not.toContain('voxels')
    expect(JSON.stringify(result.patchEvent.payload)).not.toContain('placements')
  })

  it('increments Toxic Spikes layers and removes only the requested hazard kind', () => {
    const store = createStoreWithState(createState(0, [
      { kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 1 },
      { kind: 'spikes', x: 1, y: 0, z: 2 },
    ]))
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const layered = applyHazardCommandUseCase({
      command: createPlaceCommand({
        opId: parseOpId('op_toxichazarduc'),
        payload: {
          mapSlug: 'arena-map',
          hazard: { kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 1 },
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(layered.status).toBe('accepted')
    if (layered.status !== 'accepted') throw new Error('expected toxic layer accepted')
    expect(layered.patchEvent.payload.current).toEqual([
      { kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 2 },
      { kind: 'spikes', x: 1, y: 0, z: 2 },
    ])

    const removed = applyHazardCommandUseCase({
      command: createRemoveCommand({
        opId: parseOpId('op_removespikeuc'),
        baseRevision: parseSessionRevision(1),
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => '2026-05-26T19:00:06.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(removed.status).toBe('accepted')
    if (removed.status !== 'accepted') throw new Error('expected remove accepted')
    expect(removed.patchEvent.payload.removed).toEqual([{ kind: 'spikes', x: 1, y: 0, z: 2 }])
    expect(removed.patchEvent.payload.current).toEqual([
      { kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 2 },
    ])
    expect(snapshotCalls).toHaveLength(2)
  })

  it('rejects player and invalid hazard changes without mutating authoritative state', () => {
    const store = createStoreWithState(createState())
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const playerResult = applyHazardCommandUseCase({
      command: createPlaceCommand({ actor: playerActor }),
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
      commandType: PLACE_HAZARD_COMMAND_TYPE,
      currentRevision: parseSessionRevision(0),
      permission: { reason: 'gm-required' },
    })

    const outOfBounds = applyHazardCommandUseCase({
      command: createPlaceCommand({
        opId: parseOpId('op_oobhazarduc1'),
        payload: {
          mapSlug: 'arena-map',
          hazard: { kind: 'fire', x: 9, y: 0, z: 1 },
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
    expect(snapshotCalls).toEqual([])
    expect(store.get(sessionId)?.state?.revision).toBe(parseSessionRevision(0))
  })

  it('rejects stale hazard changes when the hazard lane changed after the command base revision', () => {
    const store = createStoreWithState(createState())
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const accepted = applyHazardCommandUseCase({ command: createPlaceCommand() }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(accepted.status).toBe('accepted')

    const stale = applyHazardCommandUseCase({
      command: createRemoveCommand({
        opId: parseOpId('op_stalehazarduc'),
        baseRevision: parseSessionRevision(0),
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T19:00:07.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(stale.status).toBe('rejected')
    if (stale.status !== 'rejected') throw new Error('expected stale rejection')
    expect(stale.result).toMatchObject({
      reason: 'stale',
      baseRevision: parseSessionRevision(0),
      currentRevision: parseSessionRevision(1),
      currentState: {
        mapSlug: 'arena-map',
        cell: { x: 1, y: 0, z: 2 },
        hazards: [{ kind: 'spikes', x: 1, y: 0, z: 2, owner: 'Red side' }],
      },
    })
    expect(snapshotCalls).toHaveLength(1)
  })

  it('returns idempotent duplicate results and rolls back store state if snapshot writing fails', () => {
    const store = createStoreWithState(createState())
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const command = createPlaceCommand({ opId: parseOpId('op_dupehazarduc') })

    const first = applyHazardCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(first.status).toBe('accepted')

    const duplicate = applyHazardCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => '2026-05-26T19:00:08.000Z',
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    expect(duplicate.status).toBe('duplicate')
    if (duplicate.status !== 'duplicate') throw new Error('expected duplicate')
    expect(duplicate.result).toMatchObject({
      status: 'duplicate',
      commandType: PLACE_HAZARD_COMMAND_TYPE,
      currentRevision: parseSessionRevision(1),
      original: { status: 'accepted', revision: parseSessionRevision(1) },
    })
    expect(snapshotCalls).toHaveLength(1)

    expect(() => applyHazardCommandUseCase({
      command: createRemoveCommand({
        opId: parseOpId('op_failhazarduc'),
        baseRevision: parseSessionRevision(1),
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: false,
      clock: () => '2026-05-26T19:00:09.000Z',
      writeSnapshot: () => {
        throw new Error('disk full')
      },
    })).toThrow(ApplyHazardCommandUseCaseError)

    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(1))
    expect(getSessionMapState(store.get(sessionId)!.state!, 'arena-map')?.document.hazards)
      .toEqual([{ kind: 'spikes', x: 1, y: 0, z: 2, owner: 'Red side' }])
  })

  it('fails closed when session hosting is disabled', () => {
    const store = createStoreWithState(createState())

    expect(() => applyHazardCommandUseCase({ command: createPlaceCommand() }, {
      env: {},
      store,
    })).toThrow('live session hosting is disabled')
  })
})
