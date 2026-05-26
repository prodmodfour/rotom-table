import { describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
  type SessionCommandEnvelope,
} from '#shared/sessionCommands'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionClientHelloMessage,
  type SessionCommandMessage,
  type SessionHeartbeatMessage,
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
  createAuthoritativeSessionState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
} from '~~/server/utils/sessionHosting'
import {
  SESSION_SOCKET_AUTHENTICATED_STATUS,
  SESSION_SOCKET_HEARTBEAT_TIMEOUT_REASON,
  SESSION_SOCKET_POLICY_CLOSE_CODE,
  createInMemorySessionSocketRegistry,
  handleSessionSocketHeartbeatTick,
  handleSessionSocketMessage,
  handleSessionSocketOpen,
  type InMemorySessionSocketRegistry,
  type SessionSocketPeerLike,
} from '~~/server/utils/sessionWebSocketServer'
import {
  createInMemorySessionSocketPeerRegistry,
  type InMemorySessionSocketPeerRegistry,
} from '~~/server/utils/sessionWebSocketFanout'
import {
  createInMemorySessionStore,
  type InMemorySessionStore,
} from '~~/server/utils/sessionStore'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE }

const SESSION_ID = parseSessionId('session_transportA01')
const OTHER_SESSION_ID = parseSessionId('session_transportB02')
const JOIN_CODE = parseJoinCode('TRN234')
const OTHER_JOIN_CODE = parseJoinCode('TRN235')
const GM_KEY = parseGmKey('gmkey_transportprimarysecret01')
const OTHER_GM_KEY = parseGmKey('gmkey_transportsecondarysecret2')
const GM_CLIENT_ID = parseClientId('client_transportgm')
const OTHER_GM_CLIENT_ID = parseClientId('client_transportgm2')
const PLAYER_ID = parsePlayerId('player_transportmisty')
const PLAYER_CLIENT_ID = parseClientId('client_transportplayer')
const PLAYER_DISPLAY_NAME = parseSessionDisplayName('Misty')
const OTHER_PLAYER_ID = parsePlayerId('player_transportbrock')
const OTHER_PLAYER_CLIENT_ID = parseClientId('client_transportother')
const OTHER_PLAYER_DISPLAY_NAME = parseSessionDisplayName('Brock')
const OP_ID = parseOpId('op_transportmove1')
const REVISION_4 = parseSessionRevision(4)
const MAP_REVISION_2 = parseMapRevision(2)
const CREATED_AT = '2026-05-26T13:00:00.000Z'

type FakePeer = SessionSocketPeerLike & {
  readonly sent: string[]
  readonly closed: { readonly code?: number, readonly reason?: string }[]
}

interface TransportDependencies {
  readonly registry: InMemorySessionSocketRegistry
  readonly peers: InMemorySessionSocketPeerRegistry
  readonly store: InMemorySessionStore<AuthoritativeSessionState>
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
const parseLastSentJson = (peer: FakePeer): unknown => parseSentJson(peer, peer.sent.length - 1)

const createTransportDependencies = (
  state: AuthoritativeSessionState = createAuthoritativeSessionState({
    sessionId: SESSION_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
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
        controllableResources: [],
        visibleResources: [],
        updatedAt: CREATED_AT,
      },
    ],
  }),
): TransportDependencies => {
  const store = createInMemorySessionStore<AuthoritativeSessionState>()
  store.create({
    sessionId: SESSION_ID,
    joinCode: JOIN_CODE,
    gmKey: GM_KEY,
    revision: state.revision,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    state,
  })

  const otherState = createAuthoritativeSessionState({
    sessionId: OTHER_SESSION_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    players: [
      {
        playerId: OTHER_PLAYER_ID,
        displayName: OTHER_PLAYER_DISPLAY_NAME,
        joinedAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ],
    assignments: [],
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

  return {
    registry: createInMemorySessionSocketRegistry(),
    peers: createInMemorySessionSocketPeerRegistry(),
    store,
  }
}

const openAt = (peer: FakePeer, dependencies: TransportDependencies, at: string): void => {
  handleSessionSocketOpen(peer, {
    env: enabledEnv,
    registry: dependencies.registry,
    peers: dependencies.peers,
    store: dependencies.store,
    clock: () => at,
  })
}

const messageAt = (
  peer: FakePeer,
  message: unknown,
  dependencies: TransportDependencies,
  at: string,
): void => {
  const text = typeof message === 'string' ? message : JSON.stringify(message)
  handleSessionSocketMessage(peer, { text: () => text }, {
    env: enabledEnv,
    registry: dependencies.registry,
    peers: dependencies.peers,
    store: dependencies.store,
    clock: () => at,
  })
}

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

const playerHello = (
  overrides: Partial<SessionClientHelloMessage> = {},
): SessionClientHelloMessage => ({
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
  ...overrides,
})

const heartbeat = (
  overrides: Partial<SessionHeartbeatMessage<'client'>> = {},
): SessionHeartbeatMessage<'client'> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'heartbeat',
  direction: 'client',
  sessionId: SESSION_ID,
  heartbeat: 'ping',
  nonce: 'hb-client-transport-1',
  ...overrides,
})

const commandMessage = (
  overrides: Partial<SessionCommandMessage> = {},
): SessionCommandMessage => {
  const command: SessionCommandEnvelope = {
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    sessionId: SESSION_ID,
    actor: {
      role: 'gm',
      clientId: GM_CLIENT_ID,
    },
    type: 'moveToken',
    opId: OP_ID,
    baseRevision: INITIAL_SESSION_REVISION,
    scopes: [
      {
        lane: 'token',
        resource: {
          kind: 'token',
          tokenId: 'token-transport-pikachu',
          mapSlug: 'visible-map',
        },
      },
    ],
    payload: {
      tokenId: 'token-transport-pikachu',
      position: { x: 1, y: 2, z: 0 },
    },
  }

  return {
    schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
    type: 'command',
    direction: 'client',
    sessionId: SESSION_ID,
    command,
    ...overrides,
  }
}

const authenticateGm = (
  peer: FakePeer,
  dependencies: TransportDependencies,
  connectedAt: string,
  authenticatedAt: string,
  hello: SessionClientHelloMessage = gmHello(),
): void => {
  openAt(peer, dependencies, connectedAt)
  messageAt(peer, hello, dependencies, authenticatedAt)
}

describe('session WebSocket transport integration tests', () => {
  it('authenticates GM/player hellos and isolates joined presence by session', () => {
    const dependencies = createTransportDependencies()
    const gmPeer = makePeer('peer-transport-gm')
    const playerPeer = makePeer('peer-transport-player')
    const otherSessionPeer = makePeer('peer-transport-other')

    authenticateGm(gmPeer, dependencies, '2026-05-26T13:00:00.000Z', '2026-05-26T13:00:01.000Z')

    expect(parseSentJson(gmPeer, 0)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'hello',
      direction: 'server',
      sessionId: SESSION_ID,
      actor: { role: 'gm', clientId: GM_CLIENT_ID },
      currentRevision: INITIAL_SESSION_REVISION,
      resumed: false,
    })
    expect(parseSentJson(gmPeer, 1)).toMatchObject({
      type: 'presence',
      direction: 'server',
      sessionId: SESSION_ID,
      change: 'joined',
      clients: [
        {
          clientId: GM_CLIENT_ID,
          status: 'connected',
          actor: { role: 'gm', clientId: GM_CLIENT_ID },
        },
      ],
    })

    authenticateGm(
      otherSessionPeer,
      dependencies,
      '2026-05-26T13:00:02.000Z',
      '2026-05-26T13:00:03.000Z',
      gmHello(OTHER_SESSION_ID, OTHER_GM_KEY, OTHER_GM_CLIENT_ID),
    )
    expect(gmPeer.sent).toHaveLength(2)
    expect(parseLastSentJson(otherSessionPeer)).toMatchObject({
      type: 'presence',
      sessionId: OTHER_SESSION_ID,
      clients: [
        {
          clientId: OTHER_GM_CLIENT_ID,
          status: 'connected',
          actor: { role: 'gm', clientId: OTHER_GM_CLIENT_ID },
        },
      ],
    })

    openAt(playerPeer, dependencies, '2026-05-26T13:00:04.000Z')
    messageAt(playerPeer, playerHello(), dependencies, '2026-05-26T13:00:05.000Z')

    expect(parseSentJson(playerPeer, 0)).toMatchObject({
      type: 'hello',
      direction: 'server',
      sessionId: SESSION_ID,
      actor: {
        role: 'player',
        playerId: PLAYER_ID,
        clientId: PLAYER_CLIENT_ID,
        displayName: PLAYER_DISPLAY_NAME,
      },
    })
    expect(parseLastSentJson(gmPeer)).toMatchObject({
      type: 'presence',
      sessionId: SESSION_ID,
      change: 'joined',
      clients: expect.arrayContaining([
        expect.objectContaining({ clientId: GM_CLIENT_ID, status: 'connected' }),
        expect.objectContaining({ clientId: PLAYER_CLIENT_ID, status: 'connected' }),
      ]),
    })
    expect(parseLastSentJson(playerPeer)).toMatchObject({
      type: 'presence',
      sessionId: SESSION_ID,
      clients: expect.arrayContaining([
        expect.objectContaining({ clientId: GM_CLIENT_ID, status: 'connected' }),
        expect.objectContaining({ clientId: PLAYER_CLIENT_ID, status: 'connected' }),
      ]),
    })
    expect(otherSessionPeer.sent).toHaveLength(2)
    expect(dependencies.registry.get('peer-transport-player')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      sessionId: SESSION_ID,
    })
  })

  it('answers heartbeat pings, emits server pings, and disconnects stale sockets without revision changes', () => {
    const dependencies = createTransportDependencies()
    const gmPeer = makePeer('peer-heartbeat-gm')
    const playerPeer = makePeer('peer-heartbeat-player')
    const otherSessionPeer = makePeer('peer-heartbeat-other')

    authenticateGm(gmPeer, dependencies, '2026-05-26T13:10:00.000Z', '2026-05-26T13:10:01.000Z')
    authenticateGm(
      otherSessionPeer,
      dependencies,
      '2026-05-26T13:10:02.000Z',
      '2026-05-26T13:10:03.000Z',
      gmHello(OTHER_SESSION_ID, OTHER_GM_KEY, OTHER_GM_CLIENT_ID),
    )
    openAt(playerPeer, dependencies, '2026-05-26T13:10:04.000Z')
    messageAt(playerPeer, playerHello(), dependencies, '2026-05-26T13:10:05.000Z')

    const otherSessionSentBeforeHeartbeat = otherSessionPeer.sent.length
    messageAt(playerPeer, heartbeat({ lastSeenRevision: INITIAL_SESSION_REVISION }), dependencies, '2026-05-26T13:10:20.000Z')

    expect(parseLastSentJson(playerPeer)).toEqual({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'heartbeat',
      direction: 'server',
      sessionId: SESSION_ID,
      heartbeat: 'pong',
      nonce: 'hb-client-transport-1',
      lastSeenRevision: INITIAL_SESSION_REVISION,
    })
    expect(dependencies.store.get(SESSION_ID)?.revision).toBe(INITIAL_SESSION_REVISION)
    expect(dependencies.store.get(SESSION_ID)?.state?.connectedClients).toContainEqual(expect.objectContaining({
      clientId: PLAYER_CLIENT_ID,
      status: 'connected',
      lastSeenAt: '2026-05-26T13:10:20.000Z',
      lastSeenRevision: INITIAL_SESSION_REVISION,
    }))

    const tick = handleSessionSocketHeartbeatTick(playerPeer, {
      registry: dependencies.registry,
      peers: dependencies.peers,
      store: dependencies.store,
      clock: () => '2026-05-26T13:10:46.000Z',
    })

    expect(tick.action).toBe('sent-ping')
    expect(parseLastSentJson(playerPeer)).toMatchObject({
      type: 'heartbeat',
      direction: 'server',
      sessionId: SESSION_ID,
      heartbeat: 'ping',
      nonce: `hb-peer-heartbeat-player-${Date.parse('2026-05-26T13:10:46.000Z')}`,
      lastSeenRevision: INITIAL_SESSION_REVISION,
    })

    const closed = handleSessionSocketHeartbeatTick(playerPeer, {
      registry: dependencies.registry,
      peers: dependencies.peers,
      store: dependencies.store,
      clock: () => '2026-05-26T13:11:20.000Z',
    })

    expect(closed.action).toBe('closed-stale')
    expect(playerPeer.closed).toEqual([
      {
        code: SESSION_SOCKET_POLICY_CLOSE_CODE,
        reason: SESSION_SOCKET_HEARTBEAT_TIMEOUT_REASON,
      },
    ])
    expect(dependencies.registry.get('peer-heartbeat-player')).toBeUndefined()
    expect(dependencies.peers.get('peer-heartbeat-player')).toBeUndefined()
    expect(dependencies.store.get(SESSION_ID)?.revision).toBe(INITIAL_SESSION_REVISION)
    expect(dependencies.store.get(SESSION_ID)?.state?.connectedClients).toContainEqual(expect.objectContaining({
      clientId: PLAYER_CLIENT_ID,
      status: 'disconnected',
      lastSeenAt: '2026-05-26T13:11:20.000Z',
      disconnectedAt: '2026-05-26T13:11:20.000Z',
    }))
    expect(parseLastSentJson(gmPeer)).toMatchObject({
      type: 'presence',
      sessionId: SESSION_ID,
      change: 'left',
      clients: expect.arrayContaining([
        expect.objectContaining({ clientId: PLAYER_CLIENT_ID, status: 'disconnected' }),
      ]),
    })
    expect(otherSessionPeer.sent).toHaveLength(otherSessionSentBeforeHeartbeat)
  })

  it('falls back to a filtered player snapshot on stale reconnect revisions', () => {
    const state = createAuthoritativeSessionState({
      sessionId: SESSION_ID,
      revision: REVISION_4,
      selectedMapSlug: 'hidden-map',
      maps: [
        {
          mapSlug: 'hidden-map',
          revision: MAP_REVISION_2,
          document: { gmOnly: true },
        },
        {
          mapSlug: 'visible-map',
          revision: MAP_REVISION_2,
          document: { public: true },
        },
      ],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      players: [
        {
          playerId: PLAYER_ID,
          displayName: PLAYER_DISPLAY_NAME,
          joinedAt: CREATED_AT,
          updatedAt: CREATED_AT,
        },
        {
          playerId: OTHER_PLAYER_ID,
          displayName: OTHER_PLAYER_DISPLAY_NAME,
          joinedAt: CREATED_AT,
          updatedAt: CREATED_AT,
        },
      ],
      assignments: [
        {
          playerId: PLAYER_ID,
          displayName: PLAYER_DISPLAY_NAME,
          controllableResources: [],
          visibleResources: [{ kind: 'map', mapSlug: 'visible-map' }],
          updatedAt: CREATED_AT,
        },
      ],
    })
    const dependencies = createTransportDependencies(state)
    const playerPeer = makePeer('peer-reconnect-player')

    openAt(playerPeer, dependencies, '2026-05-26T13:20:00.000Z')
    messageAt(playerPeer, playerHello({
      reconnect: true,
      lastSeenRevision: INITIAL_SESSION_REVISION,
    }), dependencies, '2026-05-26T13:20:02.000Z')

    expect(parseSentJson(playerPeer, 0)).toMatchObject({
      type: 'hello',
      direction: 'server',
      sessionId: SESSION_ID,
      currentRevision: REVISION_4,
      resumed: true,
      snapshotRequired: true,
    })
    expect(parseSentJson(playerPeer, 1)).toMatchObject({
      type: 'snapshot',
      direction: 'server',
      sessionId: SESSION_ID,
      reason: 'reconnect',
      currentRevision: REVISION_4,
      replayAvailable: false,
      snapshot: {
        revision: REVISION_4,
        selectedMapSlug: null,
        maps: [
          expect.objectContaining({
            mapSlug: 'visible-map',
            document: { public: true },
          }),
        ],
        connectedClients: [
          expect.objectContaining({
            clientId: PLAYER_CLIENT_ID,
            status: 'connected',
            lastSeenRevision: INITIAL_SESSION_REVISION,
          }),
        ],
        players: [
          expect.objectContaining({ playerId: PLAYER_ID, displayName: PLAYER_DISPLAY_NAME }),
        ],
        assignments: [
          expect.objectContaining({
            playerId: PLAYER_ID,
            visibleResources: [{ kind: 'map', mapSlug: 'visible-map' }],
          }),
        ],
      },
    })
    expect(JSON.stringify(parseSentJson(playerPeer, 1))).not.toContain('hidden-map')
    expect(JSON.stringify(parseSentJson(playerPeer, 1))).not.toContain(String(OTHER_PLAYER_ID))
    expect(parseSentJson(playerPeer, 2)).toMatchObject({ type: 'presence', change: 'joined' })
  })

  it('fails malformed text frames closed before auth without creating presence or clients', () => {
    const dependencies = createTransportDependencies()
    const gmPeer = makePeer('peer-malformed-gm')
    const malformedPeer = makePeer('peer-malformed')

    authenticateGm(gmPeer, dependencies, '2026-05-26T13:30:00.000Z', '2026-05-26T13:30:01.000Z')
    const gmSentBeforeMalformedPeer = gmPeer.sent.length
    openAt(malformedPeer, dependencies, '2026-05-26T13:30:02.000Z')
    messageAt(malformedPeer, '{not-json', dependencies, '2026-05-26T13:30:03.000Z')

    expect(malformedPeer.closed).toEqual([
      {
        code: SESSION_SOCKET_POLICY_CLOSE_CODE,
        reason: 'Session WebSocket messages must be valid JSON.',
      },
    ])
    expect(parseSentJson(malformedPeer)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'error',
      direction: 'server',
      code: 'malformed-message',
      message: 'Session WebSocket messages must be valid JSON.',
      retryable: false,
    })
    expect(dependencies.registry.get('peer-malformed')).toBeUndefined()
    expect(dependencies.peers.get('peer-malformed')).toBeUndefined()
    expect(dependencies.store.get(SESSION_ID)?.state?.connectedClients).toEqual([
      expect.objectContaining({ clientId: GM_CLIENT_ID, status: 'connected' }),
    ])
    expect(gmPeer.sent).toHaveLength(gmSentBeforeMalformedPeer)
  })

  it('rejects authenticated cross-session frames without leaking errors to the other session', () => {
    const dependencies = createTransportDependencies()
    const gmPeer = makePeer('peer-cross-session-gm')
    const otherSessionPeer = makePeer('peer-cross-session-other')

    authenticateGm(gmPeer, dependencies, '2026-05-26T13:40:00.000Z', '2026-05-26T13:40:01.000Z')
    authenticateGm(
      otherSessionPeer,
      dependencies,
      '2026-05-26T13:40:02.000Z',
      '2026-05-26T13:40:03.000Z',
      gmHello(OTHER_SESSION_ID, OTHER_GM_KEY, OTHER_GM_CLIENT_ID),
    )
    const otherSessionSentBeforeCrossSessionCommand = otherSessionPeer.sent.length

    messageAt(gmPeer, commandMessage({ sessionId: OTHER_SESSION_ID }), dependencies, '2026-05-26T13:40:05.000Z')

    expect(gmPeer.closed).toEqual([
      {
        code: SESSION_SOCKET_POLICY_CLOSE_CODE,
        reason: 'Session WebSocket command session does not match the authenticated socket.',
      },
    ])
    expect(parseLastSentJson(gmPeer)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'error',
      direction: 'server',
      sessionId: SESSION_ID,
      code: 'unauthorized',
      currentRevision: INITIAL_SESSION_REVISION,
      retryable: false,
    })
    expect(dependencies.registry.get('peer-cross-session-gm')).toBeUndefined()
    expect(dependencies.store.get(SESSION_ID)?.state?.connectedClients).toContainEqual(expect.objectContaining({
      clientId: GM_CLIENT_ID,
      status: 'disconnected',
      disconnectedAt: '2026-05-26T13:40:05.000Z',
    }))
    expect(dependencies.registry.get('peer-cross-session-other')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      sessionId: OTHER_SESSION_ID,
    })
    expect(dependencies.store.get(OTHER_SESSION_ID)?.state?.connectedClients).toEqual([
      expect.objectContaining({ clientId: OTHER_GM_CLIENT_ID, status: 'connected' }),
    ])
    expect(otherSessionPeer.sent).toHaveLength(otherSessionSentBeforeCrossSessionCommand)
  })
})
