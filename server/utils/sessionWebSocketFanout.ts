import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionCommandAckMessage,
  type SessionCommandRejectMessage,
  type SessionCommandResultMessage,
  type SessionPatchEvent,
  type SessionPatchMessage,
  type SessionPresenceChange,
  type SessionPresenceMessage,
  type SessionSnapshotMessage,
} from '#shared/sessionMessages'
import {
  isSessionCommandRejectedResult,
  type SessionCommandAcceptedResult,
  type SessionCommandDuplicateResult,
  type SessionCommandRejectedResult,
} from '#shared/sessionCommandResults'
import type { SessionCommandType } from '#shared/sessionCommands'
import type { SessionId } from '#shared/sessionIdentity'
import type { Revision, SessionRevision } from '#shared/sessionRevisions'
import {
  toSessionPresenceEntries,
  type AuthoritativeSessionState,
} from '#shared/sessionState'
import type {
  AuthenticatedSessionSocketConnection,
  InMemorySessionSocketRegistry,
  SessionSocketConnection,
  SessionSocketPeerLike,
} from './sessionWebSocketServer'

export type SessionFanoutServerMessage<
  TSnapshot = unknown,
  TPatchEventType extends string = string,
  TPatchPayload = unknown,
  TCommandType extends SessionCommandType = SessionCommandType,
  TCommandEvent = unknown,
  TCommandCurrentState = unknown,
  TRevision extends Revision = Revision,
> =
  | SessionCommandResultMessage<TCommandType, TCommandEvent, TCommandCurrentState, TRevision>
  | SessionSnapshotMessage<TSnapshot, TRevision>
  | SessionPatchMessage<TPatchEventType, TPatchPayload, TRevision>
  | SessionPresenceMessage<TRevision>

export type SessionSocketFanoutSkipReason =
  | 'excluded'
  | 'missing-connection'
  | 'not-authenticated'
  | 'cross-session'
  | 'missing-peer'
  | 'send-failed'

export interface SessionSocketFanoutDelivery {
  readonly peerId: string
  readonly sent: boolean
  readonly reason?: SessionSocketFanoutSkipReason
  readonly error?: string
}

export interface SessionSocketFanoutResult<
  TMessage extends SessionFanoutServerMessage = SessionFanoutServerMessage,
> {
  readonly sessionId: SessionId
  readonly message: TMessage
  readonly serialized: string
  readonly deliveries: readonly SessionSocketFanoutDelivery[]
  readonly sentPeerIds: readonly string[]
  readonly skippedPeerIds: readonly string[]
}

export interface InMemorySessionSocketPeerRegistry {
  readonly size: number
  register(peer: SessionSocketPeerLike): void
  unregister(peerId: string): SessionSocketPeerLike | undefined
  get(peerId: string): SessionSocketPeerLike | undefined
  list(): readonly SessionSocketPeerLike[]
  clear(): void
}

export interface FanoutSessionServerMessageDependencies {
  readonly registry: InMemorySessionSocketRegistry
  readonly peers: InMemorySessionSocketPeerRegistry
}

export interface FanoutSessionServerMessageOptions {
  /** Restrict fanout to these peer IDs. Cross-session targets are skipped. */
  readonly targetPeerIds?: readonly string[]
  /** Omit these peer IDs even when they are authenticated in the session. */
  readonly excludePeerIds?: readonly string[]
  readonly serialize?: (message: SessionFanoutServerMessage) => string
}

const comparePeerIds = (left: string, right: string): number => left.localeCompare(right)

const defaultSerializeFanoutMessage = (message: SessionFanoutServerMessage): string => {
  const serialized = JSON.stringify(message)
  if (typeof serialized !== 'string') {
    throw new Error('Session fanout messages must be JSON-serializable')
  }
  return serialized
}

const normalizePeerIdSet = (peerIds: readonly string[] | undefined): Set<string> | undefined => {
  if (peerIds === undefined) return undefined
  return new Set(peerIds.filter((peerId) => peerId.trim().length > 0))
}

const isAuthenticatedConnection = (
  connection: SessionSocketConnection | undefined,
): connection is AuthenticatedSessionSocketConnection =>
  connection !== undefined && connection.status === 'authenticated'

const delivery = (
  peerId: string,
  sent: boolean,
  reason?: SessionSocketFanoutSkipReason,
  error?: string,
): SessionSocketFanoutDelivery => ({
  peerId,
  sent,
  ...(reason === undefined ? {} : { reason }),
  ...(error === undefined ? {} : { error }),
})

const errorMessageFor = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  if (typeof error === 'string' && error.trim().length > 0) return error.trim()
  return 'Session fanout peer send failed.'
}

export const createInMemorySessionSocketPeerRegistry = (): InMemorySessionSocketPeerRegistry => {
  const peersById = new Map<string, SessionSocketPeerLike>()

  return {
    get size() {
      return peersById.size
    },
    register(peer) {
      if (peer.id.trim().length === 0) {
        throw new Error('Session socket peer ID is required')
      }
      peersById.set(peer.id, peer)
    },
    unregister(peerId) {
      const peer = peersById.get(peerId)
      peersById.delete(peerId)
      return peer
    },
    get: (peerId) => peersById.get(peerId),
    list: () => [...peersById.values()].sort((left, right) => comparePeerIds(left.id, right.id)),
    clear: () => peersById.clear(),
  }
}

export const sessionSocketPeers = createInMemorySessionSocketPeerRegistry()

export const createSessionPresenceFanoutMessage = <TMapDocument = unknown>(
  state: AuthoritativeSessionState<TMapDocument>,
  change: SessionPresenceChange,
): SessionPresenceMessage<SessionRevision> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'presence',
  direction: 'server',
  sessionId: state.sessionId,
  change,
  currentRevision: state.revision,
  clients: toSessionPresenceEntries(state as AuthoritativeSessionState),
})

export const createSessionCommandResultFanoutMessage = <
  TType extends SessionCommandType = SessionCommandType,
  TEvent = unknown,
  TCurrentState = unknown,
  TRevision extends Revision = Revision,
>(
  result:
    | SessionCommandAcceptedResult<TType, TEvent, TRevision>
    | SessionCommandDuplicateResult<TType, TRevision>
    | SessionCommandRejectedResult<TType, TCurrentState, TRevision>,
): SessionCommandResultMessage<TType, TEvent, TCurrentState, TRevision> => {
  if (isSessionCommandRejectedResult(result)) {
    return {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandReject',
      direction: 'server',
      sessionId: result.sessionId,
      result,
    } satisfies SessionCommandRejectMessage<TType, TCurrentState, TRevision>
  }

  return {
    schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
    type: 'commandAck',
    direction: 'server',
    sessionId: result.sessionId,
    result,
  } satisfies SessionCommandAckMessage<TType, TEvent, TRevision>
}

export const createSessionPatchFanoutMessage = <
  TEventType extends string = string,
  TPayload = unknown,
  TRevision extends Revision = Revision,
>(
  sessionId: SessionId,
  event: SessionPatchEvent<TEventType, TPayload, TRevision>,
): SessionPatchMessage<TEventType, TPayload, TRevision> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'patch',
  direction: 'server',
  sessionId,
  event,
})

export const createSessionSnapshotFanoutMessage = <
  TSnapshot = unknown,
  TRevision extends Revision = Revision,
>(input: {
  readonly sessionId: SessionId
  readonly reason: SessionSnapshotMessage<TSnapshot, TRevision>['reason']
  readonly currentRevision: TRevision
  readonly snapshot: TSnapshot
  readonly replayAvailable?: boolean
}): SessionSnapshotMessage<TSnapshot, TRevision> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'snapshot',
  direction: 'server',
  sessionId: input.sessionId,
  reason: input.reason,
  currentRevision: input.currentRevision,
  snapshot: input.snapshot,
  ...(input.replayAvailable === undefined ? {} : { replayAvailable: input.replayAvailable }),
})

const sessionConnectionsFor = (
  registry: InMemorySessionSocketRegistry,
  sessionId: SessionId,
): readonly AuthenticatedSessionSocketConnection[] =>
  registry
    .list()
    .filter((connection): connection is AuthenticatedSessionSocketConnection =>
      connection.status === 'authenticated' && connection.sessionId === sessionId,
    )

const targetConnectionsFor = (
  registry: InMemorySessionSocketRegistry,
  sessionId: SessionId,
  targetPeerIds: Set<string> | undefined,
): readonly { readonly peerId: string, readonly connection?: AuthenticatedSessionSocketConnection, readonly reason?: SessionSocketFanoutSkipReason }[] => {
  if (targetPeerIds === undefined) {
    return sessionConnectionsFor(registry, sessionId).map((connection) => ({
      peerId: connection.peerId,
      connection,
    }))
  }

  return [...targetPeerIds]
    .sort(comparePeerIds)
    .map((peerId) => {
      const connection = registry.get(peerId)
      if (connection === undefined) return { peerId, reason: 'missing-connection' }
      if (!isAuthenticatedConnection(connection)) return { peerId, reason: 'not-authenticated' }
      if (connection.sessionId !== sessionId) return { peerId, reason: 'cross-session' }
      return { peerId, connection }
    })
}

export const fanoutSessionServerMessage = <
  TMessage extends SessionFanoutServerMessage,
>(
  message: TMessage,
  dependencies: FanoutSessionServerMessageDependencies,
  options: FanoutSessionServerMessageOptions = {},
): SessionSocketFanoutResult<TMessage> => {
  const serialized = (options.serialize ?? defaultSerializeFanoutMessage)(message)
  const excludedPeerIds = normalizePeerIdSet(options.excludePeerIds) ?? new Set<string>()
  const targetPeerIds = normalizePeerIdSet(options.targetPeerIds)
  const deliveries: SessionSocketFanoutDelivery[] = []

  for (const target of targetConnectionsFor(dependencies.registry, message.sessionId, targetPeerIds)) {
    if (target.reason !== undefined || target.connection === undefined) {
      deliveries.push(delivery(target.peerId, false, target.reason ?? 'missing-connection'))
      continue
    }

    if (excludedPeerIds.has(target.peerId)) {
      deliveries.push(delivery(target.peerId, false, 'excluded'))
      continue
    }

    const peer = dependencies.peers.get(target.peerId)
    if (peer === undefined) {
      deliveries.push(delivery(target.peerId, false, 'missing-peer'))
      continue
    }

    try {
      peer.send(serialized)
      deliveries.push(delivery(target.peerId, true))
    } catch (error) {
      deliveries.push(delivery(target.peerId, false, 'send-failed', errorMessageFor(error)))
    }
  }

  const sentPeerIds = deliveries
    .filter((item) => item.sent)
    .map((item) => item.peerId)
  const skippedPeerIds = deliveries
    .filter((item) => !item.sent)
    .map((item) => item.peerId)

  return {
    sessionId: message.sessionId,
    message,
    serialized,
    deliveries,
    sentPeerIds,
    skippedPeerIds,
  }
}
