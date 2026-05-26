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
  const socket: SessionMoveTokenSocket & {
    readonly sentMessages: SessionClientMessage<MoveTokenCommand>[]
    readonly helloIdentities: SessionClientIdentity[]
    readonly connect: ReturnType<typeof vi.fn>
    readonly sendHello: ReturnType<typeof vi.fn>
    readonly send: ReturnType<typeof vi.fn>
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
    sentMessages,
    helloIdentities,
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
