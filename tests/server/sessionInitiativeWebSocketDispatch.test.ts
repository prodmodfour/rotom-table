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
  NEXT_INITIATIVE_COMMAND_TYPE,
  createInitiativeCommandScope,
  type NextInitiativeCommand,
} from '#shared/sessionInitiativeCommands'
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

const SESSION_ID = parseSessionId('session_socketinit001')
const OTHER_SESSION_ID = parseSessionId('session_socketinit002')
const JOIN_CODE = parseJoinCode('ABC234')
const OTHER_JOIN_CODE = parseJoinCode('ABC235')
const GM_KEY = parseGmKey('gmkey_socketinitiative0000001xx')
const OTHER_GM_KEY = parseGmKey('gmkey_socketinitiative0000002xx')
const GM_CLIENT_ID = parseClientId('client_socketinitgm')
const OTHER_GM_CLIENT_ID = parseClientId('client_socketinitog')
const PLAYER_ID = parsePlayerId('player_socketinit01')
const PLAYER_CLIENT_ID = parseClientId('client_socketinitpl')
const PLAYER_DISPLAY_NAME = parseSessionDisplayName('Brock')
const OP_ID = parseOpId('op_socketinit001')
const CREATED_AT = '2026-05-26T18:30:00.000Z'
const MODIFIED_AT = '2026-05-26T18:30:10.000Z'

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

const gmActor = {
  role: 'gm' as const,
  clientId: GM_CLIENT_ID,
}

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
      initiative: 20,
    },
    {
      id: 'token-bulbasaur',
      sheetKind: 'pokemon',
      sheetSlug: 'bulbasaur',
      position: { x: 2, y: 0, z: 1 },
      facing: 'south-east',
      initiative: 12,
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
      controllableResources: [
        {
          kind: 'token',
          tokenId: 'token-pikachu',
          mapSlug: 'arena-map',
          sheetKind: 'pokemon',
          sheetSlug: 'pikachu',
        },
      ],
      visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }],
      updatedAt: CREATED_AT,
      updatedByClientId: GM_CLIENT_ID,
    },
  ],
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
})

const gmHello = (
  sessionId = SESSION_ID,
  gmKey = GM_KEY,
  clientId = GM_CLIENT_ID,
): SessionClientHelloMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'client',
  sessionId,
  identity: {
    role: 'gm',
    clientId,
    gmKey,
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

const nextInitiativeCommandMessage = (): SessionCommandMessage<NextInitiativeCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId: SESSION_ID,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId: SESSION_ID,
    actor: gmActor,
    type: NEXT_INITIATIVE_COMMAND_TYPE,
    opId: OP_ID,
    baseRevision: INITIAL_SESSION_REVISION,
    scopes: [createInitiativeCommandScope('arena-map')],
    payload: {
      mapSlug: 'arena-map',
      orderIds: ['token-pikachu', 'token-bulbasaur'],
      activeId: 'token-pikachu',
      round: 1,
    },
    metadata: {
      traceId: 'trace-websocket-initiative',
    },
  },
})

describe('initiative WebSocket dispatch', () => {
  it('acks the sender and broadcasts a small initiativeUpdated patch to same-session clients only', () => {
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
    const otherState = createAuthoritativeSessionState<TabletopMapV2>({
      sessionId: OTHER_SESSION_ID,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })
    store.create({
      sessionId: OTHER_SESSION_ID,
      joinCode: OTHER_JOIN_CODE,
      gmKey: OTHER_GM_KEY,
      revision: otherState.revision,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      state: otherState,
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

    const gmPeer = makePeer('peer-init-gm')
    const playerPeer = makePeer('peer-init-player')
    const otherPeer = makePeer('peer-init-other')
    const dependencies = {
      env: enabledEnv,
      registry,
      peers,
      store,
      initiativeCommandDependencies: {
        operationTracker: false as const,
        writeSnapshot,
      },
    }

    handleSessionSocketOpen(gmPeer, { ...dependencies, clock: () => '2026-05-26T18:30:00.000Z' })
    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(gmHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T18:30:01.000Z',
    })
    handleSessionSocketOpen(playerPeer, { ...dependencies, clock: () => '2026-05-26T18:30:02.000Z' })
    handleSessionSocketMessage(playerPeer, { text: () => JSON.stringify(playerHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T18:30:03.000Z',
    })
    handleSessionSocketOpen(otherPeer, { ...dependencies, clock: () => '2026-05-26T18:30:04.000Z' })
    handleSessionSocketMessage(otherPeer, {
      text: () => JSON.stringify(gmHello(OTHER_SESSION_ID, OTHER_GM_KEY, OTHER_GM_CLIENT_ID)),
    }, {
      ...dependencies,
      clock: () => '2026-05-26T18:30:05.000Z',
    })

    gmPeer.sent.length = 0
    playerPeer.sent.length = 0
    otherPeer.sent.length = 0

    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(nextInitiativeCommandMessage()) }, {
      ...dependencies,
      clock: () => MODIFIED_AT,
    })

    expect(gmPeer.closed).toEqual([])
    expect(playerPeer.closed).toEqual([])
    expect(otherPeer.closed).toEqual([])
    expect(gmPeer.sent).toHaveLength(2)
    expect(playerPeer.sent).toHaveLength(1)
    expect(otherPeer.sent).toEqual([])

    expect(parseSentJson(gmPeer, 0)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandAck',
      direction: 'server',
      sessionId: SESSION_ID,
      result: {
        status: 'accepted',
        accepted: true,
        commandType: NEXT_INITIATIVE_COMMAND_TYPE,
        currentRevision: parseSessionRevision(1),
        opId: OP_ID,
        event: {
          eventType: 'initiativeUpdated',
          revision: parseSessionRevision(1),
          payload: {
            mapSlug: 'arena-map',
            command: NEXT_INITIATIVE_COMMAND_TYPE,
            previous: { activeId: 'token-pikachu', round: 1 },
            current: { activeId: 'token-bulbasaur', round: 1 },
          },
        },
        metadata: {
          serverProcessedAt: MODIFIED_AT,
          traceId: 'trace-websocket-initiative',
        },
      },
    })

    const gmPatch = parseSentJson(gmPeer, 1)
    const playerPatch = parseSentJson(playerPeer, 0)
    expect(gmPatch).toEqual(playerPatch)
    expect(playerPatch).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'patch',
      direction: 'server',
      sessionId: SESSION_ID,
      event: {
        eventType: 'initiativeUpdated',
        commandType: NEXT_INITIATIVE_COMMAND_TYPE,
        opId: OP_ID,
        actor: gmActor,
        revision: parseSessionRevision(1),
        payload: {
          mapSlug: 'arena-map',
          previous: { activeId: 'token-pikachu', round: 1 },
          current: { activeId: 'token-bulbasaur', round: 1 },
          changedTokenIds: [],
        },
      },
    })
    expect(JSON.stringify(playerPatch)).not.toContain('voxels')
    expect(JSON.stringify(playerPatch)).not.toContain('placements')

    expect(snapshotCalls).toHaveLength(1)
    expect(snapshotCalls[0]?.revision).toBe(parseSessionRevision(1))
    const storedState = store.get(SESSION_ID)?.state
    expect(storedState).toBeDefined()
    const storedMap = getSessionMapState(storedState!, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.initiative).toEqual({ activeId: 'token-bulbasaur', round: 1 })
    expect(registry.get('peer-init-gm')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(1),
    })
    expect(registry.get('peer-init-player')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(1),
    })
  })
})
