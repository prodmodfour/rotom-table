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
import { INITIAL_SESSION_REVISION, parseMapRevision, parseSessionRevision } from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import socketRoute from '~~/server/api/sessions/socket'
import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
} from '~~/server/utils/sessionHosting'
import {
  SESSION_SOCKET_AUTHENTICATED_STATUS,
  SESSION_SOCKET_DISABLED_MESSAGE,
  SESSION_SOCKET_DISABLED_STATUS,
  SESSION_SOCKET_HEARTBEAT_INTERVAL_MS,
  SESSION_SOCKET_HEARTBEAT_TIMEOUT_MS,
  SESSION_SOCKET_HEARTBEAT_TIMEOUT_REASON,
  SESSION_SOCKET_PENDING_HELLO_STATUS,
  SESSION_SOCKET_POLICY_CLOSE_CODE,
  SESSION_SOCKET_REPLAY_AVAILABLE,
  createInMemorySessionSocketRegistry,
  createSessionReconnectSnapshotMessage,
  createSessionReconnectSnapshotState,
  handleSessionSocketClose,
  handleSessionSocketError,
  handleSessionSocketHeartbeatTick,
  handleSessionSocketMessage,
  handleSessionSocketOpen,
  handleSessionSocketUpgrade,
  isSessionSocketConnectionStale,
  resolveSessionSocketReconnectDecision,
  type SessionSocketPeerLike,
} from '~~/server/utils/sessionWebSocketServer'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

type FakePeer = SessionSocketPeerLike & {
  readonly sent: unknown[]
  readonly closed: { readonly code?: number, readonly reason?: string }[]
}

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE }
const disabledEnv = { [SESSION_HOST_ENABLE_ENV]: '' }

const SESSION_ID = parseSessionId('session_abcdefghijkl')
const JOIN_CODE = parseJoinCode('ABC234')
const GM_KEY = parseGmKey('gmkey_abcdefghijklmnopqrstuvwxyz')
const OTHER_GM_KEY = parseGmKey('gmkey_zyxwvutsrqponmlkjihgfedcba')
const GM_CLIENT_ID = parseClientId('client_gmclient01')
const PLAYER_ID = parsePlayerId('player_misty001')
const PLAYER_CLIENT_ID = parseClientId('client_player01')
const PLAYER_DISPLAY_NAME = parseSessionDisplayName('Misty')
const REVISION_3 = parseSessionRevision(3)
const MAP_REVISION_1 = parseMapRevision(1)
const OP_ID = parseOpId('op_socketvalid001')
const CREATED_AT = '2026-05-26T09:00:00.000Z'

const makeRequest = (): { url: string, headers: Headers, context: Record<string, unknown> } => ({
  url: 'ws://localhost:3000/api/sessions/socket',
  headers: new Headers({ host: 'localhost:3000' }),
  context: {},
})

const makePeer = (id = 'peer-a'): FakePeer => {
  const sent: unknown[] = []
  const closed: { code?: number, reason?: string }[] = []

  return {
    id,
    sent,
    closed,
    send(data: unknown) {
      sent.push(data)
      return undefined
    },
    close(code?: number, reason?: string) {
      closed.push({ code, reason })
      return undefined
    },
  }
}

const createStoreWithSession = () => {
  const store = createInMemorySessionStore<AuthoritativeSessionState>()
  const state = createAuthoritativeSessionState({
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
  })

  store.create({
    sessionId: SESSION_ID,
    joinCode: JOIN_CODE,
    gmKey: GM_KEY,
    revision: state.revision,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    state,
  })

  return { store, state }
}

const gmHello = (gmKey = GM_KEY): SessionClientHelloMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'client',
  sessionId: SESSION_ID,
  identity: {
    role: 'gm',
    clientId: GM_CLIENT_ID,
    gmKey,
  },
  reconnect: false,
})

const playerHello = (overrides: Partial<SessionClientHelloMessage> = {}): SessionClientHelloMessage => ({
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

const clientHeartbeat = (
  overrides: Partial<SessionHeartbeatMessage<'client'>> = {},
): SessionHeartbeatMessage<'client'> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'heartbeat',
  direction: 'client',
  sessionId: SESSION_ID,
  heartbeat: 'ping',
  nonce: 'heartbeat-001',
  ...overrides,
})

const gmCommandMessage = (overrides: {
  readonly message?: Partial<SessionCommandMessage>
  readonly command?: Partial<SessionCommandEnvelope>
} = {}): SessionCommandMessage => {
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
          tokenId: 'token-pikachu',
          mapSlug: 'viridian-gym',
        },
      },
    ],
    payload: {
      tokenId: 'token-pikachu',
      position: { x: 1, y: 2, z: 0 },
    },
    ...overrides.command,
  }

  return {
    schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
    type: 'command',
    direction: 'client',
    sessionId: SESSION_ID,
    command,
    ...overrides.message,
  }
}

const parseSentJson = (peer: FakePeer, index = 0): unknown => JSON.parse(String(peer.sent[index]))

describe('session WebSocket route skeleton', () => {
  it('enables Nitro WebSocket hooks at the session socket route', () => {
    const hooks = (socketRoute as unknown as { __websocket__?: Record<string, unknown> }).__websocket__

    expect(hooks?.upgrade).toBe(handleSessionSocketUpgrade)
    expect(hooks?.open).toBeTypeOf('function')
    expect(hooks?.message).toBeTypeOf('function')
    expect(hooks?.close).toBeTypeOf('function')
    expect(hooks?.error).toBe(handleSessionSocketError)
  })

  it('fails WebSocket upgrades closed unless the explicit session-host flag is set', async () => {
    const disabledResponse = handleSessionSocketUpgrade(makeRequest(), { env: disabledEnv })
    expect(disabledResponse).toBeInstanceOf(Response)
    expect(disabledResponse?.status).toBe(SESSION_SOCKET_DISABLED_STATUS)
    expect(await disabledResponse?.text()).toBe(SESSION_SOCKET_DISABLED_MESSAGE)

    expect(handleSessionSocketUpgrade(makeRequest(), { env: enabledEnv })).toBeUndefined()
  })

  it('records enabled raw connects as pending hello and removes them on disconnect', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peer = makePeer('peer-connected')

    const connection = handleSessionSocketOpen(peer, {
      env: enabledEnv,
      registry,
      clock: () => '2026-05-26T10:00:00.000Z',
    })

    expect(connection).toEqual({
      peerId: 'peer-connected',
      status: SESSION_SOCKET_PENDING_HELLO_STATUS,
      connectedAt: '2026-05-26T10:00:00.000Z',
      lastSeenAt: '2026-05-26T10:00:00.000Z',
    })
    expect(registry.size).toBe(1)
    expect(registry.get('peer-connected')).toEqual(connection)

    const closed = handleSessionSocketClose(peer, { code: 1000, reason: 'done' }, {
      registry,
      clock: () => '2026-05-26T10:01:00.000Z',
    })

    expect(closed).toEqual({
      ...connection,
      closedAt: '2026-05-26T10:01:00.000Z',
      closeCode: 1000,
      closeReason: 'done',
    })
    expect(registry.size).toBe(0)
    expect(registry.get('peer-connected')).toBeUndefined()
  })

  it('closes without registering if the open hook runs while hosting is disabled', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peer = makePeer('peer-disabled')

    expect(handleSessionSocketOpen(peer, { env: disabledEnv, registry })).toBeUndefined()
    expect(registry.size).toBe(0)
    expect(peer.closed).toEqual([
      {
        code: SESSION_SOCKET_POLICY_CLOSE_CODE,
        reason: SESSION_SOCKET_DISABLED_MESSAGE,
      },
    ])
  })

  it('authenticates a GM hello and records the connected client in authoritative state', () => {
    const registry = createInMemorySessionSocketRegistry()
    const { store } = createStoreWithSession()
    const peer = makePeer('peer-gm')
    handleSessionSocketOpen(peer, {
      env: enabledEnv,
      registry,
      clock: () => '2026-05-26T10:00:00.000Z',
    })

    handleSessionSocketMessage(peer, { text: () => JSON.stringify(gmHello()) }, {
      registry,
      store,
      clock: () => '2026-05-26T10:00:05.000Z',
    })

    expect(peer.closed).toEqual([])
    expect(parseSentJson(peer)).toEqual({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'hello',
      direction: 'server',
      sessionId: SESSION_ID,
      actor: {
        role: 'gm',
        clientId: GM_CLIENT_ID,
      },
      currentRevision: INITIAL_SESSION_REVISION,
      resumed: false,
      heartbeat: {
        intervalMs: SESSION_SOCKET_HEARTBEAT_INTERVAL_MS,
        timeoutMs: SESSION_SOCKET_HEARTBEAT_TIMEOUT_MS,
      },
    })
    expect(registry.get('peer-gm')).toMatchObject({
      peerId: 'peer-gm',
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      sessionId: SESSION_ID,
      actor: {
        role: 'gm',
        clientId: GM_CLIENT_ID,
      },
      authenticatedAt: '2026-05-26T10:00:05.000Z',
      currentRevision: INITIAL_SESSION_REVISION,
    })
    expect(store.get(SESSION_ID)?.state?.connectedClients).toEqual([
      {
        clientId: GM_CLIENT_ID,
        actor: {
          role: 'gm',
          clientId: GM_CLIENT_ID,
        },
        status: 'connected',
        connectedAt: '2026-05-26T10:00:00.000Z',
        lastSeenAt: '2026-05-26T10:00:05.000Z',
      },
    ])
  })

  it('authenticates a player hello with display-name identity and last seen revision', () => {
    const registry = createInMemorySessionSocketRegistry()
    const { store } = createStoreWithSession()
    const peer = makePeer('peer-player')
    handleSessionSocketOpen(peer, {
      env: enabledEnv,
      registry,
      clock: () => '2026-05-26T10:10:00.000Z',
    })

    handleSessionSocketMessage(peer, {
      text: () => JSON.stringify(playerHello({
        reconnect: true,
        lastSeenRevision: INITIAL_SESSION_REVISION,
      })),
    }, {
      registry,
      store,
      clock: () => '2026-05-26T10:10:03.000Z',
    })

    expect(parseSentJson(peer)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'hello',
      direction: 'server',
      sessionId: SESSION_ID,
      actor: {
        role: 'player',
        playerId: PLAYER_ID,
        clientId: PLAYER_CLIENT_ID,
        displayName: PLAYER_DISPLAY_NAME,
      },
      currentRevision: INITIAL_SESSION_REVISION,
      resumed: true,
      snapshotRequired: false,
      replayFromRevision: INITIAL_SESSION_REVISION,
    })
    expect(peer.sent).toHaveLength(1)
    expect(registry.get('peer-player')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      sessionId: SESSION_ID,
      lastSeenRevision: INITIAL_SESSION_REVISION,
    })
    expect(store.get(SESSION_ID)?.state?.connectedClients).toEqual([
      {
        clientId: PLAYER_CLIENT_ID,
        actor: {
          role: 'player',
          playerId: PLAYER_ID,
          clientId: PLAYER_CLIENT_ID,
          displayName: PLAYER_DISPLAY_NAME,
        },
        status: 'connected',
        connectedAt: '2026-05-26T10:10:00.000Z',
        lastSeenAt: '2026-05-26T10:10:03.000Z',
        lastSeenRevision: INITIAL_SESSION_REVISION,
      },
    ])
  })

  it('decides when reconnect handshakes require snapshot fallback', () => {
    expect(resolveSessionSocketReconnectDecision({
      reconnect: false,
      currentRevision: REVISION_3,
    })).toEqual({
      reconnect: false,
      currentRevision: REVISION_3,
      snapshotRequired: false,
      replayAvailable: SESSION_SOCKET_REPLAY_AVAILABLE,
      reason: 'initial-connection',
    })

    expect(resolveSessionSocketReconnectDecision({
      reconnect: true,
      currentRevision: REVISION_3,
      lastSeenRevision: REVISION_3,
    })).toEqual({
      reconnect: true,
      currentRevision: REVISION_3,
      lastSeenRevision: REVISION_3,
      snapshotRequired: false,
      replayAvailable: SESSION_SOCKET_REPLAY_AVAILABLE,
      reason: 'current-revision',
    })

    expect(resolveSessionSocketReconnectDecision({
      reconnect: true,
      currentRevision: REVISION_3,
      lastSeenRevision: INITIAL_SESSION_REVISION,
    })).toEqual({
      reconnect: true,
      currentRevision: REVISION_3,
      lastSeenRevision: INITIAL_SESSION_REVISION,
      snapshotRequired: true,
      replayAvailable: SESSION_SOCKET_REPLAY_AVAILABLE,
      reason: 'revision-gap-replay-unavailable',
    })

    expect(resolveSessionSocketReconnectDecision({
      reconnect: true,
      currentRevision: INITIAL_SESSION_REVISION,
      lastSeenRevision: REVISION_3,
    })).toMatchObject({
      snapshotRequired: true,
      reason: 'client-revision-ahead',
    })
  })

  it('sends a reconnect snapshot when the client last saw an older revision and replay is unavailable', () => {
    const registry = createInMemorySessionSocketRegistry()
    const store = createInMemorySessionStore<AuthoritativeSessionState>()
    const state = createAuthoritativeSessionState({
      sessionId: SESSION_ID,
      revision: REVISION_3,
      selectedMapSlug: 'hidden-map',
      maps: [
        {
          mapSlug: 'hidden-map',
          revision: MAP_REVISION_1,
          document: { secret: true },
        },
        {
          mapSlug: 'visible-map',
          revision: MAP_REVISION_1,
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
    store.create({
      sessionId: SESSION_ID,
      joinCode: JOIN_CODE,
      gmKey: GM_KEY,
      revision: state.revision,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      state,
    })
    const peer = makePeer('peer-reconnect')
    handleSessionSocketOpen(peer, {
      env: enabledEnv,
      registry,
      clock: () => '2026-05-26T10:15:00.000Z',
    })

    handleSessionSocketMessage(peer, {
      text: () => JSON.stringify(playerHello({
        reconnect: true,
        lastSeenRevision: INITIAL_SESSION_REVISION,
      })),
    }, {
      registry,
      store,
      clock: () => '2026-05-26T10:15:05.000Z',
    })

    const updatedState = store.get(SESSION_ID)?.state
    expect(updatedState).toBeDefined()
    expect(peer.closed).toEqual([])
    expect(parseSentJson(peer, 0)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'hello',
      direction: 'server',
      sessionId: SESSION_ID,
      currentRevision: REVISION_3,
      resumed: true,
      snapshotRequired: true,
    })
    expect(parseSentJson(peer, 0)).not.toHaveProperty('replayFromRevision')
    const reconnectActor = {
      role: 'player' as const,
      playerId: PLAYER_ID,
      clientId: PLAYER_CLIENT_ID,
      displayName: PLAYER_DISPLAY_NAME,
    }
    const expectedSnapshotState = createSessionReconnectSnapshotState(updatedState!, reconnectActor)
    expect(parseSentJson(peer, 1)).toEqual(createSessionReconnectSnapshotMessage(updatedState!, reconnectActor))
    expect(parseSentJson(peer, 1)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'snapshot',
      direction: 'server',
      sessionId: SESSION_ID,
      reason: 'reconnect',
      currentRevision: REVISION_3,
      replayAvailable: false,
      snapshot: {
        revision: REVISION_3,
        selectedMapSlug: null,
        updatedAt: '2026-05-26T10:15:05.000Z',
        maps: [
          {
            mapSlug: 'visible-map',
            document: { public: true },
          },
        ],
        connectedClients: [
          {
            clientId: PLAYER_CLIENT_ID,
            status: 'connected',
            lastSeenRevision: INITIAL_SESSION_REVISION,
          },
        ],
        players: [
          {
            playerId: PLAYER_ID,
            displayName: PLAYER_DISPLAY_NAME,
          },
        ],
        assignments: [
          {
            playerId: PLAYER_ID,
            visibleResources: [{ kind: 'map', mapSlug: 'visible-map' }],
          },
        ],
      },
    })
    expect(expectedSnapshotState.maps.some((map) => map.mapSlug === 'hidden-map')).toBe(false)
    expect(peer.sent).toHaveLength(2)
    expect(registry.get('peer-reconnect')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      currentRevision: REVISION_3,
      lastSeenRevision: INITIAL_SESSION_REVISION,
    })
  })

  it('rejects valid command frames before authentication without granting session authority', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peer = makePeer('peer-message')
    handleSessionSocketOpen(peer, {
      env: enabledEnv,
      registry,
      clock: () => '2026-05-26T10:00:00.000Z',
    })

    handleSessionSocketMessage(peer, { text: () => JSON.stringify(gmCommandMessage()) }, {
      registry,
      clock: () => '2026-05-26T10:00:05.000Z',
    })

    expect(registry.get('peer-message')).toBeUndefined()
    expect(peer.closed).toEqual([
      {
        code: SESSION_SOCKET_POLICY_CLOSE_CODE,
        reason: 'A valid Track 2 session WebSocket hello is required before command messages.',
      },
    ])
    expect(parseSentJson(peer)).toMatchObject({
      schemaVersion: 1,
      type: 'error',
      direction: 'server',
      code: 'unauthorized',
      retryable: false,
    })
  })

  it('validates message shape before pre-auth dispatch', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peer = makePeer('peer-malformed-preauth')
    handleSessionSocketOpen(peer, { env: enabledEnv, registry })

    handleSessionSocketMessage(peer, { text: () => JSON.stringify({ type: 'command' }) }, {
      registry,
      clock: () => '2026-05-26T10:05:00.000Z',
    })

    expect(registry.get('peer-malformed-preauth')).toBeUndefined()
    expect(peer.closed).toEqual([
      {
        code: SESSION_SOCKET_POLICY_CLOSE_CODE,
        reason: 'Session WebSocket command is malformed.',
      },
    ])
    expect(parseSentJson(peer)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'error',
      direction: 'server',
      code: 'malformed-message',
      retryable: false,
      details: {
        issues: expect.stringContaining('schemaVersion must be 1'),
      },
    })
  })

  it('rejects an invalid GM key and closes the unauthenticated socket', () => {
    const registry = createInMemorySessionSocketRegistry()
    const { store } = createStoreWithSession()
    const peer = makePeer('peer-bad-gm')
    handleSessionSocketOpen(peer, { env: enabledEnv, registry })

    handleSessionSocketMessage(peer, { text: () => JSON.stringify(gmHello(OTHER_GM_KEY)) }, {
      registry,
      store,
      clock: () => '2026-05-26T10:20:00.000Z',
    })

    expect(registry.get('peer-bad-gm')).toBeUndefined()
    expect(peer.closed[0]).toMatchObject({ code: SESSION_SOCKET_POLICY_CLOSE_CODE })
    expect(parseSentJson(peer)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'error',
      direction: 'server',
      sessionId: SESSION_ID,
      code: 'unauthorized',
      currentRevision: INITIAL_SESSION_REVISION,
      retryable: false,
    })
    expect(store.get(SESSION_ID)?.state?.connectedClients).toEqual([])
  })

  it('keeps authenticated sockets open but reports unsupported command messages', () => {
    const registry = createInMemorySessionSocketRegistry()
    const { store } = createStoreWithSession()
    const peer = makePeer('peer-authenticated-message')
    handleSessionSocketOpen(peer, { env: enabledEnv, registry })
    handleSessionSocketMessage(peer, { text: () => JSON.stringify(gmHello()) }, {
      registry,
      store,
      clock: () => '2026-05-26T10:30:00.000Z',
    })

    handleSessionSocketMessage(peer, { text: () => JSON.stringify(gmCommandMessage({
      command: {
        type: 'rollDice',
      },
    })) }, {
      registry,
      store,
      clock: () => '2026-05-26T10:30:05.000Z',
    })

    expect(registry.get('peer-authenticated-message')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      lastSeenAt: '2026-05-26T10:30:05.000Z',
    })
    expect(peer.closed).toEqual([])
    expect(parseSentJson(peer, 1)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'error',
      direction: 'server',
      sessionId: SESSION_ID,
      code: 'unsupported-message',
      message: 'Track 2 session WebSocket command dispatch currently supports moveToken, turnToken, spawnToken, deleteToken, sendOutPokemon, modifyHp, modifyCombatStages, modifyConditions, useMove, useManeuver, useAbility, useOrder, setInitiative, nextInitiative, previousInitiative, placeHazard, removeHazard, setFieldEffect, removeFieldEffect, tickFieldEffectDurations, buildTerrainVoxel, and removeTerrainVoxel commands only.',
      retryable: false,
    })
  })

  it('closes malformed command messages before authenticated dispatch', () => {
    const registry = createInMemorySessionSocketRegistry()
    const { store } = createStoreWithSession()
    const peer = makePeer('peer-malformed-command')
    handleSessionSocketOpen(peer, { env: enabledEnv, registry })
    handleSessionSocketMessage(peer, { text: () => JSON.stringify(gmHello()) }, {
      registry,
      store,
      clock: () => '2026-05-26T10:35:00.000Z',
    })

    handleSessionSocketMessage(peer, { text: () => JSON.stringify({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'command',
      direction: 'client',
      sessionId: SESSION_ID,
      command: { type: 'moveToken' },
    }) }, {
      registry,
      store,
      clock: () => '2026-05-26T10:35:05.000Z',
    })

    expect(registry.get('peer-malformed-command')).toBeUndefined()
    expect(peer.closed).toEqual([
      {
        code: SESSION_SOCKET_POLICY_CLOSE_CODE,
        reason: 'Session WebSocket command is malformed.',
      },
    ])
    expect(parseSentJson(peer, 1)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'error',
      direction: 'server',
      sessionId: SESSION_ID,
      code: 'malformed-message',
      currentRevision: INITIAL_SESSION_REVISION,
      retryable: false,
      details: {
        issues: expect.stringContaining('command.schemaVersion'),
      },
    })
  })

  it('closes cross-session command messages before authenticated dispatch', () => {
    const registry = createInMemorySessionSocketRegistry()
    const { store } = createStoreWithSession()
    const peer = makePeer('peer-cross-session-command')
    handleSessionSocketOpen(peer, { env: enabledEnv, registry })
    handleSessionSocketMessage(peer, { text: () => JSON.stringify(gmHello()) }, {
      registry,
      store,
      clock: () => '2026-05-26T10:36:00.000Z',
    })

    handleSessionSocketMessage(peer, { text: () => JSON.stringify(gmCommandMessage({
      message: { sessionId: parseSessionId('session_other000001x') },
    })) }, {
      registry,
      store,
      clock: () => '2026-05-26T10:36:05.000Z',
    })

    expect(registry.get('peer-cross-session-command')).toBeUndefined()
    expect(peer.closed).toEqual([
      {
        code: SESSION_SOCKET_POLICY_CLOSE_CODE,
        reason: 'Session WebSocket command session does not match the authenticated socket.',
      },
    ])
    expect(parseSentJson(peer, 1)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'error',
      direction: 'server',
      sessionId: SESSION_ID,
      code: 'unauthorized',
      currentRevision: INITIAL_SESSION_REVISION,
      retryable: false,
    })
  })

  it('closes command messages whose actor does not match the authenticated socket', () => {
    const registry = createInMemorySessionSocketRegistry()
    const { store } = createStoreWithSession()
    const peer = makePeer('peer-wrong-actor-command')
    handleSessionSocketOpen(peer, { env: enabledEnv, registry })
    handleSessionSocketMessage(peer, { text: () => JSON.stringify(gmHello()) }, {
      registry,
      store,
      clock: () => '2026-05-26T10:37:00.000Z',
    })

    handleSessionSocketMessage(peer, { text: () => JSON.stringify(gmCommandMessage({
      command: {
        actor: {
          role: 'player',
          playerId: PLAYER_ID,
          clientId: PLAYER_CLIENT_ID,
          displayName: PLAYER_DISPLAY_NAME,
        },
      },
    })) }, {
      registry,
      store,
      clock: () => '2026-05-26T10:37:05.000Z',
    })

    expect(registry.get('peer-wrong-actor-command')).toBeUndefined()
    expect(peer.closed).toEqual([
      {
        code: SESSION_SOCKET_POLICY_CLOSE_CODE,
        reason: 'Session WebSocket command actor does not match the authenticated socket.',
      },
    ])
    expect(parseSentJson(peer, 1)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'error',
      direction: 'server',
      sessionId: SESSION_ID,
      code: 'unauthorized',
      currentRevision: INITIAL_SESSION_REVISION,
      retryable: false,
    })
  })

  it('answers authenticated client heartbeat pings, records activity, and keeps sockets open', () => {
    const registry = createInMemorySessionSocketRegistry()
    const { store } = createStoreWithSession()
    const peer = makePeer('peer-heartbeat')
    handleSessionSocketOpen(peer, {
      env: enabledEnv,
      registry,
      clock: () => '2026-05-26T10:50:00.000Z',
    })
    handleSessionSocketMessage(peer, { text: () => JSON.stringify(playerHello()) }, {
      registry,
      store,
      clock: () => '2026-05-26T10:50:01.000Z',
    })

    handleSessionSocketMessage(peer, {
      text: () => JSON.stringify(clientHeartbeat({
        heartbeat: 'ping',
        nonce: 'hb-client-1',
        lastSeenRevision: INITIAL_SESSION_REVISION,
      })),
    }, {
      registry,
      store,
      clock: () => '2026-05-26T10:50:20.000Z',
    })

    expect(peer.closed).toEqual([])
    expect(parseSentJson(peer, 1)).toEqual({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'heartbeat',
      direction: 'server',
      sessionId: SESSION_ID,
      heartbeat: 'pong',
      nonce: 'hb-client-1',
      lastSeenRevision: INITIAL_SESSION_REVISION,
    })
    expect(registry.get('peer-heartbeat')).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      lastSeenAt: '2026-05-26T10:50:20.000Z',
      lastSeenRevision: INITIAL_SESSION_REVISION,
      currentRevision: INITIAL_SESSION_REVISION,
    })
    expect(store.get(SESSION_ID)?.state?.connectedClients).toEqual([
      {
        clientId: PLAYER_CLIENT_ID,
        actor: {
          role: 'player',
          playerId: PLAYER_ID,
          clientId: PLAYER_CLIENT_ID,
          displayName: PLAYER_DISPLAY_NAME,
        },
        status: 'connected',
        connectedAt: '2026-05-26T10:50:00.000Z',
        lastSeenAt: '2026-05-26T10:50:20.000Z',
        lastSeenRevision: INITIAL_SESSION_REVISION,
      },
    ])
  })

  it('records authenticated client heartbeat pongs without echoing another frame', () => {
    const registry = createInMemorySessionSocketRegistry()
    const { store } = createStoreWithSession()
    const peer = makePeer('peer-heartbeat-pong')
    handleSessionSocketOpen(peer, { env: enabledEnv, registry })
    handleSessionSocketMessage(peer, { text: () => JSON.stringify(gmHello()) }, {
      registry,
      store,
      clock: () => '2026-05-26T10:55:00.000Z',
    })

    handleSessionSocketMessage(peer, {
      text: () => JSON.stringify(clientHeartbeat({ heartbeat: 'pong', nonce: 'hb-server-1' })),
    }, {
      registry,
      store,
      clock: () => '2026-05-26T10:55:10.000Z',
    })

    expect(peer.sent).toHaveLength(1)
    expect(peer.closed).toEqual([])
    expect(registry.get('peer-heartbeat-pong')).toMatchObject({
      lastSeenAt: '2026-05-26T10:55:10.000Z',
    })
    expect(store.get(SESSION_ID)?.state?.connectedClients[0]).toMatchObject({
      clientId: GM_CLIENT_ID,
      status: 'connected',
      lastSeenAt: '2026-05-26T10:55:10.000Z',
    })
  })

  it('closes malformed or cross-session heartbeat frames after authentication', () => {
    const registry = createInMemorySessionSocketRegistry()
    const { store } = createStoreWithSession()
    const peer = makePeer('peer-bad-heartbeat')
    handleSessionSocketOpen(peer, { env: enabledEnv, registry })
    handleSessionSocketMessage(peer, { text: () => JSON.stringify(gmHello()) }, {
      registry,
      store,
      clock: () => '2026-05-26T11:00:00.000Z',
    })

    handleSessionSocketMessage(peer, {
      text: () => JSON.stringify(clientHeartbeat({
        sessionId: parseSessionId('session_other000001x'),
      })),
    }, {
      registry,
      store,
      clock: () => '2026-05-26T11:00:05.000Z',
    })

    expect(registry.get('peer-bad-heartbeat')).toBeUndefined()
    expect(peer.closed).toEqual([
      {
        code: SESSION_SOCKET_POLICY_CLOSE_CODE,
        reason: 'Session WebSocket heartbeat session does not match the authenticated socket.',
      },
    ])
    expect(parseSentJson(peer, 1)).toMatchObject({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'error',
      direction: 'server',
      sessionId: SESSION_ID,
      code: 'unauthorized',
      retryable: false,
    })
  })

  it('sends server heartbeat pings and closes stale authenticated sockets', () => {
    const registry = createInMemorySessionSocketRegistry()
    const { store } = createStoreWithSession()
    const peer = makePeer('peer-heartbeat-tick')
    handleSessionSocketOpen(peer, {
      env: enabledEnv,
      registry,
      clock: () => '2026-05-26T11:10:00.000Z',
    })
    handleSessionSocketMessage(peer, { text: () => JSON.stringify(playerHello()) }, {
      registry,
      store,
      clock: () => '2026-05-26T11:10:01.000Z',
    })

    expect(isSessionSocketConnectionStale(
      registry.get('peer-heartbeat-tick')!,
      '2026-05-26T11:10:20.000Z',
    )).toBe(false)

    const ping = handleSessionSocketHeartbeatTick(peer, {
      registry,
      store,
      clock: () => '2026-05-26T11:10:26.000Z',
    })

    expect(ping.action).toBe('sent-ping')
    expect(parseSentJson(peer, 1)).toEqual({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'heartbeat',
      direction: 'server',
      sessionId: SESSION_ID,
      heartbeat: 'ping',
      nonce: `hb-peer-heartbeat-tick-${Date.parse('2026-05-26T11:10:26.000Z')}`,
      lastSeenRevision: INITIAL_SESSION_REVISION,
    })

    expect(isSessionSocketConnectionStale(
      registry.get('peer-heartbeat-tick')!,
      '2026-05-26T11:11:01.000Z',
    )).toBe(true)

    const closed = handleSessionSocketHeartbeatTick(peer, {
      registry,
      store,
      clock: () => '2026-05-26T11:11:01.000Z',
    })

    expect(closed.action).toBe('closed-stale')
    expect(peer.closed).toEqual([
      {
        code: SESSION_SOCKET_POLICY_CLOSE_CODE,
        reason: SESSION_SOCKET_HEARTBEAT_TIMEOUT_REASON,
      },
    ])
    expect(registry.get('peer-heartbeat-tick')).toBeUndefined()
    expect(store.get(SESSION_ID)?.state?.connectedClients).toEqual([
      {
        clientId: PLAYER_CLIENT_ID,
        actor: {
          role: 'player',
          playerId: PLAYER_ID,
          clientId: PLAYER_CLIENT_ID,
          displayName: PLAYER_DISPLAY_NAME,
        },
        status: 'disconnected',
        connectedAt: '2026-05-26T11:10:00.000Z',
        lastSeenAt: '2026-05-26T11:11:01.000Z',
        disconnectedAt: '2026-05-26T11:11:01.000Z',
      },
    ])
  })

  it('marks an authenticated client disconnected when its socket closes', () => {
    const registry = createInMemorySessionSocketRegistry()
    const { store } = createStoreWithSession()
    const peer = makePeer('peer-close-player')
    handleSessionSocketOpen(peer, {
      env: enabledEnv,
      registry,
      clock: () => '2026-05-26T10:40:00.000Z',
    })
    handleSessionSocketMessage(peer, { text: () => JSON.stringify(playerHello()) }, {
      registry,
      store,
      clock: () => '2026-05-26T10:40:01.000Z',
    })

    const closed = handleSessionSocketClose(peer, { code: 1000, reason: 'done' }, {
      registry,
      store,
      clock: () => '2026-05-26T10:41:00.000Z',
    })

    expect(closed).toMatchObject({
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      sessionId: SESSION_ID,
      closeCode: 1000,
      closeReason: 'done',
      closedAt: '2026-05-26T10:41:00.000Z',
    })
    expect(store.get(SESSION_ID)?.state?.connectedClients).toEqual([
      {
        clientId: PLAYER_CLIENT_ID,
        actor: {
          role: 'player',
          playerId: PLAYER_ID,
          clientId: PLAYER_CLIENT_ID,
          displayName: PLAYER_DISPLAY_NAME,
        },
        status: 'disconnected',
        connectedAt: '2026-05-26T10:40:00.000Z',
        lastSeenAt: '2026-05-26T10:41:00.000Z',
        disconnectedAt: '2026-05-26T10:41:00.000Z',
      },
    ])
  })

  it('updates pending connection activity on socket errors without disconnecting', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peer = makePeer('peer-error')
    handleSessionSocketOpen(peer, {
      env: enabledEnv,
      registry,
      clock: () => '2026-05-26T10:00:00.000Z',
    })

    handleSessionSocketError(peer, new Error('boom'), {
      registry,
      clock: () => '2026-05-26T10:00:10.000Z',
    })

    expect(registry.size).toBe(1)
    expect(registry.get('peer-error')).toMatchObject({
      lastSeenAt: '2026-05-26T10:00:10.000Z',
    })
  })
})
