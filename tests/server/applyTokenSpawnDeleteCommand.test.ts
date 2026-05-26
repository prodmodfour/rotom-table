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
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import type { GmSessionActor, PlayerSessionActor, SessionTokenResourceRef } from '#shared/sessionPermissions'
import { parseMapRevision, parseSessionRevision } from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  getSessionMapState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import {
  DELETE_TOKEN_COMMAND_TYPE,
  SPAWN_TOKEN_COMMAND_TYPE,
  createDeleteTokenCommandScope,
  createSpawnTokenCommandScope,
  type DeleteTokenCommand,
  type SpawnTokenCommand,
} from '#shared/sessionTokenCommands'
import type { TabletopMapV2 } from '~/types/map'
import {
  DELETE_TOKEN_PATCH_EVENT_TYPE,
  applyDeleteTokenCommandUseCase,
} from '~~/server/useCases/applyDeleteTokenCommand'
import {
  SPAWN_TOKEN_PATCH_EVENT_TYPE,
  applySpawnTokenCommandUseCase,
} from '~~/server/useCases/applySpawnTokenCommand'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionOperationTracker } from '~~/server/utils/sessionOperationTracker'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { ROTOM_ENABLE_SESSION_HOST: '1' } as const
const sessionId = parseSessionId('session_spawndel0001')
const joinCode = parseJoinCode('SP5DEL')
const gmKey = parseGmKey('gmkey_spawndelete0000000000000')
const gmClientId = parseClientId('client_spawndelGM')
const playerClientId = parseClientId('client_spawndelPL')
const playerId = parsePlayerId('player_spawndel')
const displayName = sanitizeSessionDisplayName('Spawn Delete Player')
const createdAt = '2026-05-26T12:00:00.000Z'
const processedAt = '2026-05-26T12:00:05.000Z'

const gmActor: GmSessionActor = {
  role: 'gm',
  clientId: gmClientId,
}

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId,
  clientId: playerClientId,
  displayName,
}

const spawnResource = {
  kind: 'token',
  tokenId: 'token-bulbasaur',
  mapSlug: 'arena-map',
  sheetKind: 'pokemon',
  sheetSlug: 'bulbasaur',
} as const satisfies SessionTokenResourceRef

const deleteResource = {
  kind: 'token',
  tokenId: 'token-pikachu',
  mapSlug: 'arena-map',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionTokenResourceRef

const createMap = (overrides: Partial<TabletopMapV2> = {}): TabletopMapV2 => ({
  schemaVersion: 2,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'token-pikachu',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
    },
  ],
  lights: [],
  initiative: { activeId: 'token-pikachu', round: 1 },
  moveUsage: { byPlacementId: {} },
  metadata: {},
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
})

const createState = (map: TabletopMapV2 = createMap()): AuthoritativeSessionState<TabletopMapV2> =>
  createAuthoritativeSessionState<TabletopMapV2>({
    sessionId,
    createdAt,
    updatedAt: createdAt,
    revision: parseSessionRevision(0),
    selectedMapSlug: 'arena-map',
    maps: [
      createAuthoritativeSessionMapState<TabletopMapV2>({
        mapSlug: 'arena-map',
        revision: parseMapRevision(0),
        document: map,
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
    assignments: [],
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

const createSpawnCommand = (
  overrides: Partial<SpawnTokenCommand> = {},
): SpawnTokenCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: SPAWN_TOKEN_COMMAND_TYPE,
  opId: parseOpId('op_spawntoken001'),
  baseRevision: parseSessionRevision(0),
  scopes: [createSpawnTokenCommandScope(spawnResource)],
  payload: {
    placement: {
      id: 'token-bulbasaur',
      sheetKind: 'pokemon',
      sheetSlug: 'bulbasaur',
      position: { x: 3, y: 0, z: 3 },
      facing: 'north-east',
    },
  },
  metadata: {
    clientIssuedAt: '2026-05-26T12:00:04.500Z',
    traceId: 'trace-spawn-token-use-case',
  },
  ...overrides,
})

const createDeleteCommand = (
  overrides: Partial<DeleteTokenCommand> = {},
): DeleteTokenCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: DELETE_TOKEN_COMMAND_TYPE,
  opId: parseOpId('op_deletetoken01'),
  baseRevision: parseSessionRevision(0),
  scopes: [createDeleteTokenCommandScope(deleteResource)],
  payload: {
    tokenId: 'token-pikachu',
  },
  metadata: {
    clientIssuedAt: '2026-05-26T12:00:04.750Z',
    traceId: 'trace-delete-token-use-case',
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

describe('applySpawnTokenCommandUseCase', () => {
  it('applies a GM spawnToken command, increments revisions, and writes a small tokenSpawned patch', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const command = createSpawnCommand()

    const result = applySpawnTokenCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted spawnToken')
    expect(result.result).toMatchObject({
      status: 'accepted',
      commandType: 'spawnToken',
      currentRevision: parseSessionRevision(1),
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-spawn-token-use-case',
      },
    })
    expect(result.patchEvent).toMatchObject({
      eventType: SPAWN_TOKEN_PATCH_EVENT_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        tokenId: 'token-bulbasaur',
        mapSlug: 'arena-map',
        sheetKind: 'pokemon',
        sheetSlug: 'bulbasaur',
        position: { x: 3, y: 0, z: 3 },
        placement: {
          id: 'token-bulbasaur',
          facing: 'north-east',
          turned: false,
        },
      },
    })
    expect(result.mapRevisionChanges).toEqual([
      expect.objectContaining({
        mapSlug: 'arena-map',
        previousRevision: parseMapRevision(0),
        currentRevision: parseMapRevision(1),
      }),
    ])
    expect(snapshotCalls).toHaveLength(1)
    expect(result.snapshot).toEqual({ writtenAt: processedAt, revision: parseSessionRevision(1) })
    expect(tracker.recordCount).toBe(1)

    const storedMap = getSessionMapState(store.get(sessionId)?.state ?? initialState, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.placements.map((placement) => placement.id)).toEqual([
      'token-pikachu',
      'token-bulbasaur',
    ])
    expect(storedMap?.document.updatedAt).toBe(Date.parse(processedAt))
  })

  it('rejects player spawnToken commands and occupied spawn destinations without mutating state', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []

    const playerResult = applySpawnTokenCommandUseCase({
      command: createSpawnCommand({ actor: playerActor, opId: parseOpId('op_spawnplayer01') }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: createInMemorySessionOperationTracker(),
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })
    const occupiedResult = applySpawnTokenCommandUseCase({
      command: createSpawnCommand({
        opId: parseOpId('op_spawnblocked1'),
        payload: {
          placement: {
            id: 'token-bulbasaur',
            sheetKind: 'pokemon',
            sheetSlug: 'bulbasaur',
            position: { x: 1, y: 0, z: 1 },
          },
        },
      }),
    }, {
      env: enabledEnv,
      store,
      operationTracker: createInMemorySessionOperationTracker(),
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(playerResult.status).toBe('rejected')
    if (playerResult.status !== 'rejected') throw new Error('expected unauthorized rejection')
    expect(playerResult.result).toMatchObject({ reason: 'unauthorized', retryable: false })
    expect(occupiedResult.status).toBe('rejected')
    if (occupiedResult.status !== 'rejected') throw new Error('expected conflict rejection')
    expect(occupiedResult.result).toMatchObject({ reason: 'conflict', retryable: true })
    expect(snapshotCalls).toHaveLength(0)
    expect(store.get(sessionId)?.revision).toBe(parseSessionRevision(0))
  })
})

describe('applyDeleteTokenCommandUseCase', () => {
  it('applies a GM deleteToken command, clears active initiative, and writes a tokenDeleted patch', () => {
    const initialState = createState()
    const store = createStoreWithState(initialState)
    const tracker = createInMemorySessionOperationTracker()
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const command = createDeleteCommand()

    const result = applyDeleteTokenCommandUseCase({ command }, {
      env: enabledEnv,
      store,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter(snapshotCalls),
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') throw new Error('expected accepted deleteToken')
    expect(result.result).toMatchObject({
      status: 'accepted',
      commandType: 'deleteToken',
      currentRevision: parseSessionRevision(1),
      metadata: {
        serverProcessedAt: processedAt,
        traceId: 'trace-delete-token-use-case',
      },
    })
    expect(result.patchEvent).toMatchObject({
      eventType: DELETE_TOKEN_PATCH_EVENT_TYPE,
      revision: parseSessionRevision(1),
      payload: {
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        clearedActiveInitiative: true,
        position: { x: 1, y: 0, z: 1 },
      },
    })
    expect(snapshotCalls).toHaveLength(1)
    expect(result.token.tokenId).toBe('token-pikachu')
    expect(result.snapshot).toEqual({ writtenAt: processedAt, revision: parseSessionRevision(1) })

    const storedMap = getSessionMapState(store.get(sessionId)?.state ?? initialState, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.placements).toEqual([])
    expect(storedMap?.document.initiative?.activeId).toBeNull()
  })

  it('rejects player deleteToken commands, tracks duplicate GM retries, and rolls back on snapshot failures', () => {
    const initialState = createState()
    const unauthorizedStore = createStoreWithState(initialState)
    const unauthorizedResult = applyDeleteTokenCommandUseCase({
      command: createDeleteCommand({ actor: playerActor, opId: parseOpId('op_deleteplayr1') }),
    }, {
      env: enabledEnv,
      store: unauthorizedStore,
      operationTracker: createInMemorySessionOperationTracker(),
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
    })

    expect(unauthorizedResult.status).toBe('rejected')
    if (unauthorizedResult.status !== 'rejected') throw new Error('expected unauthorized rejection')
    expect(unauthorizedResult.result).toMatchObject({ reason: 'unauthorized', retryable: false })
    expect(unauthorizedStore.get(sessionId)?.revision).toBe(parseSessionRevision(0))

    const duplicateStore = createStoreWithState(createState())
    const tracker = createInMemorySessionOperationTracker()
    const command = createDeleteCommand({ opId: parseOpId('op_deletedupe01') })
    const first = applyDeleteTokenCommandUseCase({ command }, {
      env: enabledEnv,
      store: duplicateStore,
      operationTracker: tracker,
      clock: () => processedAt,
      writeSnapshot: createSnapshotWriter([]),
    })
    const duplicate = applyDeleteTokenCommandUseCase({ command }, {
      env: enabledEnv,
      store: duplicateStore,
      operationTracker: tracker,
      clock: () => '2026-05-26T12:00:06.000Z',
      writeSnapshot: createSnapshotWriter([]),
    })

    expect(first.status).toBe('accepted')
    expect(duplicate.status).toBe('duplicate')
    if (duplicate.status !== 'duplicate') throw new Error('expected duplicate deleteToken')
    expect(duplicate.result).toMatchObject({
      duplicate: true,
      idempotent: true,
      original: { status: 'accepted', revision: parseSessionRevision(1) },
    })

    const rollbackStore = createStoreWithState(createState())
    expect(() => applyDeleteTokenCommandUseCase({
      command: createDeleteCommand({ opId: parseOpId('op_deleteroll1') }),
    }, {
      env: enabledEnv,
      store: rollbackStore,
      operationTracker: false,
      clock: () => processedAt,
      writeSnapshot: () => {
        throw new Error('disk full')
      },
    })).toThrow('Failed to write deleteToken session snapshot: disk full')
    expect(rollbackStore.get(sessionId)?.revision).toBe(parseSessionRevision(0))
    expect(getSessionMapState(rollbackStore.get(sessionId)?.state ?? initialState, 'arena-map')?.document.placements)
      .toHaveLength(1)
  })
})
