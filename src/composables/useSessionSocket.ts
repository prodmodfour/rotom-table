import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'
import type { SessionClientIdentity } from '#shared/sessionClientIdentity'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionClientHelloMessage,
  type SessionClientMessage,
  type SessionServerHelloMessage,
  type SessionServerMessage,
} from '#shared/sessionMessages'
import type { SessionRevision } from '#shared/sessionRevisions'
import { SESSION_API_PATHS } from '~/utils/apiRoutes'

export const SESSION_SOCKET_READY_STATE_CONNECTING = 0 as const
export const SESSION_SOCKET_READY_STATE_OPEN = 1 as const
export const SESSION_SOCKET_READY_STATE_CLOSING = 2 as const
export const SESSION_SOCKET_READY_STATE_CLOSED = 3 as const
export const SESSION_SOCKET_DEFAULT_MAX_QUEUE_SIZE = 100 as const

export type SessionSocketStatus =
  | 'idle'
  | 'unavailable'
  | 'connecting'
  | 'open'
  | 'closing'
  | 'closed'
  | 'error'

export interface SessionSocketLocationLike {
  readonly protocol: string
  readonly host: string
  readonly href?: string
}

export interface SessionSocketMessageEventLike {
  readonly data: unknown
}

export interface SessionSocketCloseEventLike {
  readonly code?: number
  readonly reason?: string
  readonly wasClean?: boolean
}

export interface SessionSocketLike {
  readonly readyState?: number
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: SessionSocketMessageEventLike) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: ((event: SessionSocketCloseEventLike) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export interface SessionSocketConstructor {
  new(url: string): SessionSocketLike
}

export interface QueuedSessionSocketMessage<TMessage = SessionClientMessage> {
  readonly sequence: number
  readonly enqueuedAt: string
  readonly message: TMessage
  readonly serialized: string
}

export interface SessionSocketCloseSummary {
  readonly code?: number
  readonly reason?: string
  readonly wasClean?: boolean
}

export type SessionSocketSendResult<TMessage = SessionClientMessage> =
  | {
      readonly ok: true
      readonly delivery: 'sent'
      readonly serialized: string
    }
  | {
      readonly ok: true
      readonly delivery: 'queued'
      readonly queued: QueuedSessionSocketMessage<TMessage>
    }
  | {
      readonly ok: false
      readonly reason: 'serialization-failed' | 'queue-full' | 'send-failed'
      readonly message: string
    }

export type SessionSocketHelloStatus = 'idle' | 'queued' | 'sent' | 'accepted' | 'rejected'

export interface CreateSessionClientHelloMessageOptions {
  readonly reconnect?: boolean
  readonly lastSeenRevision?: SessionRevision
  readonly messageId?: string
  readonly sentAt?: string
  readonly traceId?: string
}

export interface SessionSocketAutoHelloOptions extends CreateSessionClientHelloMessageOptions {
  readonly identity: SessionClientIdentity
  /** Defaults to true when hello options are supplied. */
  readonly auto?: boolean
}

export type SessionSocketClock = () => string
export type SessionSocketSerializer<TMessage> = (message: TMessage) => string
export type SessionSocketParser<TMessage> = (raw: string) => TMessage
export type SessionSocketMessageHandler<TMessage> = (message: TMessage, raw: string) => void

export interface UseSessionSocketOptions<
  TClientMessage = SessionClientMessage,
  TServerMessage = SessionServerMessage,
> {
  readonly autoConnect?: boolean
  /** Full URL or app-relative path. Defaults to `/api/sessions/socket`. */
  readonly url?: string
  /** Optional session-local identity used to send a client hello after open. */
  readonly hello?: SessionSocketAutoHelloOptions | null
  readonly location?: SessionSocketLocationLike
  readonly webSocketConstructor?: SessionSocketConstructor | null
  readonly now?: SessionSocketClock
  readonly maxQueueSize?: number
  readonly serialize?: SessionSocketSerializer<TClientMessage>
  readonly parse?: SessionSocketParser<TServerMessage>
  readonly onMessage?: SessionSocketMessageHandler<TServerMessage>
}

const defaultClock: SessionSocketClock = () => new Date().toISOString()

const getDefaultWebSocketConstructor = (): SessionSocketConstructor | null => {
  const candidate = (globalThis as { window?: { WebSocket?: unknown } }).window?.WebSocket
  return typeof candidate === 'function' ? candidate as SessionSocketConstructor : null
}

const getBrowserLocation = (): SessionSocketLocationLike | undefined => {
  const location = (globalThis as { window?: { location?: SessionSocketLocationLike } }).window?.location
  if (location === undefined) return undefined
  return location
}

const normalizeErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  if (typeof error === 'string' && error.trim().length > 0) return error.trim()
  return fallback
}

export const resolveSessionSocketUrl = (
  input: string = SESSION_API_PATHS.socket,
  location: SessionSocketLocationLike | undefined = getBrowserLocation(),
): string => {
  const requested = input.trim()
  if (requested.length === 0) throw new Error('Session WebSocket URL is required')
  if (requested.startsWith('ws://') || requested.startsWith('wss://')) return requested

  if (requested.startsWith('http://') || requested.startsWith('https://')) {
    const url = new URL(requested)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
  }

  if (location === undefined || location.host.trim().length === 0) return requested

  const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  if (requested.startsWith('/')) return `${socketProtocol}//${location.host}${requested}`

  const baseHref = location.href ?? `${location.protocol}//${location.host}/`
  const url = new URL(requested, baseHref)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

const defaultSerialize = <TMessage>(message: TMessage): string => {
  const serialized = JSON.stringify(message)
  if (typeof serialized !== 'string') {
    throw new Error('Session WebSocket messages must be JSON-serializable')
  }
  return serialized
}

const defaultParse = <TMessage>(raw: string): TMessage => JSON.parse(raw) as TMessage

export const createSessionClientHelloMessage = (
  identity: SessionClientIdentity,
  options: CreateSessionClientHelloMessageOptions = {},
): SessionClientHelloMessage<SessionRevision> => {
  const lastSeenRevision = options.lastSeenRevision ?? identity.lastSeenRevision
  const base = {
    schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
    type: 'hello',
    direction: 'client',
    sessionId: identity.sessionId,
    reconnect: options.reconnect ?? lastSeenRevision !== undefined,
    ...(lastSeenRevision === undefined ? {} : { lastSeenRevision }),
    ...(options.messageId === undefined ? {} : { messageId: options.messageId }),
    ...(options.sentAt === undefined ? {} : { sentAt: options.sentAt }),
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
  } as const

  if (identity.role === 'gm') {
    return {
      ...base,
      identity: {
        role: 'gm',
        clientId: identity.clientId,
        gmKey: identity.gmKey,
      },
    }
  }

  return {
    ...base,
    identity: {
      role: 'player',
      clientId: identity.clientId,
      playerId: identity.playerId,
      displayName: identity.displayName,
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isServerHelloMessage = (message: unknown): message is SessionServerHelloMessage =>
  isRecord(message) &&
  message.schemaVersion === SESSION_MESSAGE_SCHEMA_VERSION &&
  message.type === 'hello' &&
  message.direction === 'server'

const isServerAuthRejectionMessage = (message: unknown): boolean =>
  isRecord(message) &&
  message.schemaVersion === SESSION_MESSAGE_SCHEMA_VERSION &&
  message.type === 'error' &&
  message.direction === 'server' &&
  (
    message.code === 'unauthorized' ||
    message.code === 'session-not-found' ||
    message.code === 'session-ended' ||
    message.code === 'session-host-disabled' ||
    message.code === 'malformed-message'
  )

const isSocketOpen = (socket: SessionSocketLike | null): socket is SessionSocketLike =>
  socket !== null && socket.readyState === SESSION_SOCKET_READY_STATE_OPEN

const isSocketConnecting = (socket: SessionSocketLike | null): socket is SessionSocketLike =>
  socket !== null && socket.readyState === SESSION_SOCKET_READY_STATE_CONNECTING

const detachSocketHandlers = (socket: SessionSocketLike): void => {
  socket.onopen = null
  socket.onmessage = null
  socket.onerror = null
  socket.onclose = null
}

export const useSessionSocket = <
  TClientMessage = SessionClientMessage,
  TServerMessage = SessionServerMessage,
>(options: UseSessionSocketOptions<TClientMessage, TServerMessage> = {}) => {
  const now = options.now ?? defaultClock
  const serialize = options.serialize ?? defaultSerialize<TClientMessage>
  const parse = options.parse ?? defaultParse<TServerMessage>
  const maxQueueSize = options.maxQueueSize ?? SESSION_SOCKET_DEFAULT_MAX_QUEUE_SIZE
  const messageHandlers = new Set<SessionSocketMessageHandler<TServerMessage>>()
  if (options.onMessage !== undefined) messageHandlers.add(options.onMessage)

  const status = ref<SessionSocketStatus>('idle')
  const resolvedUrl = ref<string | null>(null)
  const socket = shallowRef<SessionSocketLike | null>(null)
  const lastError = ref<string | null>(null)
  const lastRawMessage = ref<string | null>(null)
  const lastMessage = ref<TServerMessage | null>(null)
  const lastServerHello = ref<SessionServerHelloMessage | null>(null)
  const helloStatus = ref<SessionSocketHelloStatus>('idle')
  const lastClose = ref<SessionSocketCloseSummary | null>(null)
  const sendQueueItems = shallowRef<QueuedSessionSocketMessage<TClientMessage>[]>([])
  let nextSequence = 1

  const sendQueue = computed<readonly QueuedSessionSocketMessage<TClientMessage>[]>(() => sendQueueItems.value)
  const queuedMessageCount = computed(() => sendQueueItems.value.length)
  const isConnecting = computed(() => status.value === 'connecting')
  const isOpen = computed(() => status.value === 'open')
  const isUnavailable = computed(() => status.value === 'unavailable')
  const canSendImmediately = computed(() => isSocketOpen(socket.value))

  const clearSendQueue = (): void => {
    sendQueueItems.value = []
  }

  const flushSendQueue = (): number => {
    const currentSocket = socket.value
    if (!isSocketOpen(currentSocket)) return 0

    const remaining: QueuedSessionSocketMessage<TClientMessage>[] = []
    let flushed = 0

    for (let index = 0; index < sendQueueItems.value.length; index += 1) {
      const queued = sendQueueItems.value[index]
      if (queued === undefined) continue

      try {
        currentSocket.send(queued.serialized)
        flushed += 1
      } catch (error) {
        remaining.push(...sendQueueItems.value.slice(index))
        status.value = 'error'
        lastError.value = normalizeErrorMessage(error, 'Failed to flush queued session WebSocket message.')
        break
      }
    }

    sendQueueItems.value = remaining
    return flushed
  }

  const handleOpen = (openedSocket: SessionSocketLike) => {
    if (socket.value !== openedSocket) return
    status.value = 'open'
    lastError.value = null

    if (options.hello !== undefined && options.hello !== null && options.hello.auto !== false) {
      const { identity, auto: _auto, ...helloOptions } = options.hello
      void _auto
      sendHello(identity, helloOptions)
    }

    flushSendQueue()
  }

  const handleMessage = (messageSocket: SessionSocketLike, event: SessionSocketMessageEventLike) => {
    if (socket.value !== messageSocket) return

    if (typeof event.data !== 'string') {
      lastError.value = 'Received a non-text session WebSocket message.'
      return
    }

    lastRawMessage.value = event.data
    try {
      const parsed = parse(event.data)
      lastMessage.value = parsed
      if (isServerHelloMessage(parsed)) {
        lastServerHello.value = parsed
        helloStatus.value = 'accepted'
      } else if (isServerAuthRejectionMessage(parsed)) {
        helloStatus.value = 'rejected'
      }
      for (const handler of messageHandlers) handler(parsed, event.data)
    } catch (error) {
      lastError.value = normalizeErrorMessage(error, 'Unable to parse session WebSocket message.')
    }
  }

  const handleError = (errorSocket: SessionSocketLike, event: unknown) => {
    if (socket.value !== errorSocket) return
    status.value = 'error'
    lastError.value = normalizeErrorMessage(event, 'Session WebSocket connection error.')
  }

  const handleClose = (closedSocket: SessionSocketLike, event: SessionSocketCloseEventLike) => {
    if (socket.value !== closedSocket) return

    lastClose.value = {
      ...(event.code === undefined ? {} : { code: event.code }),
      ...(event.reason === undefined ? {} : { reason: event.reason }),
      ...(event.wasClean === undefined ? {} : { wasClean: event.wasClean }),
    }
    socket.value = null
    detachSocketHandlers(closedSocket)
    if (status.value !== 'error') status.value = 'closed'
  }

  const wireSocket = (nextSocket: SessionSocketLike): void => {
    nextSocket.onopen = (event: unknown) => {
      void event
      handleOpen(nextSocket)
    }
    nextSocket.onmessage = (event: SessionSocketMessageEventLike) => handleMessage(nextSocket, event)
    nextSocket.onerror = (event: unknown) => handleError(nextSocket, event)
    nextSocket.onclose = (event: SessionSocketCloseEventLike) => handleClose(nextSocket, event)
  }

  const connect = (): boolean => {
    const currentSocket = socket.value
    if (isSocketOpen(currentSocket) || isSocketConnecting(currentSocket)) return true

    const WebSocketConstructor = options.webSocketConstructor === undefined
      ? getDefaultWebSocketConstructor()
      : options.webSocketConstructor

    if (WebSocketConstructor === null) {
      status.value = 'unavailable'
      lastError.value = 'WebSocket is not available in this runtime.'
      return false
    }

    let url: string
    try {
      url = resolveSessionSocketUrl(options.url ?? SESSION_API_PATHS.socket, options.location)
    } catch (error) {
      status.value = 'error'
      lastError.value = normalizeErrorMessage(error, 'Unable to resolve session WebSocket URL.')
      return false
    }

    status.value = 'connecting'
    lastError.value = null
    lastClose.value = null
    lastServerHello.value = null
    if (options.hello !== undefined && options.hello !== null) helloStatus.value = 'idle'
    resolvedUrl.value = url

    try {
      const nextSocket = new WebSocketConstructor(url)
      socket.value = nextSocket
      wireSocket(nextSocket)
      return true
    } catch (error) {
      socket.value = null
      status.value = 'error'
      lastError.value = normalizeErrorMessage(error, 'Unable to open session WebSocket connection.')
      return false
    }
  }

  const enqueueSerialized = (
    message: TClientMessage,
    serialized: string,
  ): SessionSocketSendResult<TClientMessage> => {
    if (sendQueueItems.value.length >= maxQueueSize) {
      const messageText = `Session WebSocket send queue is full (${maxQueueSize} messages).`
      lastError.value = messageText
      return { ok: false, reason: 'queue-full', message: messageText }
    }

    const queued: QueuedSessionSocketMessage<TClientMessage> = {
      sequence: nextSequence,
      enqueuedAt: now(),
      message,
      serialized,
    }
    nextSequence += 1
    sendQueueItems.value = [...sendQueueItems.value, queued]
    return { ok: true, delivery: 'queued', queued }
  }

  const send = (message: TClientMessage): SessionSocketSendResult<TClientMessage> => {
    let serialized: string
    try {
      serialized = serialize(message)
    } catch (error) {
      const messageText = normalizeErrorMessage(error, 'Unable to serialize session WebSocket message.')
      lastError.value = messageText
      return { ok: false, reason: 'serialization-failed', message: messageText }
    }

    const currentSocket = socket.value
    if (!isSocketOpen(currentSocket)) return enqueueSerialized(message, serialized)

    try {
      currentSocket.send(serialized)
      return { ok: true, delivery: 'sent', serialized }
    } catch (error) {
      const messageText = normalizeErrorMessage(error, 'Unable to send session WebSocket message.')
      status.value = 'error'
      lastError.value = messageText
      return { ok: false, reason: 'send-failed', message: messageText }
    }
  }

  const sendHello = (
    identity: SessionClientIdentity,
    helloOptions: CreateSessionClientHelloMessageOptions = {},
  ): SessionSocketSendResult<TClientMessage> => {
    const result = send(
      createSessionClientHelloMessage(identity, helloOptions) as unknown as TClientMessage,
    )

    if (result.ok) {
      helloStatus.value = result.delivery === 'queued' ? 'queued' : 'sent'
    } else {
      helloStatus.value = 'rejected'
    }

    return result
  }

  const disconnect = (code = 1000, reason = 'session socket disconnect'): void => {
    const currentSocket = socket.value
    if (currentSocket === null) {
      if (status.value !== 'unavailable') status.value = 'closed'
      return
    }

    if (currentSocket.readyState === SESSION_SOCKET_READY_STATE_CLOSED) {
      socket.value = null
      detachSocketHandlers(currentSocket)
      status.value = 'closed'
      return
    }

    status.value = 'closing'
    try {
      currentSocket.close(code, reason)
    } catch (error) {
      socket.value = null
      status.value = 'error'
      lastError.value = normalizeErrorMessage(error, 'Unable to close session WebSocket connection.')
    }
  }

  const cleanup = (): void => {
    clearSendQueue()
    const currentSocket = socket.value
    if (currentSocket !== null) {
      socket.value = null
      detachSocketHandlers(currentSocket)
      try {
        if (currentSocket.readyState !== SESSION_SOCKET_READY_STATE_CLOSED) {
          currentSocket.close(1000, 'session socket cleanup')
        }
      } catch (error) {
        lastError.value = normalizeErrorMessage(error, 'Unable to clean up session WebSocket connection.')
      }
    }
    if (status.value !== 'unavailable') status.value = 'closed'
  }

  const addMessageHandler = (handler: SessionSocketMessageHandler<TServerMessage>): (() => void) => {
    messageHandlers.add(handler)
    return () => {
      messageHandlers.delete(handler)
    }
  }

  if (getCurrentScope() !== undefined) onScopeDispose(cleanup)
  if (options.autoConnect === true) connect()

  return {
    status,
    resolvedUrl,
    socket,
    lastError,
    lastRawMessage,
    lastMessage,
    lastServerHello,
    helloStatus,
    lastClose,
    sendQueue,
    queuedMessageCount,
    isConnecting,
    isOpen,
    isUnavailable,
    canSendImmediately,
    connect,
    disconnect,
    cleanup,
    send,
    sendHello,
    flushSendQueue,
    clearSendQueue,
    addMessageHandler,
  }
}
