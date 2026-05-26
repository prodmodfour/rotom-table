import {
  isClientId,
  isGmKey,
  isPlayerId,
  isSessionDisplayName,
  isSessionId,
  type ClientId,
  type SessionId,
} from '#shared/sessionIdentity'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionClientHelloMessage,
  type SessionErrorCode,
  type SessionErrorDetails,
  type SessionErrorMessage,
  type SessionServerHelloMessage,
} from '#shared/sessionMessages'
import type { SessionActor } from '#shared/sessionPermissions'
import { isSessionRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  findSessionConnectedClient,
  findSessionPlayerRecord,
  upsertSessionConnectedClient,
  type AuthoritativeSessionState,
  type SessionConnectedClientRecord,
} from '#shared/sessionState'
import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
  isSessionHostEnabled,
  type SessionHostRuntimeEnv,
} from './sessionHosting'
import {
  sessionStore,
  type InMemorySessionStore,
  type SessionStoreRecord,
} from './sessionStore'

export const SESSION_SOCKET_DISABLED_STATUS = 403 as const
export const SESSION_SOCKET_UPGRADE_REQUIRED_STATUS = 426 as const
export const SESSION_SOCKET_POLICY_CLOSE_CODE = 1008 as const

export const SESSION_SOCKET_DISABLED_MESSAGE =
  `Track 2 session WebSocket hosting is disabled. Set ${SESSION_HOST_ENABLE_ENV}=${SESSION_HOST_ENABLE_VALUE} to enable the session socket.` as const

export const SESSION_SOCKET_PENDING_HELLO_STATUS = 'pending-hello' as const
export const SESSION_SOCKET_AUTHENTICATED_STATUS = 'authenticated' as const
export const SESSION_SOCKET_HEARTBEAT_INTERVAL_MS = 25_000 as const
export const SESSION_SOCKET_HEARTBEAT_TIMEOUT_MS = 60_000 as const

export type SessionSocketConnectionStatus =
  | typeof SESSION_SOCKET_PENDING_HELLO_STATUS
  | typeof SESSION_SOCKET_AUTHENTICATED_STATUS

export type SessionSocketClock = () => string

export interface SessionSocketPeerLike {
  readonly id: string
  send(data: unknown, options?: { readonly compress?: boolean }): unknown
  close(code?: number, reason?: string): unknown
}

export interface SessionSocketMessageLike {
  text(): string
}

export interface SessionSocketUpgradeRequestLike {
  readonly url: string
  readonly headers: Headers
  readonly context?: Record<string, unknown>
}

export interface SessionSocketCloseDetails {
  readonly code?: number
  readonly reason?: string
}

export interface BaseSessionSocketConnection {
  readonly peerId: string
  readonly status: SessionSocketConnectionStatus
  readonly connectedAt: string
  readonly lastSeenAt: string
}

export interface PendingSessionSocketConnection extends BaseSessionSocketConnection {
  readonly status: typeof SESSION_SOCKET_PENDING_HELLO_STATUS
}

export interface AuthenticatedSessionSocketConnection extends BaseSessionSocketConnection {
  readonly status: typeof SESSION_SOCKET_AUTHENTICATED_STATUS
  readonly sessionId: SessionId
  readonly actor: SessionActor
  readonly authenticatedAt: string
  readonly currentRevision: SessionRevision
  readonly lastSeenRevision?: SessionRevision
}

export type SessionSocketConnection =
  | PendingSessionSocketConnection
  | AuthenticatedSessionSocketConnection

export type ClosedSessionSocketConnection = SessionSocketConnection & {
  readonly closedAt: string
  readonly closeCode?: number
  readonly closeReason?: string
}

export interface AuthenticateSessionSocketConnectionOptions {
  readonly sessionId: SessionId
  readonly actor: SessionActor
  readonly currentRevision: SessionRevision
  readonly authenticatedAt?: string
  readonly lastSeenRevision?: SessionRevision
}

export interface InMemorySessionSocketRegistry {
  readonly size: number
  open(peerId: string, options?: { readonly connectedAt?: string }): PendingSessionSocketConnection
  authenticate(
    peerId: string,
    options: AuthenticateSessionSocketConnectionOptions,
  ): AuthenticatedSessionSocketConnection | undefined
  touch(peerId: string, options?: { readonly lastSeenAt?: string }): SessionSocketConnection | undefined
  close(
    peerId: string,
    details?: SessionSocketCloseDetails & { readonly closedAt?: string },
  ): ClosedSessionSocketConnection | undefined
  get(peerId: string): SessionSocketConnection | undefined
  list(): readonly SessionSocketConnection[]
  clear(): void
}

export interface SessionSocketHandlerDependencies<TMapDocument = unknown> {
  readonly env?: SessionHostRuntimeEnv
  readonly registry?: InMemorySessionSocketRegistry
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>
  readonly clock?: SessionSocketClock
}

type MutablePendingSessionSocketConnection = {
  -readonly [TKey in keyof PendingSessionSocketConnection]: PendingSessionSocketConnection[TKey]
}

type MutableAuthenticatedSessionSocketConnection = {
  -readonly [TKey in keyof AuthenticatedSessionSocketConnection]: AuthenticatedSessionSocketConnection[TKey]
}

type MutableSessionSocketConnection =
  | MutablePendingSessionSocketConnection
  | MutableAuthenticatedSessionSocketConnection

interface ResolvedSessionSocketHandlerDependencies<TMapDocument = unknown> {
  readonly env: SessionHostRuntimeEnv
  readonly registry: InMemorySessionSocketRegistry
  readonly store: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>
  readonly clock: SessionSocketClock
}

interface SessionSocketHandshakeFailure {
  readonly code: SessionErrorCode
  readonly message: string
  readonly retryable: boolean
  readonly sessionId?: SessionId
  readonly currentRevision?: SessionRevision
  readonly details?: SessionErrorDetails
}

interface ParsedSessionSocketHello {
  readonly hello: SessionClientHelloMessage<SessionRevision>
}

type ParseSessionSocketHelloResult =
  | { readonly ok: true; readonly value: ParsedSessionSocketHello }
  | { readonly ok: false; readonly failure: SessionSocketHandshakeFailure }

type SocketSessionRecord<TMapDocument> = SessionStoreRecord<AuthoritativeSessionState<TMapDocument>> & {
  readonly state: AuthoritativeSessionState<TMapDocument>
}

const defaultSessionSocketClock: SessionSocketClock = () => new Date().toISOString()

const cloneActor = (actor: SessionActor): SessionActor => ({ ...actor })

const cloneConnection = (
  connection: MutableSessionSocketConnection,
): SessionSocketConnection => {
  if (connection.status === SESSION_SOCKET_AUTHENTICATED_STATUS) {
    return {
      ...connection,
      actor: cloneActor(connection.actor),
    }
  }

  return { ...connection }
}

const sortConnections = (
  connections: Iterable<MutableSessionSocketConnection>,
): SessionSocketConnection[] =>
  [...connections]
    .sort((left, right) => {
      const connectedComparison = left.connectedAt.localeCompare(right.connectedAt)
      return connectedComparison === 0
        ? left.peerId.localeCompare(right.peerId)
        : connectedComparison
    })
    .map(cloneConnection)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const detailsFromIssues = (
  issues: readonly string[],
): SessionErrorDetails => ({ issues: issues.join('; ') })

const actorsMatch = (left: SessionActor, right: SessionActor): boolean => {
  if (left.role !== right.role) return false
  if (left.clientId !== right.clientId) return false

  if (left.role === 'gm' && right.role === 'gm') return true

  return left.role === 'player' &&
    right.role === 'player' &&
    left.playerId === right.playerId &&
    left.displayName === right.displayName
}

export const createInMemorySessionSocketRegistry = (
  clock: SessionSocketClock = defaultSessionSocketClock,
): InMemorySessionSocketRegistry => {
  const connectionsByPeerId = new Map<string, MutableSessionSocketConnection>()

  const open = (
    peerId: string,
    options: { readonly connectedAt?: string } = {},
  ): PendingSessionSocketConnection => {
    if (peerId.trim().length === 0) {
      throw new Error('Session WebSocket peer ID is required')
    }

    const connectedAt = options.connectedAt ?? clock()
    const connection: MutablePendingSessionSocketConnection = {
      peerId,
      status: SESSION_SOCKET_PENDING_HELLO_STATUS,
      connectedAt,
      lastSeenAt: connectedAt,
    }

    connectionsByPeerId.set(peerId, connection)
    return cloneConnection(connection) as PendingSessionSocketConnection
  }

  const authenticate = (
    peerId: string,
    options: AuthenticateSessionSocketConnectionOptions,
  ): AuthenticatedSessionSocketConnection | undefined => {
    const connection = connectionsByPeerId.get(peerId)
    if (connection === undefined) return undefined

    const authenticatedAt = options.authenticatedAt ?? clock()
    const authenticated: MutableAuthenticatedSessionSocketConnection = {
      peerId,
      status: SESSION_SOCKET_AUTHENTICATED_STATUS,
      connectedAt: connection.connectedAt,
      lastSeenAt: authenticatedAt,
      sessionId: options.sessionId,
      actor: cloneActor(options.actor),
      authenticatedAt,
      currentRevision: options.currentRevision,
      ...(options.lastSeenRevision === undefined
        ? {}
        : { lastSeenRevision: options.lastSeenRevision }),
    }

    connectionsByPeerId.set(peerId, authenticated)
    return cloneConnection(authenticated) as AuthenticatedSessionSocketConnection
  }

  const touch = (
    peerId: string,
    options: { readonly lastSeenAt?: string } = {},
  ): SessionSocketConnection | undefined => {
    const connection = connectionsByPeerId.get(peerId)
    if (connection === undefined) return undefined

    connection.lastSeenAt = options.lastSeenAt ?? clock()
    return cloneConnection(connection)
  }

  const close = (
    peerId: string,
    details: SessionSocketCloseDetails & { readonly closedAt?: string } = {},
  ): ClosedSessionSocketConnection | undefined => {
    const connection = connectionsByPeerId.get(peerId)
    if (connection === undefined) return undefined

    connectionsByPeerId.delete(peerId)
    const closed: ClosedSessionSocketConnection = {
      ...cloneConnection(connection),
      closedAt: details.closedAt ?? clock(),
      ...(details.code === undefined ? {} : { closeCode: details.code }),
      ...(details.reason === undefined ? {} : { closeReason: details.reason }),
    }

    return closed
  }

  return {
    get size() {
      return connectionsByPeerId.size
    },
    open,
    authenticate,
    touch,
    close,
    get: (peerId) => {
      const connection = connectionsByPeerId.get(peerId)
      return connection === undefined ? undefined : cloneConnection(connection)
    },
    list: () => sortConnections(connectionsByPeerId.values()),
    clear: () => connectionsByPeerId.clear(),
  }
}

export const sessionSocketRegistry = createInMemorySessionSocketRegistry()

export const createSessionSocketDisabledResponse = (): Response =>
  new Response(SESSION_SOCKET_DISABLED_MESSAGE, {
    status: SESSION_SOCKET_DISABLED_STATUS,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  })

export const createSessionSocketErrorMessage = (
  input: {
    readonly code: SessionErrorCode
    readonly message: string
    readonly retryable: boolean
    readonly sessionId?: SessionId
    readonly currentRevision?: SessionRevision
    readonly details?: SessionErrorDetails
  },
): SessionErrorMessage<SessionRevision> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'error',
  direction: 'server',
  code: input.code,
  message: input.message,
  retryable: input.retryable,
  ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
  ...(input.currentRevision === undefined ? {} : { currentRevision: input.currentRevision }),
  ...(input.details === undefined ? {} : { details: input.details }),
})

const resolveDependencies = <TMapDocument>(
  dependencies: SessionSocketHandlerDependencies<TMapDocument> = {},
): ResolvedSessionSocketHandlerDependencies<TMapDocument> => ({
  env: dependencies.env ?? process.env,
  registry: dependencies.registry ?? sessionSocketRegistry,
  store: dependencies.store ?? (sessionStore as InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>),
  clock: dependencies.clock ?? defaultSessionSocketClock,
})

const sendJson = (peer: SessionSocketPeerLike, value: unknown): void => {
  peer.send(JSON.stringify(value))
}

const sendSocketError = (
  peer: SessionSocketPeerLike,
  failure: SessionSocketHandshakeFailure,
): void => {
  sendJson(peer, createSessionSocketErrorMessage(failure))
}

const closeForHandshakeFailure = (
  peer: SessionSocketPeerLike,
  failure: SessionSocketHandshakeFailure,
  dependencies: Pick<ResolvedSessionSocketHandlerDependencies, 'registry' | 'clock'>,
): void => {
  sendSocketError(peer, failure)
  peer.close(SESSION_SOCKET_POLICY_CLOSE_CODE, failure.message)
  dependencies.registry.close(peer.id, {
    code: SESSION_SOCKET_POLICY_CLOSE_CODE,
    reason: failure.message,
    closedAt: dependencies.clock(),
  })
}

const parseHelloMessage = (value: unknown): ParseSessionSocketHelloResult => {
  if (!isRecord(value)) {
    return {
      ok: false,
      failure: {
        code: 'malformed-message',
        message: 'Session WebSocket hello must be a JSON object.',
        retryable: false,
      },
    }
  }

  const issues: string[] = []
  if (value.schemaVersion !== SESSION_MESSAGE_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${SESSION_MESSAGE_SCHEMA_VERSION}`)
  }
  if (value.type !== 'hello') issues.push('type must be hello')
  if (value.direction !== 'client') issues.push('direction must be client')
  if (!isSessionId(value.sessionId)) issues.push('sessionId must be a valid SessionId')
  if (typeof value.reconnect !== 'boolean') issues.push('reconnect must be boolean')
  if (value.lastSeenRevision !== undefined && !isSessionRevision(value.lastSeenRevision)) {
    issues.push('lastSeenRevision must be a safe non-negative session revision')
  }

  if (!isRecord(value.identity)) {
    issues.push('identity must be an object')
  } else if (value.identity.role === 'gm') {
    if (!isClientId(value.identity.clientId)) issues.push('identity.clientId must be a valid ClientId')
    if (!isGmKey(value.identity.gmKey)) issues.push('identity.gmKey must be a valid GmKey')
  } else if (value.identity.role === 'player') {
    if (!isClientId(value.identity.clientId)) issues.push('identity.clientId must be a valid ClientId')
    if (!isPlayerId(value.identity.playerId)) issues.push('identity.playerId must be a valid PlayerId')
    if (!isSessionDisplayName(value.identity.displayName)) {
      issues.push('identity.displayName must be a safe session display name')
    }
  } else {
    issues.push('identity.role must be gm or player')
  }

  if (issues.length > 0) {
    return {
      ok: false,
      failure: {
        code: 'malformed-message',
        message: 'Session WebSocket hello is malformed.',
        retryable: false,
        ...(isSessionId(value.sessionId) ? { sessionId: value.sessionId } : {}),
        details: detailsFromIssues(issues),
      },
    }
  }

  return {
    ok: true,
    value: {
      hello: value as unknown as SessionClientHelloMessage<SessionRevision>,
    },
  }
}

const parseSocketMessageJson = (
  message: SessionSocketMessageLike,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly failure: SessionSocketHandshakeFailure } => {
  let text: string
  try {
    text = message.text()
  } catch {
    return {
      ok: false,
      failure: {
        code: 'malformed-message',
        message: 'Session WebSocket messages must be readable text frames.',
        retryable: false,
      },
    }
  }

  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return {
      ok: false,
      failure: {
        code: 'malformed-message',
        message: 'Session WebSocket messages must be valid JSON.',
        retryable: false,
      },
    }
  }
}

const getSocketSessionRecord = <TMapDocument>(
  store: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>,
  sessionId: SessionId,
):
  | { readonly ok: true; readonly record: SocketSessionRecord<TMapDocument> }
  | { readonly ok: false; readonly failure: SessionSocketHandshakeFailure } => {
  const record = store.get(sessionId)
  if (record === undefined) {
    return {
      ok: false,
      failure: {
        code: 'session-not-found',
        message: 'No active Track 2 table session was found for this WebSocket hello.',
        retryable: false,
        sessionId,
      },
    }
  }

  if (record.status !== 'active') {
    return {
      ok: false,
      failure: {
        code: 'session-ended',
        message: 'The Track 2 table session for this WebSocket hello has ended.',
        retryable: false,
        sessionId,
        currentRevision: record.revision,
      },
    }
  }

  if (record.state === undefined) {
    return {
      ok: false,
      failure: {
        code: 'internal-error',
        message: 'The Track 2 table session has no authoritative state for WebSocket hello.',
        retryable: true,
        sessionId,
        currentRevision: record.revision,
      },
    }
  }

  return { ok: true, record: record as SocketSessionRecord<TMapDocument> }
}

const actorFromHello = <TMapDocument>(
  hello: SessionClientHelloMessage<SessionRevision>,
  record: SocketSessionRecord<TMapDocument>,
):
  | { readonly ok: true; readonly actor: SessionActor }
  | { readonly ok: false; readonly failure: SessionSocketHandshakeFailure } => {
  if (hello.identity.role === 'gm') {
    if (record.gmKey !== hello.identity.gmKey) {
      return {
        ok: false,
        failure: {
          code: 'unauthorized',
          message: 'The supplied GM key is not authorized for this Track 2 table session socket.',
          retryable: false,
          sessionId: record.sessionId,
          currentRevision: record.revision,
        },
      }
    }

    return {
      ok: true,
      actor: {
        role: 'gm',
        clientId: hello.identity.clientId,
      },
    }
  }

  const player = findSessionPlayerRecord(record.state.players, hello.identity.playerId)
  if (player === undefined || player.displayName !== hello.identity.displayName) {
    return {
      ok: false,
      failure: {
        code: 'unauthorized',
        message: 'The supplied player identity is not authorized for this Track 2 table session socket.',
        retryable: false,
        sessionId: record.sessionId,
        currentRevision: record.revision,
      },
    }
  }

  return {
    ok: true,
    actor: {
      role: 'player',
      playerId: hello.identity.playerId,
      clientId: hello.identity.clientId,
      displayName: hello.identity.displayName,
    },
  }
}

const assertClientIdNotBoundToDifferentActor = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  actor: SessionActor,
): SessionSocketHandshakeFailure | undefined => {
  const existingClient = findSessionConnectedClient(state.connectedClients, actor.clientId)
  if (existingClient === undefined || actorsMatch(existingClient.actor, actor)) return undefined

  return {
    code: 'unauthorized',
    message: 'The supplied client ID is already associated with a different session actor.',
    retryable: false,
    sessionId: state.sessionId,
    currentRevision: state.revision,
  }
}

const createConnectedClientRecord = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  actor: SessionActor,
  connectedAt: string,
  lastSeenAt: string,
  lastSeenRevision: SessionRevision | undefined,
): SessionConnectedClientRecord => {
  const existingClient = findSessionConnectedClient(state.connectedClients, actor.clientId)

  return {
    clientId: actor.clientId,
    actor: cloneActor(actor),
    status: 'connected',
    connectedAt: existingClient?.connectedAt ?? connectedAt,
    lastSeenAt,
    ...(lastSeenRevision === undefined ? {} : { lastSeenRevision }),
  }
}

const authenticateSocketHello = <TMapDocument>(
  peer: SessionSocketPeerLike,
  hello: SessionClientHelloMessage<SessionRevision>,
  dependencies: ResolvedSessionSocketHandlerDependencies<TMapDocument>,
): SessionServerHelloMessage<SessionRevision> | undefined => {
  const existingConnection = dependencies.registry.get(peer.id)
  if (existingConnection === undefined) {
    closeForHandshakeFailure(peer, {
      code: 'unauthorized',
      message: 'The session WebSocket connection is not registered for hello/auth.',
      retryable: false,
      sessionId: hello.sessionId,
    }, dependencies)
    return undefined
  }

  if (existingConnection.status !== SESSION_SOCKET_PENDING_HELLO_STATUS) {
    closeForHandshakeFailure(peer, {
      code: 'unauthorized',
      message: 'The session WebSocket connection already completed hello/auth.',
      retryable: false,
      sessionId: hello.sessionId,
      currentRevision: existingConnection.currentRevision,
    }, dependencies)
    return undefined
  }

  const recordResult = getSocketSessionRecord(dependencies.store, hello.sessionId)
  if (!recordResult.ok) {
    closeForHandshakeFailure(peer, recordResult.failure, dependencies)
    return undefined
  }

  const actorResult = actorFromHello(hello, recordResult.record)
  if (!actorResult.ok) {
    closeForHandshakeFailure(peer, actorResult.failure, dependencies)
    return undefined
  }

  const actorCollisionFailure = assertClientIdNotBoundToDifferentActor(
    recordResult.record.state,
    actorResult.actor,
  )
  if (actorCollisionFailure !== undefined) {
    closeForHandshakeFailure(peer, actorCollisionFailure, dependencies)
    return undefined
  }

  const authenticatedAt = dependencies.clock()
  const connectedClient = createConnectedClientRecord(
    recordResult.record.state,
    actorResult.actor,
    existingConnection.connectedAt,
    authenticatedAt,
    hello.lastSeenRevision,
  )
  const nextState = upsertSessionConnectedClient(recordResult.record.state, connectedClient, {
    revision: recordResult.record.state.revision,
    updatedAt: authenticatedAt,
  })
  const updatedRecord = dependencies.store.setState(recordResult.record.sessionId, nextState, {
    revision: nextState.revision,
    updatedAt: authenticatedAt,
  })

  if (updatedRecord === undefined) {
    closeForHandshakeFailure(peer, {
      code: 'session-ended',
      message: 'The Track 2 table session ended before WebSocket hello could finish.',
      retryable: false,
      sessionId: recordResult.record.sessionId,
      currentRevision: recordResult.record.revision,
    }, dependencies)
    return undefined
  }

  dependencies.registry.authenticate(peer.id, {
    sessionId: updatedRecord.sessionId,
    actor: actorResult.actor,
    currentRevision: updatedRecord.revision,
    authenticatedAt,
    ...(hello.lastSeenRevision === undefined ? {} : { lastSeenRevision: hello.lastSeenRevision }),
  })

  const serverHello: SessionServerHelloMessage<SessionRevision> = {
    schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
    type: 'hello',
    direction: 'server',
    sessionId: updatedRecord.sessionId,
    actor: actorResult.actor,
    currentRevision: updatedRecord.revision,
    resumed: hello.reconnect,
    heartbeat: {
      intervalMs: SESSION_SOCKET_HEARTBEAT_INTERVAL_MS,
      timeoutMs: SESSION_SOCKET_HEARTBEAT_TIMEOUT_MS,
    },
  }

  sendJson(peer, serverHello)
  return serverHello
}

const markAuthenticatedConnectionDisconnected = <TMapDocument>(
  connection: ClosedSessionSocketConnection,
  dependencies: ResolvedSessionSocketHandlerDependencies<TMapDocument>,
): void => {
  if (connection.status !== SESSION_SOCKET_AUTHENTICATED_STATUS) return

  const record = dependencies.store.get(connection.sessionId)
  if (record?.state === undefined) return

  const existingClient = findSessionConnectedClient(record.state.connectedClients, connection.actor.clientId)
  if (existingClient === undefined || !actorsMatch(existingClient.actor, connection.actor)) return

  const nextClient: SessionConnectedClientRecord = {
    ...existingClient,
    status: 'disconnected',
    lastSeenAt: connection.closedAt,
    disconnectedAt: connection.closedAt,
  }
  const nextState = upsertSessionConnectedClient(record.state, nextClient, {
    revision: record.state.revision,
    updatedAt: connection.closedAt,
  })
  dependencies.store.setState(connection.sessionId, nextState, {
    revision: nextState.revision,
    updatedAt: connection.closedAt,
  })
}

export const handleSessionSocketUpgrade = (
  _request: SessionSocketUpgradeRequestLike,
  dependencies: Pick<SessionSocketHandlerDependencies, 'env'> = {},
): Response | undefined => {
  const env = dependencies.env ?? process.env
  return isSessionHostEnabled(env) ? undefined : createSessionSocketDisabledResponse()
}

export const handleSessionSocketOpen = (
  peer: SessionSocketPeerLike,
  dependencies: SessionSocketHandlerDependencies = {},
): PendingSessionSocketConnection | undefined => {
  const { env, registry, clock } = resolveDependencies(dependencies)
  if (!isSessionHostEnabled(env)) {
    peer.close(SESSION_SOCKET_POLICY_CLOSE_CODE, SESSION_SOCKET_DISABLED_MESSAGE)
    return undefined
  }

  return registry.open(peer.id, { connectedAt: clock() })
}

export const handleSessionSocketMessage = <TMapDocument = unknown>(
  peer: SessionSocketPeerLike,
  message: SessionSocketMessageLike,
  dependencies: SessionSocketHandlerDependencies<TMapDocument> = {},
): void => {
  const resolved = resolveDependencies(dependencies)
  const lastSeenAt = resolved.clock()
  resolved.registry.touch(peer.id, { lastSeenAt })

  const json = parseSocketMessageJson(message)
  if (!json.ok) {
    closeForHandshakeFailure(peer, json.failure, resolved)
    return
  }

  if (!isRecord(json.value) || json.value.type !== 'hello') {
    const existingConnection = resolved.registry.get(peer.id)
    if (existingConnection?.status === SESSION_SOCKET_AUTHENTICATED_STATUS) {
      sendJson(peer, createSessionSocketErrorMessage({
        code: 'unsupported-message',
        message: 'Track 2 session WebSocket hello/auth is complete, but heartbeat and command dispatch land in later transport tickets.',
        retryable: false,
        sessionId: existingConnection.sessionId,
        currentRevision: existingConnection.currentRevision,
      }))
      return
    }

    closeForHandshakeFailure(peer, {
      code: 'unauthorized',
      message: 'A valid Track 2 session WebSocket hello is required before other messages.',
      retryable: false,
    }, resolved)
    return
  }

  const parsedHello = parseHelloMessage(json.value)
  if (!parsedHello.ok) {
    closeForHandshakeFailure(peer, parsedHello.failure, resolved)
    return
  }

  authenticateSocketHello(peer, parsedHello.value.hello, resolved)
}

export const handleSessionSocketClose = <TMapDocument = unknown>(
  peer: SessionSocketPeerLike,
  details: SessionSocketCloseDetails = {},
  dependencies: SessionSocketHandlerDependencies<TMapDocument> = {},
): ClosedSessionSocketConnection | undefined => {
  const resolved = resolveDependencies(dependencies)
  const closed = resolved.registry.close(peer.id, { ...details, closedAt: resolved.clock() })
  if (closed !== undefined) markAuthenticatedConnectionDisconnected(closed, resolved)
  return closed
}

export const handleSessionSocketError = (
  peer: SessionSocketPeerLike,
  _error: unknown,
  dependencies: SessionSocketHandlerDependencies = {},
): void => {
  const { registry, clock } = resolveDependencies(dependencies)
  registry.touch(peer.id, { lastSeenAt: clock() })
}
