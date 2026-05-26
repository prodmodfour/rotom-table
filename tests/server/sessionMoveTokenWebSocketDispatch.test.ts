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
  createMoveTokenCommandScope,
  MOVE_TOKEN_COMMAND_TYPE,
  type MoveTokenCommand,
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
import {
  createInMemorySessionSocketPeerRegistry,
} from '~~/server/utils/sessionWebSocketFanout'
import {
  createPersistedSessionSnapshot,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '~~/server/utils/sessionSnapshots'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE }

const SESSION_ID = parseSessionId('session_socketmove01')
const OTHER_SESSION_ID = parseSessionId('session_socketmove02')
const JOIN_CODE = parseJoinCode('MVN234')
const OTHER_JOIN_CODE = parseJoinCode('MVN235')
const GM_KEY = parseGmKey('gmkey_socketmoveprimary000001x')
const OTHER_GM_KEY = parseGmKey('gmkey_socketmovesecondary0002x')
const GM_CLIENT_ID = parseClientId('client_socketgm1')
const OTHER_GM_CLIENT_ID = parseClientId('client_socketgm2')
const PLAYER_ID = parsePlayerId('player_socketmisty')
const PLAYER_CLIENT_ID = parseClientId('client_socketplayer')
const PLAYER_DISPLAY_NAME = parseSessionDisplayName('Misty')
const OP_ID = parseOpId('op_socketmove001')
const CREATED_AT = '2026-05-26T14:00:00.000Z'
const MOVED_AT = '2026-05-26T14:00:10.000Z'

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

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId: PLAYER_ID,
  clientId: PLAYER_CLIENT_ID,
  displayName: PLAYER_DISPLAY_NAME,
}

const tokenResource = {
  kind: 'token' as const,
  tokenId: 'token-pikachu',
  mapSlug: 'arena-map',
  sheetKind: 'pokemon' as const,
  sheetSlug: 'pikachu',
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
    },
    {
      id: 'token-eevee',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 4, y: 0, z: 1 },
      facing: 'south-west',
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
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
      controllableResources: [tokenResource],
      visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }, tokenResource],
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

const moveTokenCommandMessage = (): SessionCommandMessage<MoveTokenCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId: SESSION_ID,
  command: {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId: SESSION_ID,
    actor: gmActor,
    type: MOVE_TOKEN_COMMAND_TYPE,
    opId: OP_ID,
    baseRevision: INITIAL_SESSION_REVISION,
    scopes: [createMoveTokenCommandScope(tokenResource)],
    payload: {
      tokenId: 'token-pikachu',
      to: { x: 2, y: 0, z: 2 },
    },
    metadata: {
      traceId: 'trace-websocket-move-token',
    },
  },
})

describe('moveToken WebSocket dispatch', () => {
  it('acks the sender and broadcasts a small tokenMoved patch to same-session clients only', () => {
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

    const gmPeer = makePeer('peer-move-gm')
    const playerPeer = makePeer('peer-move-player')
    const otherPeer = makePeer('peer-move-other')
    const dependencies = {
      env: enabledEnv,
      registry,
      peers,
      store,
      moveTokenCommandDependencies: {
        operationTracker: false as const,
        writeSnapshot,
      },
    }

    handleSessionSocketOpen(gmPeer, { ...dependencies, clock: () => '2026-05-26T14:00:00.000Z' })
    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(gmHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T14:00:01.000Z',
    })
    handleSessionSocketOpen(playerPeer, { ...dependencies, clock: () => '2026-05-26T14:00:02.000Z' })
    handleSessionSocketMessage(playerPeer, { text: () => JSON.stringify(playerHello()) }, {
      ...dependencies,
      clock: () => '2026-05-26T14:00:03.000Z',
    })
    handleSessionSocketOpen(otherPeer, { ...dependencies, clock: () => '2026-05-26T14:00:04.000Z' })
    handleSessionSocketMessage(otherPeer, {
      text: () => JSON.stringify(gmHello(OTHER_SESSION_ID, OTHER_GM_KEY, OTHER_GM_CLIENT_ID)),
    }, {
      ...dependencies,
      clock: () => '2026-05-26T14:00:05.000Z',
    })

    gmPeer.sent.length = 0
    playerPeer.sent.length = 0
    otherPeer.sent.length = 0

    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(moveTokenCommandMessage()) }, {
      ...dependencies,
      clock: () => MOVED_AT,
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
        commandType: MOVE_TOKEN_COMMAND_TYPE,
        currentRevision: parseSessionRevision(1),
        opId: OP_ID,
        event: {
          eventType: 'tokenMoved',
          revision: parseSessionRevision(1),
          payload: {
            tokenId: 'token-pikachu',
            mapSlug: 'arena-map',
            from: { x: 1, y: 0, z: 1 },
            to: { x: 2, y: 0, z: 2 },
          },
        },
        metadata: {
          serverProcessedAt: MOVED_AT,
          traceId: 'trace-websocket-move-token',
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
        eventType: 'tokenMoved',
        commandType: MOVE_TOKEN_COMMAND_TYPE,
        opId: OP_ID,
        actor: gmActor,
        revision: parseSessionRevision(1),
        payload: {
          tokenId: 'token-pikachu',
          mapSlug: 'arena-map',
          from: { x: 1, y: 0, z: 1 },
          to: { x: 2, y: 0, z: 2 },
          sheetKind: 'pokemon',
          sheetSlug: 'pikachu',
        },
      },
    })
    expect(JSON.stringify(playerPatch)).not.toContain('placements')
    expect(JSON.stringify(playerPatch)).not.toContain('fieldEffects')

    expect(snapshotCalls).toHaveLength(1)
    expect(snapshotCalls[0]?.revision).toBe(parseSessionRevision(1))
    const storedState = store.get(SESSION_ID)?.state
    expect(storedState).toBeDefined()
    const storedMap = getSessionMapState(storedState!, 'arena-map')
    expect(storedMap?.revision).toBe(parseMapRevision(1))
    expect(storedMap?.document.placements.find((placement) => placement.id === 'token-pikachu')?.position)
      .toEqual({ x: 2, y: 0, z: 2 })
    expect(registry.get('peer-move-gm')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(1),
    })
    expect(registry.get('peer-move-player')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: parseSessionRevision(1),
    })
  })
})
