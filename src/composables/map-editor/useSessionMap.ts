import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import {
  updateSessionClientIdentityRevision,
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import type { SessionCommandEnvelope } from '#shared/sessionCommands'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionClientMessage,
  type SessionCommandAckMessage,
  type SessionCommandMessage,
  type SessionCommandRejectMessage,
  type SessionErrorMessage,
  type SessionPresenceMessage,
  type SessionServerMessage,
  type SessionSnapshotMessage,
} from '#shared/sessionMessages'
import { isSessionRevision, type SessionRevision } from '#shared/sessionRevisions'
import type { TabletopMap } from '~/types/map'
import {
  sessionClientIdentityStorage,
  type SessionClientIdentityStorage,
} from '~/utils/sessionClientIdentityStorage'
import {
  useSessionSocket,
  type CreateSessionClientHelloMessageOptions,
  type SessionSocketHeartbeatStatus,
  type SessionSocketHelloStatus,
  type SessionSocketMessageHandler,
  type SessionSocketReconnectStatus,
  type SessionSocketSendResult,
  type SessionSocketStatus,
} from '~/composables/useSessionSocket'
import {
  useSessionMapEditorState,
  type UseSessionMapEditorStateReturn,
} from '~/composables/map-editor/useSessionMapEditorState'

interface BooleanRef {
  readonly value: boolean
}

type MaybeRef<TValue> = TValue | Ref<TValue>

export type SessionMapStatus =
  | 'disabled'
  | 'missing-identity'
  | 'connecting'
  | 'handshaking'
  | 'loading-snapshot'
  | 'ready'
  | 'closed'
  | 'error'
  | 'unavailable'

export type SessionMapSnapshotStatus = 'idle' | 'requested' | 'received' | 'missing-map'

export type SessionMapLoadFailureReason =
  | 'not-session-mode'
  | 'missing-session-identity'
  | 'socket-unavailable'
  | 'hello-failed'

export type SessionMapLoadSnapshotResult =
  | {
      readonly ok: true
      readonly identity: SessionClientIdentity
      readonly delivery: 'already-authenticated' | 'hello-queued' | 'hello-sent'
      readonly helloResult?: Extract<SessionSocketSendResult<SessionClientMessage>, { readonly ok: true }>
    }
  | {
      readonly ok: false
      readonly reason: SessionMapLoadFailureReason
      readonly message: string
    }

export type SessionMapCommandDispatchFailureReason =
  | 'not-session-mode'
  | 'missing-session-identity'
  | 'session-mismatch'
  | 'actor-mismatch'
  | 'socket-unavailable'
  | 'hello-failed'
  | 'send-failed'

export type SessionMapCommandDispatchResult<TCommand extends SessionCommandEnvelope = SessionCommandEnvelope> =
  | {
      readonly dispatched: true
      readonly message: SessionCommandMessage<TCommand>
      readonly sendResult: Extract<SessionSocketSendResult<SessionClientMessage>, { readonly ok: true }>
    }
  | {
      readonly dispatched: false
      readonly reason: SessionMapCommandDispatchFailureReason
      readonly message: string
    }

export interface SessionMapSocket {
  readonly status: Ref<SessionSocketStatus>
  readonly helloStatus: Ref<SessionSocketHelloStatus>
  readonly heartbeatStatus: Ref<SessionSocketHeartbeatStatus>
  readonly reconnectStatus: Ref<SessionSocketReconnectStatus>
  readonly lastError: Ref<string | null>
  readonly lastKnownRevision: Ref<SessionRevision | null>
  readonly lastSnapshot: Ref<SessionSnapshotMessage<unknown, SessionRevision> | null>
  connect(): boolean
  disconnect(code?: number, reason?: string): void
  cleanup(): void
  sendHello(
    identity: SessionClientIdentity,
    helloOptions?: CreateSessionClientHelloMessageOptions,
  ): SessionSocketSendResult<SessionClientMessage>
  send(message: SessionClientMessage): SessionSocketSendResult<SessionClientMessage>
  addMessageHandler(handler: SessionSocketMessageHandler<SessionServerMessage>): () => void
}

export interface UseSessionMapOptions {
  readonly enabled: BooleanRef
  readonly localMap: Ref<TabletopMap | null>
  readonly mapSlug: MaybeRef<string>
  readonly socket?: SessionMapSocket
  readonly identityStorage?: SessionClientIdentityStorage
  readonly now?: () => string
}

export interface UseSessionMapReturn {
  readonly map: Ref<TabletopMap | null>
  readonly localEditableMap: Ref<TabletopMap | null>
  readonly sessionMap: Ref<TabletopMap | null>
  readonly mapState: UseSessionMapEditorStateReturn
  readonly socket: SessionMapSocket
  readonly enabled: ComputedRef<boolean>
  readonly status: ComputedRef<SessionMapStatus>
  readonly snapshotStatus: Ref<SessionMapSnapshotStatus>
  readonly identity: Ref<SessionClientIdentity | null>
  readonly error: ComputedRef<string | null>
  readonly lastError: Ref<string | null>
  readonly lastServerError: Ref<SessionErrorMessage | null>
  readonly lastCommandAck: Ref<SessionCommandAckMessage | null>
  readonly lastCommandReject: Ref<SessionCommandRejectMessage | null>
  readonly lastPresence: Ref<SessionPresenceMessage | null>
  loadRememberedIdentity(): SessionClientIdentity | null
  loadSessionSnapshot(): SessionMapLoadSnapshotResult
  refreshSessionSnapshot(): SessionMapLoadSnapshotResult
  dispatchCommand<TCommand extends SessionCommandEnvelope>(
    command: TCommand,
  ): SessionMapCommandDispatchResult<TCommand>
  handleServerMessage(message: SessionServerMessage): void
  cleanup(): void
}

const defaultClock = (): string => new Date().toISOString()

const readMaybeRef = <TValue>(value: MaybeRef<TValue>): TValue => {
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return (value as Ref<TValue>).value
  }
  return value as TValue
}

const defaultSocket = (): SessionMapSocket => useSessionSocket<SessionClientMessage, SessionServerMessage>()

export const createSessionCommandClientMessage = <TCommand extends SessionCommandEnvelope>(
  command: TCommand,
): SessionCommandMessage<TCommand> => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'command',
  direction: 'client',
  sessionId: command.sessionId,
  command,
})

const isActiveSocketStatus = (status: SessionSocketStatus): boolean =>
  status === 'connecting' || status === 'open'

const isPendingHelloStatus = (helloStatus: SessionSocketHelloStatus): boolean =>
  helloStatus === 'queued' || helloStatus === 'sent'

const snapshotHelloIdentity = (identity: SessionClientIdentity): SessionClientIdentity => {
  const { lastSeenRevision: _lastSeenRevision, ...identityWithoutRevision } = identity
  void _lastSeenRevision
  return identityWithoutRevision as SessionClientIdentity
}

const actorMatchesIdentity = (
  command: Pick<SessionCommandEnvelope, 'actor'>,
  identity: SessionClientIdentity,
): boolean => {
  const actor = command.actor
  if (actor.clientId !== identity.clientId || actor.role !== identity.role) return false
  if (identity.role === 'gm') return actor.role === 'gm'
  return actor.role === 'player' && actor.playerId === identity.playerId
}

const asSessionRevisionOrNull = (revision: unknown): SessionRevision | null =>
  isSessionRevision(revision) ? revision : null

const revisionFromServerMessage = (message: SessionServerMessage): SessionRevision | null => {
  if (message.type === 'hello') return asSessionRevisionOrNull(message.currentRevision)
  if (message.type === 'snapshot') return asSessionRevisionOrNull(message.currentRevision)
  if (message.type === 'presence') return asSessionRevisionOrNull(message.currentRevision)
  if (message.type === 'patch') return asSessionRevisionOrNull(message.event.revision)
  if (message.type === 'commandAck' || message.type === 'commandReject') {
    return asSessionRevisionOrNull(message.result.currentRevision)
  }
  if (message.type === 'error') return asSessionRevisionOrNull(message.currentRevision)
  return asSessionRevisionOrNull(message.lastSeenRevision)
}

export const useSessionMap = (options: UseSessionMapOptions): UseSessionMapReturn => {
  const identityStorage = options.identityStorage ?? sessionClientIdentityStorage
  const now = options.now ?? defaultClock
  const enabled = computed(() => options.enabled.value)
  const socket = options.socket ?? defaultSocket()

  const identity = ref<SessionClientIdentity | null>(identityStorage.load())
  const lastError = ref<string | null>(null)
  const lastServerError = ref<SessionErrorMessage | null>(null)
  const lastCommandAck = ref<SessionCommandAckMessage | null>(null)
  const lastCommandReject = ref<SessionCommandRejectMessage | null>(null)
  const lastPresence = ref<SessionPresenceMessage | null>(null)
  const snapshotStatus = ref<SessionMapSnapshotStatus>('idle')

  const mapState = useSessionMapEditorState({
    enabled,
    localMap: options.localMap,
    mapSlug: options.mapSlug,
    socket,
  })

  const rememberRevision = (revision: SessionRevision | null): void => {
    if (revision === null || identity.value === null) return
    const nextIdentity = updateSessionClientIdentityRevision(identity.value, revision, now())
    identity.value = nextIdentity
    identityStorage.remember(nextIdentity)
  }

  const loadRememberedIdentity = (): SessionClientIdentity | null => {
    identity.value = identityStorage.load()
    return identity.value
  }

  const failLoad = (
    reason: SessionMapLoadFailureReason,
    message: string,
  ): Extract<SessionMapLoadSnapshotResult, { readonly ok: false }> => {
    lastError.value = message
    return { ok: false, reason, message }
  }

  const ensureHelloForSession = (): SessionMapLoadSnapshotResult => {
    if (!enabled.value) {
      return failLoad('not-session-mode', 'Session map sync is not enabled for this map view.')
    }

    const currentIdentity = identity.value ?? loadRememberedIdentity()
    if (currentIdentity === null) {
      return failLoad(
        'missing-session-identity',
        'No remembered live session identity was found; open the session lobby and start or join a session first.',
      )
    }

    if (!socket.connect()) {
      return failLoad('socket-unavailable', socket.lastError.value ?? 'Session socket is not available.')
    }

    if (socket.helloStatus.value === 'accepted' && socket.status.value === 'open') {
      lastError.value = null
      return { ok: true, identity: currentIdentity, delivery: 'already-authenticated' }
    }

    if (isPendingHelloStatus(socket.helloStatus.value) && isActiveSocketStatus(socket.status.value)) {
      lastError.value = null
      return { ok: true, identity: currentIdentity, delivery: 'hello-queued' }
    }

    const helloResult = socket.sendHello(snapshotHelloIdentity(currentIdentity), {
      reconnect: true,
    })
    if (!helloResult.ok) return failLoad('hello-failed', helloResult.message)

    snapshotStatus.value = 'requested'
    lastError.value = null
    return {
      ok: true,
      identity: currentIdentity,
      delivery: helloResult.delivery === 'queued' ? 'hello-queued' : 'hello-sent',
      helloResult,
    }
  }

  const loadSessionSnapshot = (): SessionMapLoadSnapshotResult => ensureHelloForSession()

  const refreshSessionSnapshot = (): SessionMapLoadSnapshotResult => {
    if (!enabled.value) {
      return failLoad('not-session-mode', 'Session map sync is not enabled for this map view.')
    }

    const currentIdentity = identity.value ?? loadRememberedIdentity()
    if (currentIdentity === null) {
      return failLoad(
        'missing-session-identity',
        'No remembered live session identity was found; open the session lobby and start or join a session first.',
      )
    }

    socket.cleanup()
    return ensureHelloForSession()
  }

  const failDispatch = (
    reason: SessionMapCommandDispatchFailureReason,
    message: string,
  ): Extract<SessionMapCommandDispatchResult, { readonly dispatched: false }> => {
    lastError.value = message
    return { dispatched: false, reason, message }
  }

  const dispatchCommand = <TCommand extends SessionCommandEnvelope>(
    command: TCommand,
  ): SessionMapCommandDispatchResult<TCommand> => {
    if (!enabled.value) {
      return failDispatch('not-session-mode', 'Session command dispatch is not enabled for this map view.')
    }

    const currentIdentity = identity.value ?? loadRememberedIdentity()
    if (currentIdentity === null) {
      return failDispatch(
        'missing-session-identity',
        'No remembered live session identity was found; open the session lobby and start or join a session first.',
      )
    }

    if (command.sessionId !== currentIdentity.sessionId) {
      return failDispatch('session-mismatch', 'Cannot dispatch a command for a different live session.')
    }

    if (!actorMatchesIdentity(command, currentIdentity)) {
      return failDispatch('actor-mismatch', 'Cannot dispatch a session command for a different session actor.')
    }

    const helloResult = ensureHelloForSession()
    if (!helloResult.ok) {
      return failDispatch(
        helloResult.reason === 'hello-failed' ? 'hello-failed' : helloResult.reason,
        helloResult.message,
      )
    }

    const message = createSessionCommandClientMessage(command)
    const sendResult = socket.send(message as SessionClientMessage)
    if (!sendResult.ok) return failDispatch('send-failed', sendResult.message)

    lastError.value = null
    return { dispatched: true, message, sendResult }
  }

  const recordServerMessage = (message: SessionServerMessage): void => {
    const revision = revisionFromServerMessage(message)
    rememberRevision(revision)

    if (message.type === 'snapshot') {
      snapshotStatus.value = mapState.lastIgnoredMessage.value === null ? 'received' : 'missing-map'
      if (mapState.lastIgnoredMessage.value !== null) lastError.value = mapState.lastIgnoredMessage.value
      return
    }

    if (message.type === 'commandAck') {
      lastCommandAck.value = message
      lastCommandReject.value = null
      lastServerError.value = null
      lastError.value = null
      return
    }

    if (message.type === 'commandReject') {
      lastCommandReject.value = message
      lastCommandAck.value = null
      lastError.value = message.result.message
      return
    }

    if (message.type === 'presence') {
      lastPresence.value = message
      return
    }

    if (message.type === 'error') {
      lastServerError.value = message
      lastError.value = message.message
    }
  }

  const handleServerMessage = (message: SessionServerMessage): void => {
    mapState.handleServerMessage(message)
    recordServerMessage(message)
  }

  const removeMessageHandler = socket.addMessageHandler(recordServerMessage)

  const status = computed<SessionMapStatus>(() => {
    if (!enabled.value) return 'disabled'
    if (lastServerError.value !== null || socket.status.value === 'error') return 'error'
    if (identity.value === null) return 'missing-identity'
    if (socket.status.value === 'unavailable') return 'unavailable'
    if (socket.status.value === 'connecting') return 'connecting'
    if (isPendingHelloStatus(socket.helloStatus.value)) return 'handshaking'
    if (socket.reconnectStatus.value === 'snapshot-required' || snapshotStatus.value === 'requested') {
      return mapState.hasAuthoritativeSessionState.value ? 'ready' : 'loading-snapshot'
    }
    if (socket.helloStatus.value === 'accepted') {
      return mapState.hasAuthoritativeSessionState.value ? 'ready' : 'loading-snapshot'
    }
    if (socket.status.value === 'closed' || socket.status.value === 'idle' || socket.status.value === 'closing') {
      return mapState.hasAuthoritativeSessionState.value ? 'ready' : 'closed'
    }
    return 'ready'
  })

  const error = computed(() => lastError.value ?? socket.lastError.value)

  const cleanup = (): void => {
    removeMessageHandler()
    socket.cleanup()
  }

  watch(
    () => [enabled.value, readMaybeRef(options.mapSlug)] as const,
    () => {
      lastError.value = null
      lastServerError.value = null
      lastCommandAck.value = null
      lastCommandReject.value = null
      lastPresence.value = null
      snapshotStatus.value = 'idle'
    },
  )

  return {
    map: mapState.map,
    localEditableMap: mapState.localEditableMap,
    sessionMap: mapState.sessionMap,
    mapState,
    socket,
    enabled,
    status,
    snapshotStatus,
    identity,
    error,
    lastError,
    lastServerError,
    lastCommandAck,
    lastCommandReject,
    lastPresence,
    loadRememberedIdentity,
    loadSessionSnapshot,
    refreshSessionSnapshot,
    dispatchCommand,
    handleServerMessage,
    cleanup,
  }
}
