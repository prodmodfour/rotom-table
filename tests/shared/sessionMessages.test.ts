import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  type SessionCommandAcceptedResult,
  type SessionCommandStaleResult,
} from '#shared/sessionCommandResults'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
  type SessionCommandEnvelope,
  type SessionCommandScope,
} from '#shared/sessionCommands'
import {
  parseClientId,
  parseGmKey,
  parsePlayerId,
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import type { GmSessionActor, PlayerSessionActor, SessionTokenResourceRef } from '#shared/sessionPermissions'
import { parseRevision, type Revision } from '#shared/sessionRevisions'
import {
  SESSION_CLIENT_MESSAGE_TYPES,
  SESSION_ERROR_CODES,
  SESSION_HEARTBEAT_KINDS,
  SESSION_MESSAGE_DIRECTIONS,
  SESSION_MESSAGE_SCHEMA_VERSION,
  SESSION_MESSAGE_TYPES,
  SESSION_PRESENCE_CHANGES,
  SESSION_PRESENCE_STATUSES,
  SESSION_SERVER_MESSAGE_TYPES,
  SESSION_SNAPSHOT_REASONS,
  isSessionClientMessage,
  isSessionClientMessageType,
  isSessionCommandAckMessage,
  isSessionCommandRejectMessage,
  isSessionErrorCode,
  isSessionHeartbeatKind,
  isSessionMessageDirection,
  isSessionMessageType,
  isSessionPresenceChange,
  isSessionPresenceStatus,
  isSessionServerMessage,
  isSessionServerMessageType,
  isSessionSnapshotReason,
  type SessionClientHelloMessage,
  type SessionClientMessage,
  type SessionCommandAckMessage,
  type SessionCommandMessage,
  type SessionCommandRejectMessage,
  type SessionCommandResultMessage,
  type SessionErrorCode,
  type SessionErrorMessage,
  type SessionHeartbeatKind,
  type SessionHeartbeatMessage,
  type SessionHelloMessage,
  type SessionMessageDirection,
  type SessionMessageType,
  type SessionPatchMessage,
  type SessionPresenceMessage,
  type SessionPresenceStatus,
  type SessionServerHelloMessage,
  type SessionServerMessage,
  type SessionSnapshotMessage,
  type SessionSnapshotReason,
  type SessionWebSocketMessage,
} from '#shared/sessionMessages'

const sessionId = parseSessionId('session_messages0001')
const playerId = parsePlayerId('player_message01')
const gmClientId = parseClientId('client_gmmessage')
const playerClientId = parseClientId('client_playermsg')
const gmKey = parseGmKey('gmkey_abcdefghijklmnopqrstuvwxyzAB')
const displayName = sanitizeSessionDisplayName('Message Tester')
const opId = parseOpId('op_message0001')

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

const tokenResource = {
  kind: 'token',
  tokenId: 'token-001',
  mapSlug: 'viridian-gym',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionTokenResourceRef

const tokenScope = {
  lane: 'token',
  resource: tokenResource,
  field: 'position',
  mapSlug: 'viridian-gym',
} as const satisfies SessionCommandScope

interface MoveTokenPayload {
  readonly tokenId: string
  readonly to: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
}

interface TokenMovedEvent extends MoveTokenPayload {
  readonly eventType: 'tokenMoved'
}

interface TokenState {
  readonly tokenId: string
  readonly position: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
}

interface SessionSnapshotFixture {
  readonly selectedMapSlug: string
  readonly revision: number
  readonly tokens: readonly TokenState[]
}

const moveTokenPayload = {
  tokenId: 'token-001',
  to: { x: 4, y: 5, z: 0 },
} as const satisfies MoveTokenPayload

describe('session socket message schema types', () => {
  it('defines client/server message vocabularies and narrow runtime predicates', () => {
    expect(SESSION_MESSAGE_SCHEMA_VERSION).toBe(1)
    expect(SESSION_MESSAGE_DIRECTIONS).toEqual(['client', 'server'])
    expect(SESSION_CLIENT_MESSAGE_TYPES).toEqual(['hello', 'heartbeat', 'command'])
    expect(SESSION_SERVER_MESSAGE_TYPES).toEqual([
      'hello',
      'heartbeat',
      'commandAck',
      'commandReject',
      'snapshot',
      'patch',
      'presence',
      'error',
    ])
    expect(SESSION_MESSAGE_TYPES).toEqual([
      'hello',
      'heartbeat',
      'command',
      'commandAck',
      'commandReject',
      'snapshot',
      'patch',
      'presence',
      'error',
    ])
    expect(SESSION_HEARTBEAT_KINDS).toEqual(['ping', 'pong'])
    expect(SESSION_SNAPSHOT_REASONS).toEqual([
      'initial',
      'reconnect',
      'recovery',
      'permission-change',
      'manual-sync',
    ])
    expect(SESSION_PRESENCE_STATUSES).toEqual(['connected', 'disconnected', 'reconnecting'])
    expect(SESSION_PRESENCE_CHANGES).toEqual(['snapshot', 'joined', 'left', 'updated'])
    expect(SESSION_ERROR_CODES).toContain('session-host-disabled')

    expect(isSessionMessageDirection('client')).toBe(true)
    expect(isSessionMessageDirection('browser')).toBe(false)
    expect(isSessionClientMessageType('command')).toBe(true)
    expect(isSessionClientMessageType('presence')).toBe(false)
    expect(isSessionServerMessageType('presence')).toBe(true)
    expect(isSessionServerMessageType('command')).toBe(false)
    expect(isSessionMessageType('snapshot')).toBe(true)
    expect(isSessionMessageType('mapAutosave')).toBe(false)
    expect(isSessionHeartbeatKind('pong')).toBe(true)
    expect(isSessionHeartbeatKind('keepalive')).toBe(false)
    expect(isSessionSnapshotReason('reconnect')).toBe(true)
    expect(isSessionSnapshotReason('polling')).toBe(false)
    expect(isSessionPresenceStatus('connected')).toBe(true)
    expect(isSessionPresenceStatus('online')).toBe(false)
    expect(isSessionPresenceChange('joined')).toBe(true)
    expect(isSessionPresenceChange('renamed')).toBe(false)
    expect(isSessionErrorCode('unauthorized')).toBe(true)
    expect(isSessionErrorCode('permission-denied')).toBe(false)

    expectTypeOf<(typeof SESSION_MESSAGE_DIRECTIONS)[number]>().toEqualTypeOf<SessionMessageDirection>()
    expectTypeOf<(typeof SESSION_MESSAGE_TYPES)[number]>().toEqualTypeOf<SessionMessageType>()
    expectTypeOf<(typeof SESSION_HEARTBEAT_KINDS)[number]>().toEqualTypeOf<SessionHeartbeatKind>()
    expectTypeOf<(typeof SESSION_SNAPSHOT_REASONS)[number]>().toEqualTypeOf<SessionSnapshotReason>()
    expectTypeOf<(typeof SESSION_PRESENCE_STATUSES)[number]>().toEqualTypeOf<SessionPresenceStatus>()
    expectTypeOf<(typeof SESSION_ERROR_CODES)[number]>().toEqualTypeOf<SessionErrorCode>()
  })

  it('models hello and reconnect handshakes for GM and player identities', () => {
    const playerHello = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'hello',
      direction: 'client',
      sessionId,
      messageId: 'hello-player-001',
      identity: {
        role: 'player',
        clientId: playerClientId,
        playerId,
        displayName,
      },
      reconnect: true,
      lastSeenRevision: parseRevision(7),
    } as const satisfies SessionClientHelloMessage

    const gmHello = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'hello',
      direction: 'client',
      sessionId,
      identity: {
        role: 'gm',
        clientId: gmClientId,
        gmKey,
      },
      reconnect: false,
    } as const satisfies SessionClientHelloMessage

    const serverHello = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'hello',
      direction: 'server',
      sessionId,
      actor: playerActor,
      currentRevision: parseRevision(8),
      resumed: true,
      heartbeat: {
        intervalMs: 30_000,
        timeoutMs: 90_000,
      },
      replayFromRevision: parseRevision(7),
      snapshotRequired: false,
    } as const satisfies SessionServerHelloMessage

    const helloMessages = [playerHello, serverHello] as const satisfies readonly SessionHelloMessage[]

    expect(playerHello.identity.role).toBe('player')
    expect(playerHello.lastSeenRevision).toBe(7)
    expect(gmHello.identity.gmKey).toBe(gmKey)
    expect(serverHello.heartbeat.intervalMs).toBe(30_000)
    expect(serverHello.resumed).toBe(true)
    expect(helloMessages.map((message) => message.direction)).toEqual(['client', 'server'])
    expect(isSessionClientMessage(playerHello)).toBe(true)
    expect(isSessionServerMessage(serverHello)).toBe(true)

    expectTypeOf(playerHello).toMatchTypeOf<SessionClientMessage>()
    expectTypeOf(serverHello).toMatchTypeOf<SessionServerMessage>()
    expectTypeOf(serverHello.currentRevision).toMatchTypeOf<Revision>()
  })

  it('wraps command envelopes and heartbeat frames without whole-map autosave messages', () => {
    const command = {
      schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
      sessionId,
      actor: playerActor,
      type: 'moveToken',
      opId,
      baseRevision: parseRevision(8),
      scopes: [tokenScope],
      payload: moveTokenPayload,
      metadata: {
        clientIssuedAt: '2026-05-25T00:00:00.000Z',
        traceId: 'move-token-command-message',
      },
    } as const satisfies SessionCommandEnvelope<'moveToken', MoveTokenPayload, PlayerSessionActor>

    const commandMessage = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'command',
      direction: 'client',
      sessionId,
      command,
    } as const satisfies SessionCommandMessage<typeof command>

    const serverPing = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'heartbeat',
      direction: 'server',
      sessionId,
      heartbeat: 'ping',
      nonce: 'heartbeat-001',
    } as const satisfies SessionHeartbeatMessage<'server'>

    const clientPong = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'heartbeat',
      direction: 'client',
      sessionId,
      heartbeat: 'pong',
      nonce: 'heartbeat-001',
      lastSeenRevision: parseRevision(8),
    } as const satisfies SessionHeartbeatMessage<'client'>

    const clientMessages = [commandMessage, clientPong] as const satisfies readonly SessionClientMessage[]

    expect(commandMessage.command.opId).toBe(opId)
    expect(commandMessage.command.baseRevision).toBe(8)
    expect(serverPing.heartbeat).toBe('ping')
    expect(clientPong.lastSeenRevision).toBe(8)
    expect(clientMessages.map((message) => message.type)).toEqual(['command', 'heartbeat'])

    expectTypeOf(commandMessage.command.payload).toMatchTypeOf<MoveTokenPayload>()
    expectTypeOf(serverPing).toMatchTypeOf<SessionServerMessage>()
    expectTypeOf(clientPong).toMatchTypeOf<SessionClientMessage>()
  })

  it('models command acknowledgements and rejections as separate server messages', () => {
    const acceptedResult = {
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'accepted',
      accepted: true,
      sessionId,
      opId,
      commandType: 'moveToken',
      actor: playerActor,
      currentRevision: parseRevision(9),
      scopes: [tokenScope],
      event: {
        eventType: 'tokenMoved',
        ...moveTokenPayload,
      },
    } as const satisfies SessionCommandAcceptedResult<'moveToken', TokenMovedEvent>

    const currentTokenState = {
      tokenId: 'token-001',
      position: { x: 3, y: 4, z: 0 },
    } as const satisfies TokenState

    const staleResult = {
      schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
      status: 'rejected',
      accepted: false,
      reason: 'stale',
      message: 'The token moved after the command was created.',
      retryable: true,
      sessionId,
      opId,
      commandType: 'moveToken',
      actor: playerActor,
      baseRevision: parseRevision(8),
      currentRevision: parseRevision(10),
      scopes: [tokenScope],
      changedScopes: [tokenScope],
      currentState: currentTokenState,
    } as const satisfies SessionCommandStaleResult<'moveToken', TokenState>

    const ackMessage = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandAck',
      direction: 'server',
      sessionId,
      result: acceptedResult,
    } as const satisfies SessionCommandAckMessage<'moveToken', TokenMovedEvent>

    const rejectMessage = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandReject',
      direction: 'server',
      sessionId,
      result: staleResult,
    } as const satisfies SessionCommandRejectMessage<'moveToken', TokenState>

    const summarize = (
      message: SessionCommandResultMessage<'moveToken', TokenMovedEvent, TokenState>,
    ): string => {
      if (isSessionCommandAckMessage(message)) return message.result.status
      if (isSessionCommandRejectMessage(message)) return message.result.reason
      return 'unknown'
    }

    expect(isSessionCommandAckMessage(ackMessage)).toBe(true)
    expect(isSessionCommandRejectMessage(rejectMessage)).toBe(true)
    expect(summarize(ackMessage)).toBe('accepted')
    expect(summarize(rejectMessage)).toBe('stale')
    expect(rejectMessage.result.currentState.position).toEqual({ x: 3, y: 4, z: 0 })

    expectTypeOf(ackMessage).toMatchTypeOf<SessionServerMessage>()
    expectTypeOf(rejectMessage).toMatchTypeOf<SessionServerMessage>()
  })

  it('models snapshots, patch events, presence, and safe error frames', () => {
    const snapshotMessage = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'snapshot',
      direction: 'server',
      sessionId,
      reason: 'reconnect',
      currentRevision: parseRevision(12),
      replayAvailable: false,
      snapshot: {
        selectedMapSlug: 'viridian-gym',
        revision: 12,
        tokens: [
          {
            tokenId: 'token-001',
            position: { x: 4, y: 5, z: 0 },
          },
        ],
      },
    } as const satisfies SessionSnapshotMessage<SessionSnapshotFixture>

    const patchMessage = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'patch',
      direction: 'server',
      sessionId,
      event: {
        eventId: 'event-token-moved-001',
        eventType: 'tokenMoved',
        revision: parseRevision(13),
        commandType: 'moveToken',
        opId,
        actor: playerActor,
        scopes: [tokenScope],
        payload: {
          eventType: 'tokenMoved',
          ...moveTokenPayload,
        },
      },
    } as const satisfies SessionPatchMessage<'tokenMoved', TokenMovedEvent>

    const presenceMessage = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'presence',
      direction: 'server',
      sessionId,
      change: 'joined',
      currentRevision: parseRevision(13),
      clients: [
        {
          actor: gmActor,
          clientId: gmClientId,
          status: 'connected',
          connectedAt: '2026-05-25T00:00:00.000Z',
          lastSeenRevision: parseRevision(13),
        },
        {
          actor: playerActor,
          clientId: playerClientId,
          status: 'connected',
          connectedAt: '2026-05-25T00:00:01.000Z',
          lastSeenRevision: parseRevision(12),
        },
      ],
    } as const satisfies SessionPresenceMessage

    const errorMessage = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'error',
      direction: 'server',
      sessionId,
      code: 'unauthorized',
      message: 'This session identity cannot send that message.',
      retryable: false,
      currentRevision: parseRevision(13),
      details: {
        attemptedType: 'command',
        playerVisible: true,
        retryAfterMs: 0,
        note: null,
      },
    } as const satisfies SessionErrorMessage

    const serverMessages = [
      snapshotMessage,
      patchMessage,
      presenceMessage,
      errorMessage,
    ] as const satisfies readonly SessionServerMessage[]
    const roundTrippedPatch = JSON.parse(JSON.stringify(patchMessage)) as SessionPatchMessage<
      'tokenMoved',
      TokenMovedEvent
    >

    expect(snapshotMessage.snapshot.selectedMapSlug).toBe('viridian-gym')
    expect(snapshotMessage.reason).toBe('reconnect')
    expect(patchMessage.event.revision).toBe(13)
    expect(roundTrippedPatch.event.payload.to).toEqual({ x: 4, y: 5, z: 0 })
    expect(presenceMessage.clients.map((client) => client.actor.role)).toEqual(['gm', 'player'])
    expect(errorMessage.details?.attemptedType).toBe('command')
    expect(serverMessages.map((message) => message.type)).toEqual([
      'snapshot',
      'patch',
      'presence',
      'error',
    ])

    const webSocketMessages = [
      snapshotMessage,
      patchMessage,
      presenceMessage,
      errorMessage,
    ] as const satisfies readonly SessionWebSocketMessage[]
    expect(webSocketMessages.every(isSessionServerMessage)).toBe(true)
  })
})
