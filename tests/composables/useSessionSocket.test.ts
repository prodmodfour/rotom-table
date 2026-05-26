import { describe, expect, it, vi } from 'vitest'
import { SESSION_MESSAGE_SCHEMA_VERSION, type SessionClientMessage, type SessionServerMessage } from '#shared/sessionMessages'
import { parseSessionId } from '#shared/sessionIdentity'
import {
  resolveSessionSocketUrl,
  useSessionSocket,
  type SessionSocketConstructor,
  type SessionSocketLike,
  type SessionSocketMessageEventLike,
  type SessionSocketCloseEventLike,
} from '~/composables/useSessionSocket'

const SESSION_ID = parseSessionId('session_abcdefghijkl')

const clientHeartbeatMessage: SessionClientMessage = {
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'heartbeat',
  direction: 'client',
  sessionId: SESSION_ID,
  heartbeat: 'ping',
  nonce: 'nonce-1',
}

const serverErrorMessage: SessionServerMessage = {
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'error',
  direction: 'server',
  code: 'unsupported-message',
  message: 'Track 2 session WebSocket is connected, but hello/auth handling lands later.',
  retryable: false,
}

class FakeSessionWebSocket implements SessionSocketLike {
  readonly url: string
  readyState = 0
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: SessionSocketMessageEventLike) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: ((event: SessionSocketCloseEventLike) => void) | null = null
  readonly sent: string[] = []
  readonly closed: { readonly code?: number, readonly reason?: string }[] = []

  constructor(url: string) {
    this.url = url
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3
    this.closed.push({ code, reason })
  }

  open(): void {
    this.readyState = 1
    this.onopen?.({ type: 'open' })
  }

  receive(data: unknown): void {
    this.onmessage?.({ data })
  }

  fail(error: unknown = new Error('socket boom')): void {
    this.onerror?.(error)
  }

  serverClose(event: SessionSocketCloseEventLike): void {
    this.readyState = 3
    this.onclose?.(event)
  }
}

const makeFakeWebSocketConstructor = () => {
  const instances: FakeSessionWebSocket[] = []

  const Constructor = class extends FakeSessionWebSocket {
    constructor(url: string) {
      super(url)
      instances.push(this)
    }
  }

  return {
    Constructor: Constructor as SessionSocketConstructor,
    instances,
  }
}

describe('resolveSessionSocketUrl', () => {
  it('resolves the session socket path against browser HTTP and HTTPS locations', () => {
    expect(resolveSessionSocketUrl('/api/sessions/socket', {
      protocol: 'http:',
      host: 'localhost:3000',
    })).toBe('ws://localhost:3000/api/sessions/socket')

    expect(resolveSessionSocketUrl('/api/sessions/socket', {
      protocol: 'https:',
      host: 'table.example.net',
    })).toBe('wss://table.example.net/api/sessions/socket')
  })

  it('converts absolute HTTP(S) URLs and leaves WS URLs intact', () => {
    expect(resolveSessionSocketUrl('http://localhost:3000/api/sessions/socket')).toBe(
      'ws://localhost:3000/api/sessions/socket',
    )
    expect(resolveSessionSocketUrl('https://table.example.net/api/sessions/socket?session=1')).toBe(
      'wss://table.example.net/api/sessions/socket?session=1',
    )
    expect(resolveSessionSocketUrl('wss://table.example.net/api/sessions/socket')).toBe(
      'wss://table.example.net/api/sessions/socket',
    )
  })
})

describe('useSessionSocket', () => {
  it('reports WebSocket unavailability without touching session identity or HTTP endpoints', () => {
    const sessionSocket = useSessionSocket({ webSocketConstructor: null })

    expect(sessionSocket.connect()).toBe(false)

    expect(sessionSocket.status.value).toBe('unavailable')
    expect(sessionSocket.isUnavailable.value).toBe(true)
    expect(sessionSocket.lastError.value).toBe('WebSocket is not available in this runtime.')
    expect(sessionSocket.socket.value).toBeNull()
  })

  it('queues client messages before open and flushes them once connected', () => {
    const fake = makeFakeWebSocketConstructor()
    const sessionSocket = useSessionSocket({
      webSocketConstructor: fake.Constructor,
      location: { protocol: 'http:', host: 'localhost:3000' },
      now: () => '2026-05-26T11:00:00.000Z',
    })

    const queued = sessionSocket.send(clientHeartbeatMessage)

    expect(queued).toMatchObject({ ok: true, delivery: 'queued' })
    expect(sessionSocket.status.value).toBe('idle')
    expect(sessionSocket.queuedMessageCount.value).toBe(1)
    expect(sessionSocket.sendQueue.value[0]).toMatchObject({
      sequence: 1,
      enqueuedAt: '2026-05-26T11:00:00.000Z',
      message: clientHeartbeatMessage,
      serialized: JSON.stringify(clientHeartbeatMessage),
    })

    expect(sessionSocket.connect()).toBe(true)
    expect(fake.instances).toHaveLength(1)
    expect(fake.instances[0]?.url).toBe('ws://localhost:3000/api/sessions/socket')
    expect(sessionSocket.status.value).toBe('connecting')
    expect(sessionSocket.resolvedUrl.value).toBe('ws://localhost:3000/api/sessions/socket')

    fake.instances[0]?.open()

    expect(sessionSocket.status.value).toBe('open')
    expect(sessionSocket.isOpen.value).toBe(true)
    expect(sessionSocket.queuedMessageCount.value).toBe(0)
    expect(fake.instances[0]?.sent).toEqual([JSON.stringify(clientHeartbeatMessage)])
  })

  it('sends immediately when open and records parsed server messages', () => {
    const fake = makeFakeWebSocketConstructor()
    const onMessage = vi.fn()
    const sessionSocket = useSessionSocket({
      webSocketConstructor: fake.Constructor,
      location: { protocol: 'https:', host: 'table.example.net' },
      onMessage,
    })

    sessionSocket.connect()
    fake.instances[0]?.open()

    const sent = sessionSocket.send(clientHeartbeatMessage)
    expect(sent).toEqual({
      ok: true,
      delivery: 'sent',
      serialized: JSON.stringify(clientHeartbeatMessage),
    })
    expect(fake.instances[0]?.sent).toEqual([JSON.stringify(clientHeartbeatMessage)])
    expect(sessionSocket.canSendImmediately.value).toBe(true)

    fake.instances[0]?.receive(JSON.stringify(serverErrorMessage))

    expect(sessionSocket.lastRawMessage.value).toBe(JSON.stringify(serverErrorMessage))
    expect(sessionSocket.lastMessage.value).toEqual(serverErrorMessage)
    expect(onMessage).toHaveBeenCalledWith(serverErrorMessage, JSON.stringify(serverErrorMessage))
  })

  it('keeps the socket open while surfacing malformed server payloads', () => {
    const fake = makeFakeWebSocketConstructor()
    const sessionSocket = useSessionSocket({
      webSocketConstructor: fake.Constructor,
      location: { protocol: 'http:', host: 'localhost:3000' },
    })

    sessionSocket.connect()
    fake.instances[0]?.open()
    fake.instances[0]?.receive('{not json')

    expect(sessionSocket.status.value).toBe('open')
    expect(sessionSocket.lastError.value).toMatch(/JSON|parse|position/i)
    expect(sessionSocket.lastMessage.value).toBeNull()
  })

  it('tracks socket errors, close details, disconnect, and cleanup state', () => {
    const fake = makeFakeWebSocketConstructor()
    const sessionSocket = useSessionSocket({
      webSocketConstructor: fake.Constructor,
      location: { protocol: 'http:', host: 'localhost:3000' },
    })

    sessionSocket.connect()
    fake.instances[0]?.open()
    fake.instances[0]?.fail(new Error('socket boom'))

    expect(sessionSocket.status.value).toBe('error')
    expect(sessionSocket.lastError.value).toBe('socket boom')

    fake.instances[0]?.serverClose({ code: 1006, reason: 'abnormal', wasClean: false })

    expect(sessionSocket.status.value).toBe('error')
    expect(sessionSocket.socket.value).toBeNull()
    expect(sessionSocket.lastClose.value).toEqual({ code: 1006, reason: 'abnormal', wasClean: false })

    sessionSocket.connect()
    fake.instances[1]?.open()
    sessionSocket.disconnect(1000, 'done')

    expect(sessionSocket.status.value).toBe('closing')
    expect(fake.instances[1]?.closed).toEqual([{ code: 1000, reason: 'done' }])

    fake.instances[1]?.serverClose({ code: 1000, reason: 'done', wasClean: true })
    expect(sessionSocket.status.value).toBe('closed')

    sessionSocket.send(clientHeartbeatMessage)
    expect(sessionSocket.queuedMessageCount.value).toBe(1)
    sessionSocket.connect()
    fake.instances[2]?.open()
    sessionSocket.cleanup()

    expect(sessionSocket.status.value).toBe('closed')
    expect(sessionSocket.socket.value).toBeNull()
    expect(sessionSocket.queuedMessageCount.value).toBe(0)
    expect(fake.instances[2]?.closed).toEqual([{ code: 1000, reason: 'session socket cleanup' }])
  })

  it('bounds the send queue and reports serialization failures', () => {
    const fake = makeFakeWebSocketConstructor()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const sessionSocket = useSessionSocket<unknown>({
      webSocketConstructor: fake.Constructor,
      maxQueueSize: 1,
    })

    expect(sessionSocket.send(clientHeartbeatMessage)).toMatchObject({ ok: true, delivery: 'queued' })
    expect(sessionSocket.send(serverErrorMessage)).toEqual({
      ok: false,
      reason: 'queue-full',
      message: 'Session WebSocket send queue is full (1 messages).',
    })
    expect(sessionSocket.lastError.value).toBe('Session WebSocket send queue is full (1 messages).')

    const serializationFailure = sessionSocket.send(circular)
    expect(serializationFailure).toMatchObject({ ok: false, reason: 'serialization-failed' })
    expect(sessionSocket.lastError.value).toMatch(/circular/i)
  })
})
