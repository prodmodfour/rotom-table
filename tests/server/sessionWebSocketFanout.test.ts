import { describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  type SessionCommandAcceptedResult,
  type SessionCommandInvalidRejection,
} from '#shared/sessionCommandResults'
import { parseOpId } from '#shared/sessionCommands'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionClientHelloMessage,
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
  parseSessionRevision,
  type SessionRevision,
} from '#shared/sessionRevisions'
import type { SessionActor } from '#shared/sessionPermissions'
import {
  createAuthoritativeSessionState,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
} from '~~/server/utils/sessionHosting'
import {
  createInMemorySessionSocketRegistry,
  handleSessionSocketMessage,
  handleSessionSocketOpen,
  type SessionSocketPeerLike,
} from '~~/server/utils/sessionWebSocketServer'
import {
  createInMemorySessionSocketPeerRegistry,
  createSessionCommandResultFanoutMessage,
  createSessionPatchFanoutMessage,
  createSessionPresenceFanoutMessage,
  createSessionSnapshotFanoutMessage,
  fanoutSessionServerMessage,
} from '~~/server/utils/sessionWebSocketFanout'
import { createInMemorySessionStore } from '~~/server/utils/sessionStore'

const enabledEnv = { [SESSION_HOST_ENABLE_ENV]: SESSION_HOST_ENABLE_VALUE }

const SESSION_ID = parseSessionId('session_fanout000001')
const OTHER_SESSION_ID = parseSessionId('session_fanout000002')
const JOIN_CODE = parseJoinCode('FAN234')
const OTHER_JOIN_CODE = parseJoinCode('FAN235')
const GM_KEY = parseGmKey('gmkey_fanoutprimarysecret00010')
const OTHER_GM_KEY = parseGmKey('gmkey_fanoutsecondarysecret020')
const GM_CLIENT_ID = parseClientId('client_fanoutgm')
const OTHER_GM_CLIENT_ID = parseClientId('client_othergm1')
const PLAYER_ID = parsePlayerId('player_fanout01')
const PLAYER_CLIENT_ID = parseClientId('client_fanoutplayer')
const PLAYER_DISPLAY_NAME = parseSessionDisplayName('Misty')
const OTHER_PLAYER_ID = parsePlayerId('player_other001')
const OTHER_PLAYER_CLIENT_ID = parseClientId('client_otherplayer')
const OTHER_PLAYER_DISPLAY_NAME = parseSessionDisplayName('Brock')
const OP_ID = parseOpId('op_fanout001')
const REVISION_1 = parseSessionRevision(1)
const CREATED_AT = '2026-05-26T12:00:00.000Z'

type FakePeer = SessionSocketPeerLike & {
  readonly sent: unknown[]
  readonly closed: { readonly code?: number, readonly reason?: string }[]
}

const makePeer = (id: string): FakePeer => {
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

const parseSentJson = (peer: FakePeer, index = 0): unknown => JSON.parse(String(peer.sent[index]))

const gmActor = {
  role: 'gm' as const,
  clientId: GM_CLIENT_ID,
}

const playerActor = {
  role: 'player' as const,
  playerId: PLAYER_ID,
  clientId: PLAYER_CLIENT_ID,
  displayName: PLAYER_DISPLAY_NAME,
}

const otherPlayerActor = {
  role: 'player' as const,
  playerId: OTHER_PLAYER_ID,
  clientId: OTHER_PLAYER_CLIENT_ID,
  displayName: OTHER_PLAYER_DISPLAY_NAME,
}

const createState = (sessionId = SESSION_ID): AuthoritativeSessionState =>
  createAuthoritativeSessionState({
    sessionId,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    connectedClients: sessionId === SESSION_ID
      ? [
          {
            clientId: GM_CLIENT_ID,
            actor: gmActor,
            status: 'connected',
            connectedAt: CREATED_AT,
            lastSeenAt: CREATED_AT,
          },
          {
            clientId: PLAYER_CLIENT_ID,
            actor: playerActor,
            status: 'connected',
            connectedAt: CREATED_AT,
            lastSeenAt: CREATED_AT,
          },
        ]
      : [
          {
            clientId: OTHER_PLAYER_CLIENT_ID,
            actor: otherPlayerActor,
            status: 'connected',
            connectedAt: CREATED_AT,
            lastSeenAt: CREATED_AT,
          },
        ],
    players: sessionId === SESSION_ID
      ? [
          {
            playerId: PLAYER_ID,
            displayName: PLAYER_DISPLAY_NAME,
            joinedAt: CREATED_AT,
            updatedAt: CREATED_AT,
          },
        ]
      : [
          {
            playerId: OTHER_PLAYER_ID,
            displayName: OTHER_PLAYER_DISPLAY_NAME,
            joinedAt: CREATED_AT,
            updatedAt: CREATED_AT,
          },
        ],
    assignments: [],
  })

const registerAuthenticatedPeer = (
  registry: ReturnType<typeof createInMemorySessionSocketRegistry>,
  peers: ReturnType<typeof createInMemorySessionSocketPeerRegistry>,
  peer: FakePeer,
  sessionId = SESSION_ID,
  actor: SessionActor = gmActor,
): void => {
  registry.open(peer.id, { connectedAt: CREATED_AT })
  peers.register(peer)
  registry.authenticate(peer.id, {
    sessionId,
    actor,
    currentRevision: INITIAL_SESSION_REVISION,
    authenticatedAt: CREATED_AT,
  })
}

const gmHello = (sessionId = SESSION_ID, gmKey = GM_KEY, clientId = GM_CLIENT_ID): SessionClientHelloMessage => ({
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

describe('session WebSocket fanout', () => {
  it('fans out presence to authenticated peers in the same session only', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peers = createInMemorySessionSocketPeerRegistry()
    const gmPeer = makePeer('peer-gm')
    const playerPeer = makePeer('peer-player')
    const otherSessionPeer = makePeer('peer-other-session')
    const pendingPeer = makePeer('peer-pending')

    registerAuthenticatedPeer(registry, peers, gmPeer, SESSION_ID, gmActor)
    registerAuthenticatedPeer(registry, peers, playerPeer, SESSION_ID, playerActor)
    registerAuthenticatedPeer(registry, peers, otherSessionPeer, OTHER_SESSION_ID, otherPlayerActor)
    registry.open(pendingPeer.id, { connectedAt: CREATED_AT })
    peers.register(pendingPeer)

    const message = createSessionPresenceFanoutMessage(createState(), 'snapshot')
    const result = fanoutSessionServerMessage(message, { registry, peers })

    expect(result.sentPeerIds).toEqual(['peer-gm', 'peer-player'])
    expect(result.skippedPeerIds).toEqual([])
    expect(parseSentJson(gmPeer)).toEqual(message)
    expect(parseSentJson(playerPeer)).toEqual(message)
    expect(otherSessionPeer.sent).toEqual([])
    expect(pendingPeer.sent).toEqual([])
  })

  it('skips explicit cross-session, pending, excluded, and missing targets', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peers = createInMemorySessionSocketPeerRegistry()
    const gmPeer = makePeer('peer-gm')
    const playerPeer = makePeer('peer-player')
    const otherSessionPeer = makePeer('peer-other-session')
    const pendingPeer = makePeer('peer-pending')

    registerAuthenticatedPeer(registry, peers, gmPeer, SESSION_ID, gmActor)
    registerAuthenticatedPeer(registry, peers, playerPeer, SESSION_ID, playerActor)
    registerAuthenticatedPeer(registry, peers, otherSessionPeer, OTHER_SESSION_ID, otherPlayerActor)
    registry.open(pendingPeer.id, { connectedAt: CREATED_AT })
    peers.register(pendingPeer)

    const message = createSessionPatchFanoutMessage(SESSION_ID, {
      eventId: 'event_rev_1',
      eventType: 'tokenMoved',
      revision: REVISION_1,
      commandType: 'moveToken',
      opId: OP_ID,
      actor: playerActor,
      scopes: [{ lane: 'token', mapSlug: 'map-a' }],
      payload: { tokenId: 'token-a', to: { x: 1, y: 2, z: 0 } },
    })
    const result = fanoutSessionServerMessage(message, { registry, peers }, {
      targetPeerIds: [
        'peer-gm',
        'peer-player',
        'peer-other-session',
        'peer-pending',
        'peer-missing',
      ],
      excludePeerIds: ['peer-player'],
    })

    expect(result.sentPeerIds).toEqual(['peer-gm'])
    expect(gmPeer.sent).toHaveLength(1)
    expect(playerPeer.sent).toEqual([])
    expect(otherSessionPeer.sent).toEqual([])
    expect(pendingPeer.sent).toEqual([])
    expect(result.deliveries).toContainEqual({ peerId: 'peer-player', sent: false, reason: 'excluded' })
    expect(result.deliveries).toContainEqual({ peerId: 'peer-other-session', sent: false, reason: 'cross-session' })
    expect(result.deliveries).toContainEqual({ peerId: 'peer-pending', sent: false, reason: 'not-authenticated' })
    expect(result.deliveries).toContainEqual({ peerId: 'peer-missing', sent: false, reason: 'missing-connection' })
  })

  it('builds command result, patch, and snapshot server messages for future command handlers', () => {
    const accepted: SessionCommandAcceptedResult<'moveToken', { readonly tokenId: string }, SessionRevision> = {
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'accepted',
      accepted: true,
      sessionId: SESSION_ID,
      opId: OP_ID,
      commandType: 'moveToken',
      actor: playerActor,
      currentRevision: REVISION_1,
      scopes: [{ lane: 'token', mapSlug: 'map-a' }],
      event: { tokenId: 'token-a' },
    }
    const rejected: SessionCommandInvalidRejection<'moveToken', SessionRevision> = {
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'rejected',
      accepted: false,
      reason: 'invalid',
      message: 'Token ID is required.',
      retryable: false,
      sessionId: SESSION_ID,
      opId: OP_ID,
      commandType: 'moveToken',
      actor: playerActor,
      currentRevision: INITIAL_SESSION_REVISION,
      scopes: [{ lane: 'token', mapSlug: 'map-a' }],
      issues: [
        {
          path: 'payload.tokenId',
          code: 'required',
          message: 'Token ID is required.',
        },
      ],
    }

    expect(createSessionCommandResultFanoutMessage(accepted)).toEqual({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandAck',
      direction: 'server',
      sessionId: SESSION_ID,
      result: accepted,
    })
    expect(createSessionCommandResultFanoutMessage(rejected)).toEqual({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandReject',
      direction: 'server',
      sessionId: SESSION_ID,
      result: rejected,
    })
    expect(createSessionSnapshotFanoutMessage({
      sessionId: SESSION_ID,
      reason: 'manual-sync',
      currentRevision: REVISION_1,
      snapshot: { selectedMapSlug: 'map-a' },
      replayAvailable: false,
    })).toEqual({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'snapshot',
      direction: 'server',
      sessionId: SESSION_ID,
      reason: 'manual-sync',
      currentRevision: REVISION_1,
      snapshot: { selectedMapSlug: 'map-a' },
      replayAvailable: false,
    })
  })

  it('broadcasts join presence through the WebSocket handler without leaking across sessions', () => {
    const registry = createInMemorySessionSocketRegistry()
    const peers = createInMemorySessionSocketPeerRegistry()
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
      assignments: [],
    })
    const otherState = createAuthoritativeSessionState({
      sessionId: OTHER_SESSION_ID,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
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
    store.create({
      sessionId: OTHER_SESSION_ID,
      joinCode: OTHER_JOIN_CODE,
      gmKey: OTHER_GM_KEY,
      revision: otherState.revision,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      state: otherState,
    })
    const gmPeer = makePeer('peer-gm')
    const playerPeer = makePeer('peer-player')
    const otherPeer = makePeer('peer-other-session')

    handleSessionSocketOpen(gmPeer, { env: enabledEnv, registry, peers, clock: () => CREATED_AT })
    handleSessionSocketMessage(gmPeer, { text: () => JSON.stringify(gmHello()) }, {
      registry,
      peers,
      store,
      clock: () => '2026-05-26T12:00:01.000Z',
    })
    handleSessionSocketOpen(otherPeer, { env: enabledEnv, registry, peers, clock: () => CREATED_AT })
    handleSessionSocketMessage(otherPeer, {
      text: () => JSON.stringify(gmHello(OTHER_SESSION_ID, OTHER_GM_KEY, OTHER_GM_CLIENT_ID)),
    }, {
      registry,
      peers,
      store,
      clock: () => '2026-05-26T12:00:02.000Z',
    })
    handleSessionSocketOpen(playerPeer, { env: enabledEnv, registry, peers, clock: () => CREATED_AT })
    handleSessionSocketMessage(playerPeer, { text: () => JSON.stringify(playerHello()) }, {
      registry,
      peers,
      store,
      clock: () => '2026-05-26T12:00:03.000Z',
    })

    expect(parseSentJson(gmPeer, 0)).toMatchObject({ type: 'hello', sessionId: SESSION_ID })
    expect(parseSentJson(gmPeer, 1)).toMatchObject({ type: 'presence', sessionId: SESSION_ID, change: 'joined' })
    expect(parseSentJson(gmPeer, 2)).toMatchObject({ type: 'presence', sessionId: SESSION_ID, change: 'joined' })
    expect(parseSentJson(playerPeer, 0)).toMatchObject({ type: 'hello', sessionId: SESSION_ID })
    expect(parseSentJson(playerPeer, 1)).toMatchObject({ type: 'presence', sessionId: SESSION_ID, change: 'joined' })
    expect(otherPeer.sent).toHaveLength(2)
    expect(parseSentJson(otherPeer, 0)).toMatchObject({ type: 'hello', sessionId: OTHER_SESSION_ID })
    expect(parseSentJson(otherPeer, 1)).toMatchObject({ type: 'presence', sessionId: OTHER_SESSION_ID, change: 'joined' })
  })
})
