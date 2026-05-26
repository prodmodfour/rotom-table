import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionErrorCode,
  type SessionErrorMessage,
} from '#shared/sessionMessages'
import {
  SESSION_HOST_ENABLE_ENV,
  SESSION_HOST_ENABLE_VALUE,
  isSessionHostEnabled,
  type SessionHostRuntimeEnv,
} from './sessionHosting'

export const SESSION_SOCKET_DISABLED_STATUS = 403 as const
export const SESSION_SOCKET_UPGRADE_REQUIRED_STATUS = 426 as const
export const SESSION_SOCKET_POLICY_CLOSE_CODE = 1008 as const

export const SESSION_SOCKET_DISABLED_MESSAGE =
  `Track 2 session WebSocket hosting is disabled. Set ${SESSION_HOST_ENABLE_ENV}=${SESSION_HOST_ENABLE_VALUE} to enable the session socket.` as const

export const SESSION_SOCKET_PENDING_HELLO_STATUS = 'pending-hello' as const
export type SessionSocketConnectionStatus = typeof SESSION_SOCKET_PENDING_HELLO_STATUS

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

export interface PendingSessionSocketConnection {
  readonly peerId: string
  readonly status: SessionSocketConnectionStatus
  readonly connectedAt: string
  readonly lastSeenAt: string
}

export interface ClosedSessionSocketConnection extends PendingSessionSocketConnection {
  readonly closedAt: string
  readonly closeCode?: number
  readonly closeReason?: string
}

export interface InMemorySessionSocketRegistry {
  readonly size: number
  open(peerId: string, options?: { readonly connectedAt?: string }): PendingSessionSocketConnection
  touch(peerId: string, options?: { readonly lastSeenAt?: string }): PendingSessionSocketConnection | undefined
  close(
    peerId: string,
    details?: SessionSocketCloseDetails & { readonly closedAt?: string },
  ): ClosedSessionSocketConnection | undefined
  get(peerId: string): PendingSessionSocketConnection | undefined
  list(): readonly PendingSessionSocketConnection[]
  clear(): void
}

export interface SessionSocketHandlerDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly registry?: InMemorySessionSocketRegistry
  readonly clock?: SessionSocketClock
}

type MutablePendingSessionSocketConnection = {
  -readonly [TKey in keyof PendingSessionSocketConnection]: PendingSessionSocketConnection[TKey]
}

const defaultSessionSocketClock: SessionSocketClock = () => new Date().toISOString()

const cloneConnection = (
  connection: MutablePendingSessionSocketConnection,
): PendingSessionSocketConnection => ({ ...connection })

const sortConnections = (
  connections: Iterable<MutablePendingSessionSocketConnection>,
): PendingSessionSocketConnection[] =>
  [...connections]
    .sort((left, right) => {
      const connectedComparison = left.connectedAt.localeCompare(right.connectedAt)
      return connectedComparison === 0
        ? left.peerId.localeCompare(right.peerId)
        : connectedComparison
    })
    .map(cloneConnection)

export const createInMemorySessionSocketRegistry = (
  clock: SessionSocketClock = defaultSessionSocketClock,
): InMemorySessionSocketRegistry => {
  const connectionsByPeerId = new Map<string, MutablePendingSessionSocketConnection>()

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
    return cloneConnection(connection)
  }

  const touch = (
    peerId: string,
    options: { readonly lastSeenAt?: string } = {},
  ): PendingSessionSocketConnection | undefined => {
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
    }

    if (details.code !== undefined) {
      return { ...closed, closeCode: details.code, closeReason: details.reason }
    }

    if (details.reason !== undefined) {
      return { ...closed, closeReason: details.reason }
    }

    return closed
  }

  return {
    get size() {
      return connectionsByPeerId.size
    },
    open,
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
  },
): SessionErrorMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'error',
  direction: 'server',
  code: input.code,
  message: input.message,
  retryable: input.retryable,
})

const resolveDependencies = (
  dependencies: SessionSocketHandlerDependencies = {},
): Required<SessionSocketHandlerDependencies> => ({
  env: dependencies.env ?? process.env,
  registry: dependencies.registry ?? sessionSocketRegistry,
  clock: dependencies.clock ?? defaultSessionSocketClock,
})

const sendJson = (peer: SessionSocketPeerLike, value: unknown): void => {
  peer.send(JSON.stringify(value))
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

export const handleSessionSocketMessage = (
  peer: SessionSocketPeerLike,
  _message: SessionSocketMessageLike,
  dependencies: SessionSocketHandlerDependencies = {},
): void => {
  const { registry, clock } = resolveDependencies(dependencies)
  registry.touch(peer.id, { lastSeenAt: clock() })
  sendJson(peer, createSessionSocketErrorMessage({
    code: 'unsupported-message',
    message: 'Track 2 session WebSocket is connected, but hello/auth handling lands in a later transport ticket.',
    retryable: false,
  }))
}

export const handleSessionSocketClose = (
  peer: SessionSocketPeerLike,
  details: SessionSocketCloseDetails = {},
  dependencies: SessionSocketHandlerDependencies = {},
): ClosedSessionSocketConnection | undefined => {
  const { registry, clock } = resolveDependencies(dependencies)
  return registry.close(peer.id, { ...details, closedAt: clock() })
}

export const handleSessionSocketError = (
  peer: SessionSocketPeerLike,
  _error: unknown,
  dependencies: SessionSocketHandlerDependencies = {},
): void => {
  const { registry, clock } = resolveDependencies(dependencies)
  registry.touch(peer.id, { lastSeenAt: clock() })
}
