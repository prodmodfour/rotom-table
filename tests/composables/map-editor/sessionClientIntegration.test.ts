import { effectScope, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import { parseOpId } from '#shared/sessionCommands'
import { SESSION_COMMAND_RESULT_SCHEMA_VERSION } from '#shared/sessionCommandResults'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionClientMessage,
  type SessionServerMessage,
  type SessionSnapshotMessage,
} from '#shared/sessionMessages'
import {
  parseClientId,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import {
  parseMapRevision,
  parseSessionRevision,
  type SessionRevision,
} from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
} from '#shared/sessionState'
import {
  MOVE_TOKEN_COMMAND_TYPE,
  type MoveTokenCommand,
} from '#shared/sessionTokenCommands'
import {
  createSessionClientHelloMessage,
  type CreateSessionClientHelloMessageOptions,
  type SessionSocketHeartbeatStatus,
  type SessionSocketHelloStatus,
  type SessionSocketMessageHandler,
  type SessionSocketReconnectStatus,
  type SessionSocketSendResult,
  type SessionSocketStatus,
} from '~/composables/useSessionSocket'
import {
  useSessionMap,
  type SessionMapSocket,
  type UseSessionMapReturn,
} from '~/composables/map-editor/useSessionMap'
import {
  useSessionMoveTokenDispatch,
  type SessionMoveTokenSocket,
} from '~/composables/map-editor/useSessionMoveTokenDispatch'
import type { TabletopMap } from '~/types/map'
import type { SessionClientIdentityStorage } from '~/utils/sessionClientIdentityStorage'

const SESSION_ID = parseSessionId('session_abcdefghijkl')
const PLAYER_CLIENT_ID = parseClientId('client_player01')
const PLAYER_ID = parsePlayerId('player_misty001')
const DISPLAY_NAME = parseSessionDisplayName('Misty')
const OP_ID = parseOpId('op_12345678')
const REVISION_0 = parseSessionRevision(0)
const REVISION_1 = parseSessionRevision(1)
const REVISION_2 = parseSessionRevision(2)
const REVISION_3 = parseSessionRevision(3)
const MAP_REVISION_1 = parseMapRevision(1)

const playerIdentity: Extract<SessionClientIdentity, { role: 'player' }> = {
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'player',
  sessionId: SESSION_ID,
  clientId: PLAYER_CLIENT_ID,
  playerId: PLAYER_ID,
  displayName: DISPLAY_NAME,
  rememberedAt: '2026-05-26T12:00:00.000Z',
  lastSeenRevision: REVISION_0,
}

const playerActor = {
  role: 'player' as const,
  playerId: PLAYER_ID,
  clientId: PLAYER_CLIENT_ID,
  displayName: DISPLAY_NAME,
}

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 6, y: 2, z: 6 },
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
      position: { x: 0, y: 0, z: 0 },
      facing: 'south-east',
      turned: false,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  updatedAt: 100,
  ...overrides,
})

const createStorage = (initial: SessionClientIdentity | null): SessionClientIdentityStorage => ({
  remember: vi.fn(() => true),
  load: vi.fn(() => initial),
  readCookieHint: vi.fn(() => null),
  clear: vi.fn(() => true),
})

const queuedResult = <TMessage>(
  message: TMessage,
  sequence: number,
): Extract<SessionSocketSendResult<TMessage>, { readonly ok: true }> => ({
    ok: true,
    delivery: 'queued',
    queued: {
      sequence,
      enqueuedAt: '2026-05-26T12:00:01.000Z',
      message,
      serialized: JSON.stringify(message),
    },
  })

class SharedClientSessionSocket implements SessionMapSocket {
  readonly status = ref<SessionSocketStatus>('idle')
  readonly helloStatus = ref<SessionSocketHelloStatus>('idle')
  readonly heartbeatStatus = ref<SessionSocketHeartbeatStatus>('idle')
  readonly reconnectStatus = ref<SessionSocketReconnectStatus>('idle')
  readonly lastError = ref<string | null>(null)
  readonly lastKnownRevision = ref<SessionRevision | null>(null)
  readonly lastSnapshot = ref<SessionSnapshotMessage<unknown, SessionRevision> | null>(null)
  readonly handlers: SessionSocketMessageHandler<SessionServerMessage>[] = []
  readonly sentHellos: Array<{
    readonly identity: SessionClientIdentity
    readonly options: CreateSessionClientHelloMessageOptions | undefined
  }> = []
  readonly sentMessages: SessionClientMessage[] = []
  cleanupCount = 0

  connect(): boolean {
    if (this.status.value === 'idle' || this.status.value === 'closed') this.status.value = 'connecting'
    return true
  }

  disconnect(): void {
    this.status.value = 'closed'
  }

  cleanup(): void {
    this.cleanupCount += 1
    this.status.value = 'closed'
    this.helloStatus.value = 'idle'
  }

  sendHello(
    identity: SessionClientIdentity,
    options?: CreateSessionClientHelloMessageOptions,
  ): SessionSocketSendResult<SessionClientMessage> {
    this.sentHellos.push({ identity, options })
    this.helloStatus.value = 'queued'
    return queuedResult(createSessionClientHelloMessage(identity, options), this.sentHellos.length)
  }

  send(message: SessionClientMessage): SessionSocketSendResult<SessionClientMessage> {
    this.sentMessages.push(message)
    return queuedResult(message, this.sentMessages.length)
  }

  addMessageHandler(handler: SessionSocketMessageHandler<SessionServerMessage>): () => void {
    this.handlers.push(handler)
    return () => {
      const index = this.handlers.indexOf(handler)
      if (index >= 0) this.handlers.splice(index, 1)
    }
  }

  emit(message: SessionServerMessage): void {
    if (message.type === 'hello') {
      this.status.value = 'open'
      this.helloStatus.value = 'accepted'
      this.lastKnownRevision.value = message.currentRevision as SessionRevision
      this.reconnectStatus.value = message.snapshotRequired ? 'snapshot-required' : 'resumed'
    } else if (message.type === 'snapshot') {
      this.lastSnapshot.value = message as SessionSnapshotMessage<unknown, SessionRevision>
      this.lastKnownRevision.value = message.currentRevision as SessionRevision
      this.reconnectStatus.value = 'snapshot-received'
    } else if (message.type === 'patch') {
      this.lastKnownRevision.value = message.event.revision as SessionRevision
    } else if (message.type === 'commandAck' || message.type === 'commandReject') {
      this.lastKnownRevision.value = message.result.currentRevision as SessionRevision
    } else if (message.type === 'presence') {
      this.lastKnownRevision.value = message.currentRevision as SessionRevision
    } else if (message.type === 'error' && message.currentRevision !== undefined) {
      this.lastKnownRevision.value = message.currentRevision as SessionRevision
    }

    for (const handler of [...this.handlers]) handler(message, JSON.stringify(message))
  }
}

const serverHelloMessage = (snapshotRequired = true): SessionServerMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'server',
  sessionId: SESSION_ID,
  actor: playerActor,
  currentRevision: REVISION_1,
  resumed: false,
  snapshotRequired,
  heartbeat: {
    intervalMs: 25000,
    timeoutMs: 60000,
  },
})

const snapshotMessage = (document: TabletopMap): SessionServerMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'snapshot',
  direction: 'server',
  sessionId: SESSION_ID,
  reason: 'reconnect',
  currentRevision: REVISION_2,
  replayAvailable: false,
  snapshot: createAuthoritativeSessionState({
    sessionId: SESSION_ID,
    revision: REVISION_2,
    selectedMapSlug: 'arena-map',
    maps: [createAuthoritativeSessionMapState({
      mapSlug: 'arena-map',
      revision: MAP_REVISION_1,
      document,
    })],
    players: [{
      playerId: PLAYER_ID,
      displayName: DISPLAY_NAME,
      joinedAt: '2026-05-26T12:00:00.000Z',
      updatedAt: '2026-05-26T12:00:00.000Z',
    }],
    createdAt: '2026-05-26T12:00:00.000Z',
  }),
})

const tokenMovedEvent = (
  command: MoveTokenCommand,
  revision = REVISION_3,
  to = command.payload.to,
): Extract<SessionServerMessage, { type: 'patch' }>['event'] => ({
    eventId: 'event_rev_3',
    eventType: 'tokenMoved',
    revision,
    commandType: MOVE_TOKEN_COMMAND_TYPE,
    opId: command.opId,
    actor: command.actor,
    scopes: command.scopes,
    payload: {
      tokenId: command.payload.tokenId,
      mapSlug: 'arena-map',
      from: { x: 1, y: 0, z: 1 },
      to,
    },
  })

const commandAckMessage = (command: MoveTokenCommand): SessionServerMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'commandAck',
  direction: 'server',
  sessionId: SESSION_ID,
  result: {
    schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
    status: 'accepted',
    accepted: true,
    sessionId: SESSION_ID,
    opId: command.opId,
    commandType: MOVE_TOKEN_COMMAND_TYPE,
    actor: command.actor,
    currentRevision: REVISION_3,
    scopes: command.scopes,
    event: tokenMovedEvent(command),
  },
})

const commandRejectMessage = (command: MoveTokenCommand): SessionServerMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'commandReject',
  direction: 'server',
  sessionId: SESSION_ID,
  result: {
    schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
    status: 'rejected',
    accepted: false,
    reason: 'stale',
    message: 'Token token-pikachu changed after revision 2.',
    retryable: true,
    sessionId: SESSION_ID,
    opId: command.opId,
    commandType: MOVE_TOKEN_COMMAND_TYPE,
    actor: command.actor,
    currentRevision: REVISION_3,
    baseRevision: command.baseRevision,
    scopes: command.scopes,
    changedScopes: command.scopes,
    currentState: {
      tokenId: command.payload.tokenId,
      mapSlug: 'arena-map',
      position: { x: 2, y: 0, z: 2 },
      revision: REVISION_3,
    },
  },
})

const createHarness = () => {
  const enabled = ref(true)
  const mapSlug = ref('arena-map')
  const localMap = ref(mapFixture())
  const storage = createStorage(playerIdentity)
  const socket = new SharedClientSessionSocket()
  const scope = effectScope()
  let sessionMap: UseSessionMapReturn | undefined
  let dispatcher: ReturnType<typeof useSessionMoveTokenDispatch> | undefined

  scope.run(() => {
    sessionMap = useSessionMap({
      enabled,
      localMap,
      mapSlug,
      identityStorage: storage,
      socket,
      now: () => '2026-05-26T12:05:00.000Z',
    })
    dispatcher = useSessionMoveTokenDispatch({
      enabled,
      mapSlug,
      identityStorage: storage,
      socket: socket as unknown as SessionMoveTokenSocket,
      createOpId: () => OP_ID,
      now: () => '2026-05-26T12:05:00.000Z',
    })
  })

  if (sessionMap === undefined || dispatcher === undefined) {
    throw new Error('failed to create session client harness')
  }

  return { enabled, mapSlug, localMap, storage, socket, scope, sessionMap, dispatcher }
}

describe('client-side Track 2 session integration', () => {
  it('loads a reconnect snapshot, dispatches moveToken, and confirms optimistic state from ack plus patch', () => {
    const { localMap, storage, socket, scope, sessionMap, dispatcher } = createHarness()

    const loadResult = sessionMap.loadSessionSnapshot()
    expect(loadResult).toMatchObject({ ok: true, delivery: 'hello-queued' })
    expect(socket.sentHellos).toHaveLength(1)
    expect(socket.sentHellos[0]?.options).toEqual({ reconnect: true })
    expect(socket.sentHellos[0]?.identity).not.toHaveProperty('lastSeenRevision')

    socket.emit(serverHelloMessage(true))
    expect(sessionMap.status.value).toBe('loading-snapshot')

    socket.emit(snapshotMessage(mapFixture({
      name: 'Authoritative Arena',
      placements: [{
        id: 'token-pikachu',
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
        position: { x: 1, y: 0, z: 1 },
        facing: 'south-east',
        turned: false,
      }],
    })))

    expect(sessionMap.status.value).toBe('ready')
    expect(sessionMap.snapshotStatus.value).toBe('received')
    expect(sessionMap.map.value?.name).toBe('Authoritative Arena')
    expect(sessionMap.map.value?.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })
    expect(localMap.value.placements[0]?.position).toEqual({ x: 0, y: 0, z: 0 })

    const result = dispatcher.dispatchMoveToken({
      placement: sessionMap.map.value?.placements[0],
      to: { x: 3, y: 0, z: 3 },
    })

    expect(result.dispatched).toBe(true)
    if (!result.dispatched) throw new Error(result.message)
    expect(socket.sentHellos).toHaveLength(1)
    expect(socket.sentMessages).toEqual([result.message])
    expect(result.command.baseRevision).toBe(REVISION_2)
    expect(dispatcher.tokenPositionOverrides.value).toMatchObject([{
      tokenId: 'token-pikachu',
      mapSlug: 'arena-map',
      position: { x: 3, y: 0, z: 3 },
      status: 'pending',
      opId: OP_ID,
    }])

    socket.emit(commandAckMessage(result.command))

    expect(sessionMap.lastCommandAck.value?.result.opId).toBe(OP_ID)
    expect(sessionMap.lastCommandReject.value).toBeNull()
    expect(dispatcher.tokenPositionOverrides.value).toMatchObject([{
      tokenId: 'token-pikachu',
      mapSlug: 'arena-map',
      position: { x: 3, y: 0, z: 3 },
      status: 'confirmed',
      revision: REVISION_3,
    }])
    expect(storage.remember).toHaveBeenLastCalledWith({
      ...playerIdentity,
      rememberedAt: '2026-05-26T12:05:00.000Z',
      lastSeenRevision: REVISION_3,
    })

    socket.emit({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'patch',
      direction: 'server',
      sessionId: SESSION_ID,
      event: tokenMovedEvent(result.command),
    } satisfies SessionServerMessage)

    expect(sessionMap.map.value?.placements[0]?.position).toEqual({ x: 3, y: 0, z: 3 })
    expect(localMap.value.placements[0]?.position).toEqual({ x: 0, y: 0, z: 0 })

    sessionMap.cleanup()
    scope.stop()
  })

  it('surfaces stale command rejection and reconciles only the optimistic overlay to current token state', () => {
    const { localMap, socket, scope, sessionMap, dispatcher } = createHarness()

    sessionMap.loadSessionSnapshot()
    socket.emit(serverHelloMessage(false))
    socket.emit(snapshotMessage(mapFixture({
      placements: [{
        id: 'token-pikachu',
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
        position: { x: 1, y: 0, z: 1 },
      }],
    })))

    const result = dispatcher.dispatchMoveToken({
      placement: sessionMap.map.value?.placements[0],
      to: { x: 4, y: 0, z: 4 },
    })
    expect(result.dispatched).toBe(true)
    if (!result.dispatched) throw new Error(result.message)

    socket.emit(commandRejectMessage(result.command))

    expect(sessionMap.lastCommandReject.value?.result.reason).toBe('stale')
    expect(sessionMap.error.value).toBe('Token token-pikachu changed after revision 2.')
    expect(dispatcher.lastRejection.value).toMatchObject({
      opId: OP_ID,
      tokenId: 'token-pikachu',
      mapSlug: 'arena-map',
      reason: 'stale',
      currentRevision: REVISION_3,
    })
    expect(dispatcher.tokenPositionOverrides.value).toMatchObject([{
      tokenId: 'token-pikachu',
      mapSlug: 'arena-map',
      status: 'reconciled',
      position: { x: 2, y: 0, z: 2 },
      revision: REVISION_3,
      message: 'Token token-pikachu changed after revision 2.',
    }])
    expect(sessionMap.map.value?.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })
    expect(localMap.value.placements[0]?.position).toEqual({ x: 0, y: 0, z: 0 })

    sessionMap.cleanup()
    scope.stop()
  })

  it('refreshes reconnect state and removes client handlers during explicit cleanup plus scope disposal', () => {
    const { socket, scope, sessionMap, dispatcher } = createHarness()

    expect(socket.handlers).toHaveLength(3)
    sessionMap.loadSessionSnapshot()
    socket.emit(serverHelloMessage(true))

    const refreshResult = sessionMap.refreshSessionSnapshot()

    expect(refreshResult).toMatchObject({ ok: true, delivery: 'hello-queued' })
    expect(socket.cleanupCount).toBe(1)
    expect(socket.sentHellos).toHaveLength(2)
    expect(socket.sentHellos[1]?.options).toEqual({ reconnect: true })

    sessionMap.cleanup()
    expect(socket.cleanupCount).toBe(2)
    expect(socket.handlers).toHaveLength(2)

    scope.stop()
    expect(socket.handlers).toHaveLength(0)

    socket.emit({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'patch',
      direction: 'server',
      sessionId: SESSION_ID,
      event: {
        eventId: 'event_after_cleanup',
        eventType: 'tokenMoved',
        revision: REVISION_3,
        commandType: MOVE_TOKEN_COMMAND_TYPE,
        opId: OP_ID,
        actor: playerActor,
        scopes: [],
        payload: {
          tokenId: 'token-pikachu',
          mapSlug: 'arena-map',
          from: { x: 0, y: 0, z: 0 },
          to: { x: 5, y: 0, z: 5 },
        },
      },
    } satisfies SessionServerMessage)

    expect(dispatcher.tokenPositionOverrides.value).toEqual([])
    expect(sessionMap.map.value?.placements[0]?.position).toEqual({ x: 0, y: 0, z: 0 })
  })
})
