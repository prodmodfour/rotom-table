import { describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
} from '#shared/sessionCommands'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionClientHelloMessage,
  type SessionCommandMessage,
} from '#shared/sessionMessages'
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
  INITIAL_SESSION_REVISION,
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
  DELETE_TOKEN_COMMAND_TYPE,
  SPAWN_TOKEN_COMMAND_TYPE,
  createDeleteTokenCommandScope,
  createSpawnTokenCommandScope,
  type DeleteTokenCommand,
  type SpawnTokenCommand,
} from '#shared/sessionTokenCommands'
import type { TabletopMapV2 } from '~/types/map'
import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
} from '~~/server/utils/sessionHosting'
import {
  SESSION_SOCKET_AUTHENTICATED_STATUS,
  createInMemorySessionSocketRegistry,
  handleSessionSocketMessage,
  handleSessionSocketOpen,
  type SessionSocketPeerLike,
} from '~~/server/utils/sessionWebSocketServer'
import { createInMemorySessionSocketPeerRegistry } from '~~/server/utils/sessionWebSocketFanout'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE }
const SESSION_ID = parseSessionId('session_socketspawn1')
const JOIN_CODE = parseJoinCode('SPN234')
const GM_KEY = parseGmKey('gmkey_socketspawnprimary00001x')
const GM_CLIENT_ID = parseClientId('client_socketspngm')
const PLAYER_ID = parsePlayerId('player_socketspn')
const PLAYER_CLIENT_ID = parseClientId('client_socketspnpl')
const PLAYER_DISPLAY_NAME = parseSessionDisplayName('Brock')
const CREATED_AT = '2026-05-26T15:00:00.000Z'
const SPAWNED_AT = '2026-05-26T15:00:10.000Z'
const DELETED_AT = '2026-05-26T15:00:20.000Z'

const gmActor = {
  role: 'gm' as const,
  clientId: GM_CLIENT_ID,
}

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId: PLAYER_ID,
  clientId: PLAYER_CLIENT_ID,
  displayName: PLAYER_DISPLAY_NAME,
}

const spawnResource = {
  kind: 'token' as const,
  tokenId: 'token-bulbasaur',
  mapSlug: 'arena-map',
  sheetKind: 'pokemon' as const,
  sheetSlug: 'bulbasaur',
}

const deleteResource = {
  kind: 'token' as const,
  tokenId: 'token-pikachu',
  mapSlug: 'arena-map',
  sheetKind: 'pokemon' as const,
  sheetSlug: 'pikachu',
}

type FakePeer = SessionSocketPeerLike & {
  readonly sent: string[]
  readonly closed: { readonly code?: number, readonly reason?: string }[]
}

const makePeer = (id: string): FakePeer => {
  const sent: string[] = []
  const closed: { code?: number, reason?: string }[] = []

  return {
    id,
    sent,
    closed,
    send(data: unknown) {
      sent.push(String(data))
      return undefined
    },
    close(code?: number, reason?: string) {
      closed.push({ code, reason })
      return undefined
    },
  }
}

const parseSentJson = (peer: FakePeer, index = 0): unknown => JSON.parse(peer.sent[index] ?? 'null')

const createMap = (): TabletopMapV2 => ({
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
})

const createState = (): AuthoritativeSessionState<TabletopMapV2> => createAuthoritativeSessionState<TabletopMapV2>({
  sessionId: SESSION_ID,
  revision: INITIAL_SESSION_REVISION,
  selectedMapSlug: 'arena-map',
  maps: [
    createAuthoritativeSessionMapState({
      mapSlug: 'arena-map',
      revision: parseMapRevision(0),
      document: createMap(),
    }),
  ],
  players: [
    {
      playerId: PLAYER_ID,
      displayName: PLAYER_DISPLAY_NAME,
      joinedAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  ],
  assignments: [
    {
      playerId: PLAYER_ID,
      displayName: PLAYER_DISPLAY_NAME,
      controllableResources: [deleteResource],
      visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }, deleteResource],
      updatedAt: CREATED_AT,
      updatedByClientId: GM_CLIENT_ID,
    },
  ],
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
})

const gmHello = (): SessionClientHelloMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'client',
  sessionId: SESSION_ID,
  identity: {
    role: 'gm',
    clientId: GM_CLIENT_ID,
    gmKey: GM_KEY,
  },
  reconnect: false,
})

const playerHello = (): SessionClientHelloMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'client',
  sessionId: SESSION_ID,
  identity: {
    role: 'player',
    clientId: PLAYER_CLIENT_ID,
    playerId: PLAYER_ID,
    displayName: PLAYER_DISPLAY_NAME,
  },
  reconnect: false,
})

const spawnTokenCommandMessage = (): SessionCommandMessage<SpawnTokenCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId: SESSION_ID,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId: SESSION_ID,
    actor: gmActor,
    type: SPAWN_TOKEN_COMMAND_TYPE,
    opId: parseOpId('op_socketspawn01'),
    baseRevision: INITIAL_SESSION_REVISION,
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
      traceId: 'trace-websocket-spawn-token',
    },
  },
})

const deleteTokenCommandMessage = (): SessionCommandMessage<DeleteTokenCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId: SESSION_ID,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId: SESSION_ID,
    actor: gmActor,
    type: DELETE_TOKEN_COMMAND_TYPE,
    opId: parseOpId('op_socketdelete01'),
    baseRevision: parseSessionRevision(1),
    scopes: [createDeleteTokenCommandScope(deleteResource)],
    payload: {
      tokenId: 'token-pikachu',
    },
    metadata: {
      traceId: 'trace-websocket-delete-token',
    },
  },
})

describe('spawnToken/deleteToken WebSocket dispatch', () => {
  it('acks the GM and broadcasts small tokenSpawned/tokenDeleted patches to same-session clients', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peers = createInMemorySessionSocketPeerRegistry()
    const store = createInMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>()
    const state = createState()
    store.create({
      sessionId: SESSION_ID,
      joinCode: JOIN_CODE,
      gmKey: GM_KEY,
      revision: state.revision,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      state,
    })
    const snapshotCalls: AuthoritativeSessionState<TabletopMapV2>[] = []
    const writeSnapshot = (
      nextState: AuthoritativeSessionState<TabletopMapV2>,
      options?: WriteSessionSnapshotOptions<TabletopMapV2>,
    ): WriteSessionSnapshotResult<TabletopMapV2> => {
      snapshotCalls.push(nextState)
      return {
        directoryPath: '/tmp/rotom-session',
        filePath: '/tmp/rotom-session/snapshot.json',
        snapshot: createPersistedSessionSnapshot(nextState, options),
        bytesWritten: 1,
      }
    }

    const gmPeer = makePeer('peer-spawn-gm')
    const playerPeer = makePeer('peer-spawn-player')
    const dependencies = {
      env: enabledEnv,
      registry,
      peers,
      store,
      spawnTokenCommandDependencies: {
        operationTracker: false as const,
        writeSnapshot,
      },
      deleteTokenCommandDependencies: {
        operationTracker: false as const,
        writeSnapshot,
      },
    }

    handleSessionSocketOpen(gmPeer, { ...dependencies, clock: () => '2026-05-26T15:00:00.000Z' })
    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(gmHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T15:00:01.000Z',
    })
    handleSessionSocketOpen(playerPeer, { ...dependencies, clock: () => '2026-05-26T15:00:02.000Z' })
    handleSessionSocketMessage(playerPeer, { text: () => JSON.stringify(playerHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T15:00:03.000Z',
    })

    gmPeer.sent.length = 0
    playerPeer.sent.length = 0

    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(spawnTokenCommandMessage()) }, {
      ...dependencies,
      clock: () => SPAWNED_AT,
    })

    expect(gmPeer.closed).toEqual([])
    expect(playerPeer.closed).toEqual([])
    expect(gmPeer.sent).toHaveLength(2)
    expect(playerPeer.sent).toHaveLength(1)
    expect(parseSentJson(gmPeer, 0)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandAck',
      direction: 'server',
      sessionId: SESSION_ID,
      result: {
        status: 'accepted',
        commandType: SPAWN_TOKEN_COMMAND_TYPE,
        currentRevision: parseSessionRevision(1),
        event: {
          eventType: 'tokenSpawned',
          payload: {
            tokenId: 'token-bulbasaur',
            mapSlug: 'arena-map',
            placement: {
              id: 'token-bulbasaur',
              sheetKind: 'pokemon',
              sheetSlug: 'bulbasaur',
              position: { x: 3, y: 0, z: 3 },
            },
          },
        },
        metadata: {
          serverProcessedAt: SPAWNED_AT,
          traceId: 'trace-websocket-spawn-token',
        },
      },
    })
    const spawnPatch = parseSentJson(playerPeer, 0)
    expect(spawnPatch).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'patch',
      direction: 'server',
      sessionId: SESSION_ID,
      event: {
        eventType: 'tokenSpawned',
        commandType: SPAWN_TOKEN_COMMAND_TYPE,
        revision: parseSessionRevision(1),
        actor: gmActor,
        payload: {
          tokenId: 'token-bulbasaur',
          mapSlug: 'arena-map',
          position: { x: 3, y: 0, z: 3 },
        },
      },
    })
    expect(JSON.stringify(spawnPatch)).not.toContain('fieldEffects')

    gmPeer.sent.length = 0
    playerPeer.sent.length = 0

    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(deleteTokenCommandMessage()) }, {
      ...dependencies,
      clock: () => DELETED_AT,
    })

    expect(gmPeer.sent).toHaveLength(2)
    expect(playerPeer.sent).toHaveLength(1)
    expect(parseSentJson(gmPeer, 0)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandAck',
      direction: 'server',
      sessionId: SESSION_ID,
      result: {
        status: 'accepted',
        commandType: DELETE_TOKEN_COMMAND_TYPE,
        currentRevision: parseSessionRevision(2),
        event: {
          eventType: 'tokenDeleted',
          payload: {
            tokenId: 'token-pikachu',
            mapSlug: 'arena-map',
            clearedActiveInitiative: true,
          },
        },
        metadata: {
          serverProcessedAt: DELETED_AT,
          traceId: 'trace-websocket-delete-token',
        },
      },
    })
    const deletePatch = parseSentJson(playerPeer, 0)
    expect(deletePatch).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'patch',
      direction: 'server',
      sessionId: SESSION_ID,
      event: {
        eventType: 'tokenDeleted',
        commandType: DELETE_TOKEN_COMMAND_TYPE,
        revision: parseSessionRevision(2),
        actor: gmActor,
        payload: {
          tokenId: 'token-pikachu',
          mapSlug: 'arena-map',
          position: { x: 1, y: 0, z: 1 },
          clearedActiveInitiative: true,
        },
      },
    })
    expect(JSON.stringify(deletePatch)).not.toContain('fieldEffects')

    expect(snapshotCalls.map((entry) => entry.revision)).toEqual([
      parseSessionRevision(1),
      parseSessionRevision(2),
    ])
    const storedState = store.get(SESSION_ID)?.state
    expect(storedState).toBeDefined()
    const storedMap = getSessionMapState(storedState!, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(2))
    expect(storedMap?.document.placements.map((placement) => placement.id)).toEqual(['token-bulbasaur'])
    expect(storedMap?.document.initiative?.activeId).toBeNull()
    expect(registry.get('peer-spawn-gm')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(2),
    })
    expect(registry.get('peer-spawn-player')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(2),
    })
  })
})
