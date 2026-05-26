import { ref, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import { parseOpId } from '#shared/sessionCommands'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionClientMessage,
  type SessionServerMessage,
} from '#shared/sessionMessages'
import {
  parseClientId,
  parseGmKey,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import { parseSessionRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  MOVE_TOKEN_COMMAND_TYPE,
  type MoveTokenCommand,
} from '#shared/sessionTokenCommands'
import {
  createMoveTokenCommandMessage,
  isSessionModeQueryEnabled,
  sessionActorFromClientIdentity,
  useSessionMoveTokenDispatch,
  type SessionMoveTokenSocket,
} from '~/composables/map-editor/useSessionMoveTokenDispatch'
import type {
  SessionSocketHelloStatus,
  SessionSocketSendResult,
  SessionSocketStatus,
} from '~/composables/useSessionSocket'
import type { SessionClientIdentityStorage } from '~/utils/sessionClientIdentityStorage'

const SESSION_ID = parseSessionId('session_abcdefghijkl')
const GM_CLIENT_ID = parseClientId('client_gmclient01')
const PLAYER_CLIENT_ID = parseClientId('client_player01')
const PLAYER_ID = parsePlayerId('player_misty001')
const GM_KEY = parseGmKey('gmkey_abcdefghijklmnopqrstuvwxyz')
const DISPLAY_NAME = parseSessionDisplayName('Misty')
const OP_ID = parseOpId('op_12345678')
const REVISION_2 = parseSessionRevision(2)
const REVISION_4 = parseSessionRevision(4)

const gmIdentity: SessionClientIdentity = {
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'gm',
  sessionId: SESSION_ID,
  clientId: GM_CLIENT_ID,
  gmKey: GM_KEY,
  rememberedAt: '2026-05-26T10:00:00.000Z',
  lastSeenRevision: REVISION_2,
}

const playerIdentity: SessionClientIdentity = {
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'player',
  sessionId: SESSION_ID,
  clientId: PLAYER_CLIENT_ID,
  playerId: PLAYER_ID,
  displayName: DISPLAY_NAME,
  rememberedAt: '2026-05-26T10:00:00.000Z',
  lastSeenRevision: REVISION_2,
}

const placement = {
  id: 'token-pikachu',
  sheetKind: 'pokemon' as const,
  sheetSlug: 'pikachu',
  position: { x: 1, y: 0, z: 2 },
}

const makeIdentityStorage = (identity: SessionClientIdentity | null): SessionClientIdentityStorage => ({
  remember: vi.fn(() => true),
  load: vi.fn(() => identity),
  readCookieHint: vi.fn(() => null),
  clear: vi.fn(() => true),
})

const queuedResult = <TMessage>(message: TMessage): SessionSocketSendResult<TMessage> => ({
  ok: true,
  delivery: 'queued',
  queued: {
    sequence: 1,
    enqueuedAt: '2026-05-26T12:00:00.000Z',
    message,
    serialized: JSON.stringify(message),
  },
})

const makeSocket = (overrides: {
  status?: SessionSocketStatus
  helloStatus?: SessionSocketHelloStatus
  lastKnownRevision?: SessionRevision | null
  connect?: () => boolean
  sendHello?: (identity: SessionClientIdentity) => SessionSocketSendResult<SessionClientMessage<MoveTokenCommand>>
  send?: (message: SessionClientMessage<MoveTokenCommand>) => SessionSocketSendResult<SessionClientMessage<MoveTokenCommand>>
} = {}) => {
  const sentMessages: SessionClientMessage<MoveTokenCommand>[] = []
  const helloIdentities: SessionClientIdentity[] = []
  const messageHandlers: Array<(message: SessionServerMessage, raw: string) => void> = []
  const socket: SessionMoveTokenSocket & {
    readonly sentMessages: SessionClientMessage<MoveTokenCommand>[]
    readonly helloIdentities: SessionClientIdentity[]
    readonly messageHandlers: Array<(message: SessionServerMessage, raw: string) => void>
    readonly connect: ReturnType<typeof vi.fn>
    readonly sendHello: ReturnType<typeof vi.fn>
    readonly send: ReturnType<typeof vi.fn>
    readonly addMessageHandler: ReturnType<typeof vi.fn>
  } = {
    status: ref(overrides.status ?? 'idle') as Ref<SessionSocketStatus>,
    helloStatus: ref(overrides.helloStatus ?? 'idle') as Ref<SessionSocketHelloStatus>,
    lastKnownRevision: ref<SessionRevision | null>(
      overrides.lastKnownRevision === undefined ? null : overrides.lastKnownRevision,
    ),
    connect: vi.fn(() => {
      if (overrides.connect !== undefined) return overrides.connect()
      socket.status.value = 'connecting'
      return true
    }),
    sendHello: vi.fn((identity) => {
      if (overrides.sendHello !== undefined) return overrides.sendHello(identity)
      helloIdentities.push(identity)
      socket.helloStatus.value = 'queued'
      return queuedResult({
        schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
        type: 'hello',
        direction: 'client',
        sessionId: identity.sessionId,
        reconnect: false,
        identity: identity.role === 'gm'
          ? { role: 'gm', clientId: identity.clientId, gmKey: identity.gmKey }
          : {
              role: 'player',
              clientId: identity.clientId,
              playerId: identity.playerId,
              displayName: identity.displayName,
            },
      } as SessionClientMessage<MoveTokenCommand>)
    }),
    send: vi.fn((message) => {
      if (overrides.send !== undefined) return overrides.send(message)
      sentMessages.push(message)
      return queuedResult(message)
    }),
    addMessageHandler: vi.fn((handler: (message: SessionServerMessage, raw: string) => void) => {
      messageHandlers.push(handler)
      return () => {
        const index = messageHandlers.indexOf(handler)
        if (index >= 0) messageHandlers.splice(index, 1)
      }
    }),
    sentMessages,
    helloIdentities,
    messageHandlers,
  }
  return socket
}

describe('session moveToken client dispatch', () => {
  it('recognizes explicit route query values for session mode', () => {
    expect(isSessionModeQueryEnabled('1')).toBe(true)
    expect(isSessionModeQueryEnabled('true')).toBe(true)
    expect(isSessionModeQueryEnabled(['0', 'yes'])).toBe(true)
    expect(isSessionModeQueryEnabled('0')).toBe(false)
    expect(isSessionModeQueryEnabled(undefined)).toBe(false)
  })

  it('builds the moveToken command message from remembered GM identity and placement data', () => {
    expect(sessionActorFromClientIdentity(gmIdentity)).toEqual({
      role: 'gm',
      clientId: GM_CLIENT_ID,
    })
    expect(sessionActorFromClientIdentity(playerIdentity)).toEqual({
      role: 'player',
      playerId: PLAYER_ID,
      clientId: PLAYER_CLIENT_ID,
      displayName: DISPLAY_NAME,
    })

    const message = createMoveTokenCommandMessage({
      identity: gmIdentity,
      mapSlug: 'arena-map',
      placement,
      to: { x: 3, y: 0, z: 2 },
      baseRevision: REVISION_4,
      opId: OP_ID,
      now: () => '2026-05-26T12:00:00.000Z',
    })

    expect(message).toEqual({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'command',
      direction: 'client',
      sessionId: SESSION_ID,
      command: {
        schemaVersion: 1,
        type: MOVE_TOKEN_COMMAND_TYPE,
        sessionId: SESSION_ID,
        actor: {
          role: 'gm',
          clientId: GM_CLIENT_ID,
        },
        opId: OP_ID,
        baseRevision: REVISION_4,
        scopes: [
          {
            lane: 'token',
            field: 'position',
            mapSlug: 'arena-map',
            resource: {
              kind: 'token',
              tokenId: 'token-pikachu',
              mapSlug: 'arena-map',
              sheetKind: 'pokemon',
              sheetSlug: 'pikachu',
            },
          },
        ],
        payload: {
          tokenId: 'token-pikachu',
          to: { x: 3, y: 0, z: 2 },
        },
        metadata: {
          clientIssuedAt: '2026-05-26T12:00:00.000Z',
          attributes: {
            source: 'map-scene-token-move',
            mapSlug: 'arena-map',
          },
        },
      },
    })
  })

  it('queues hello before the moveToken command and uses the latest known revision', () => {
    const socket = makeSocket({ lastKnownRevision: REVISION_4 })
    const dispatch = useSessionMoveTokenDispatch({
      enabled: ref(true),
      mapSlug: ref('arena-map'),
      identityStorage: makeIdentityStorage(playerIdentity),
      socket,
      createOpId: () => OP_ID,
      now: () => '2026-05-26T12:00:00.000Z',
    })

    const result = dispatch.dispatchMoveToken({
      placement,
      to: { x: 4, y: 0, z: 2 },
    })

    expect(result.dispatched).toBe(true)
    if (!result.dispatched) throw new Error(result.message)
    expect(socket.connect).toHaveBeenCalledTimes(1)
    expect(socket.sendHello).toHaveBeenCalledWith(playerIdentity)
    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(socket.helloIdentities).toEqual([playerIdentity])
    expect(socket.sentMessages).toEqual([result.message])
    expect(result.command.baseRevision).toBe(REVISION_4)
    expect(result.command.actor).toEqual({
      role: 'player',
      playerId: PLAYER_ID,
      clientId: PLAYER_CLIENT_ID,
      displayName: DISPLAY_NAME,
    })
    expect(result.command.payload.to).toEqual({ x: 4, y: 0, z: 2 })
    expect(dispatch.lastError.value).toBeNull()
  })

  it('applies an optimistic token-position override and confirms it from an accepted ack', () => {
    const socket = makeSocket({ lastKnownRevision: REVISION_2 })
    const dispatch = useSessionMoveTokenDispatch({
      enabled: ref(true),
      mapSlug: ref('arena-map'),
      identityStorage: makeIdentityStorage(playerIdentity),
      socket,
      createOpId: () => OP_ID,
      now: () => '2026-05-26T12:00:00.000Z',
    })

    const result = dispatch.dispatchMoveToken({
      placement,
      to: { x: 4, y: 0, z: 2 },
    })

    expect(result.dispatched).toBe(true)
    if (!result.dispatched) throw new Error(result.message)
    expect(socket.addMessageHandler).toHaveBeenCalledTimes(1)
    expect(dispatch.optimisticMoves.value).toMatchObject([
      {
        opId: OP_ID,
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        from: { x: 1, y: 0, z: 2 },
        to: { x: 4, y: 0, z: 2 },
        position: { x: 4, y: 0, z: 2 },
        status: 'pending',
        baseRevision: REVISION_2,
      },
    ])
    expect(dispatch.tokenPositionOverrides.value).toMatchObject([
      {
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        position: { x: 4, y: 0, z: 2 },
        status: 'pending',
        opId: OP_ID,
      },
    ])

    socket.messageHandlers[0]?.({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandAck',
      direction: 'server',
      sessionId: SESSION_ID,
      result: {
        schemaVersion: 1,
        status: 'accepted',
        accepted: true,
        sessionId: SESSION_ID,
        opId: OP_ID,
        commandType: MOVE_TOKEN_COMMAND_TYPE,
        actor: result.command.actor,
        currentRevision: REVISION_4,
        scopes: result.command.scopes,
        event: {
          eventId: 'event_rev_4',
          eventType: 'tokenMoved',
          revision: REVISION_4,
          commandType: MOVE_TOKEN_COMMAND_TYPE,
          opId: OP_ID,
          actor: result.command.actor,
          scopes: result.command.scopes,
          payload: {
            tokenId: 'token-pikachu',
            mapSlug: 'arena-map',
            from: { x: 1, y: 0, z: 2 },
            to: { x: 4, y: 0, z: 2 },
          },
        },
      },
    } satisfies SessionServerMessage, '')

    expect(dispatch.optimisticMoves.value).toMatchObject([
      {
        opId: OP_ID,
        status: 'confirmed',
        currentRevision: REVISION_4,
        position: { x: 4, y: 0, z: 2 },
      },
    ])
    expect(dispatch.tokenPositionOverrides.value[0]).toMatchObject({
      status: 'confirmed',
      revision: REVISION_4,
      position: { x: 4, y: 0, z: 2 },
    })
    expect(dispatch.lastError.value).toBeNull()
  })

  it('reconciles an optimistic move to current authoritative token state on rejection', () => {
    const socket = makeSocket({ lastKnownRevision: REVISION_2 })
    const dispatch = useSessionMoveTokenDispatch({
      enabled: ref(true),
      mapSlug: 'arena-map',
      identityStorage: makeIdentityStorage(playerIdentity),
      socket,
      createOpId: () => OP_ID,
      now: () => '2026-05-26T12:00:00.000Z',
    })

    const result = dispatch.dispatchMoveToken({ placement, to: { x: 4, y: 0, z: 2 } })
    expect(result.dispatched).toBe(true)
    if (!result.dispatched) throw new Error(result.message)

    dispatch.handleServerMessage({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandReject',
      direction: 'server',
      sessionId: SESSION_ID,
      result: {
        schemaVersion: 1,
        status: 'rejected',
        accepted: false,
        reason: 'stale',
        message: 'Token token-pikachu changed after revision 2.',
        retryable: true,
        sessionId: SESSION_ID,
        opId: OP_ID,
        commandType: MOVE_TOKEN_COMMAND_TYPE,
        actor: result.command.actor,
        currentRevision: REVISION_4,
        baseRevision: REVISION_2,
        scopes: result.command.scopes,
        changedScopes: result.command.scopes,
        currentState: {
          tokenId: 'token-pikachu',
          mapSlug: 'arena-map',
          position: { x: 2, y: 0, z: 2 },
          revision: REVISION_4,
        },
      },
    } satisfies SessionServerMessage)

    expect(dispatch.tokenPositionOverrides.value).toMatchObject([
      {
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        status: 'reconciled',
        position: { x: 2, y: 0, z: 2 },
        revision: REVISION_4,
        message: 'Token token-pikachu changed after revision 2.',
      },
    ])
    expect(dispatch.lastError.value).toBe('Token token-pikachu changed after revision 2.')
    expect(dispatch.lastRejection.value).toMatchObject({
      opId: OP_ID,
      tokenId: 'token-pikachu',
      mapSlug: 'arena-map',
      reason: 'stale',
      currentRevision: REVISION_4,
    })
  })

  it('rolls back an optimistic move when a rejection has no current token state', () => {
    const dispatch = useSessionMoveTokenDispatch({
      enabled: ref(true),
      mapSlug: 'arena-map',
      identityStorage: makeIdentityStorage(playerIdentity),
      socket: makeSocket({ lastKnownRevision: REVISION_2 }),
      createOpId: () => OP_ID,
      now: () => '2026-05-26T12:00:00.000Z',
    })

    const result = dispatch.dispatchMoveToken({ placement, to: { x: 4, y: 0, z: 2 } })
    expect(result.dispatched).toBe(true)
    if (!result.dispatched) throw new Error(result.message)
    expect(dispatch.tokenPositionOverrides.value).toHaveLength(1)

    dispatch.handleServerMessage({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandReject',
      direction: 'server',
      sessionId: SESSION_ID,
      result: {
        schemaVersion: 1,
        status: 'rejected',
        accepted: false,
        reason: 'invalid',
        message: 'moveToken payload is invalid.',
        retryable: false,
        sessionId: SESSION_ID,
        opId: OP_ID,
        commandType: MOVE_TOKEN_COMMAND_TYPE,
        actor: result.command.actor,
        currentRevision: REVISION_2,
        scopes: result.command.scopes,
        issues: [],
      },
    } satisfies SessionServerMessage)

    expect(dispatch.optimisticMoves.value).toEqual([])
    expect(dispatch.tokenPositionOverrides.value).toEqual([])
    expect(dispatch.lastRejection.value).toMatchObject({
      opId: OP_ID,
      reason: 'invalid',
      message: 'moveToken payload is invalid.',
    })
  })

  it('applies authoritative tokenMoved patches as confirmed visual overrides', () => {
    const dispatch = useSessionMoveTokenDispatch({
      enabled: ref(true),
      mapSlug: 'arena-map',
      identityStorage: makeIdentityStorage(playerIdentity),
      socket: makeSocket(),
      now: () => '2026-05-26T12:00:00.000Z',
    })

    dispatch.handleServerMessage({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'patch',
      direction: 'server',
      sessionId: SESSION_ID,
      event: {
        eventId: 'event_rev_4',
        eventType: 'tokenMoved',
        revision: REVISION_4,
        commandType: MOVE_TOKEN_COMMAND_TYPE,
        opId: OP_ID,
        actor: {
          role: 'player',
          playerId: PLAYER_ID,
          clientId: PLAYER_CLIENT_ID,
          displayName: DISPLAY_NAME,
        },
        scopes: [],
        payload: {
          tokenId: 'token-pikachu',
          mapSlug: 'arena-map',
          from: { x: 1, y: 0, z: 2 },
          to: { x: 5, y: 0, z: 2 },
        },
      },
    } satisfies SessionServerMessage)

    expect(dispatch.optimisticMoves.value).toMatchObject([
      {
        opId: OP_ID,
        tokenId: 'token-pikachu',
        mapSlug: 'arena-map',
        status: 'confirmed',
        position: { x: 5, y: 0, z: 2 },
        currentRevision: REVISION_4,
      },
    ])
    expect(dispatch.tokenPositionOverrides.value[0]).toMatchObject({
      tokenId: 'token-pikachu',
      mapSlug: 'arena-map',
      status: 'confirmed',
      revision: REVISION_4,
      position: { x: 5, y: 0, z: 2 },
    })
  })

  it('does not dispatch or connect when session mode is disabled', () => {
    const socket = makeSocket()
    const dispatch = useSessionMoveTokenDispatch({
      enabled: ref(false),
      mapSlug: 'arena-map',
      identityStorage: makeIdentityStorage(playerIdentity),
      socket,
      createOpId: () => OP_ID,
    })

    const result = dispatch.dispatchMoveToken({
      placement,
      to: { x: 4, y: 0, z: 2 },
    })

    expect(result).toMatchObject({ dispatched: false, reason: 'not-session-mode' })
    expect(socket.connect).not.toHaveBeenCalled()
    expect(socket.send).not.toHaveBeenCalled()
  })

  it('fails closed without mutating through local movement when identity or socket setup is missing', () => {
    const missingIdentitySocket = makeSocket()
    const missingIdentityDispatch = useSessionMoveTokenDispatch({
      enabled: ref(true),
      mapSlug: 'arena-map',
      identityStorage: makeIdentityStorage(null),
      socket: missingIdentitySocket,
      createOpId: () => OP_ID,
    })

    expect(missingIdentityDispatch.dispatchMoveToken({ placement, to: { x: 1, y: 0, z: 1 } })).toMatchObject({
      dispatched: false,
      reason: 'missing-session-identity',
    })
    expect(missingIdentitySocket.connect).not.toHaveBeenCalled()

    const unavailableSocket = makeSocket({ connect: () => false })
    const unavailableDispatch = useSessionMoveTokenDispatch({
      enabled: ref(true),
      mapSlug: 'arena-map',
      identityStorage: makeIdentityStorage(playerIdentity),
      socket: unavailableSocket,
      createOpId: () => OP_ID,
    })

    expect(unavailableDispatch.dispatchMoveToken({ placement, to: { x: 1, y: 0, z: 1 } })).toMatchObject({
      dispatched: false,
      reason: 'socket-unavailable',
    })
    expect(unavailableSocket.send).not.toHaveBeenCalled()
  })
})
