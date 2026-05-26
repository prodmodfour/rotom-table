import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionClientMessage,
  type SessionServerMessage,
} from '#shared/sessionMessages'
import { parseOpId } from '#shared/sessionCommands'
import {
  parseClientId,
  parseGmKey,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import { INITIAL_SESSION_REVISION, parseSessionRevision } from '#shared/sessionRevisions'
import {
  createSessionClientHeartbeatMessage,
  createSessionClientHelloMessage,
  resolveSessionSocketUrl,
  useSessionSocket,
  type SessionSocketConstructor,
  type SessionSocketLike,
  type SessionSocketMessageEventLike,
  type SessionSocketCloseEventLike,
} from '~/composables/useSessionSocket'

const SESSION_ID = parseSessionId('session_abcdefghijkl')
const GM_CLIENT_ID = parseClientId('client_gmclient01')
const PLAYER_CLIENT_ID = parseClientId('client_player01')
const PLAYER_ID = parsePlayerId('player_misty001')
const GM_KEY = parseGmKey('gmkey_abcdefghijklmnopqrstuvwxyz')
const PLAYER_DISPLAY_NAME = parseSessionDisplayName('Misty')
const OP_ID = parseOpId('op_12345678')
const SESSION_REVISION_3 = parseSessionRevision(3)

const gmIdentity: SessionClientIdentity = {
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'gm',
  sessionId: SESSION_ID,
  clientId: GM_CLIENT_ID,
  gmKey: GM_KEY,
  rememberedAt: '2026-05-26T10:00:00.000Z',
}

const playerIdentity: SessionClientIdentity = {
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'player',
  sessionId: SESSION_ID,
  clientId: PLAYER_CLIENT_ID,
  playerId: PLAYER_ID,
  displayName: PLAYER_DISPLAY_NAME,
  rememberedAt: '2026-05-26T10:00:00.000Z',
  lastSeenRevision: INITIAL_SESSION_REVISION,
}

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
  message: 'live session WebSocket is connected, but command dispatch lands later.',
  retryable: false,
}

const serverHelloMessage: SessionServerMessage = {
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'hello',
  direction: 'server',
  sessionId: SESSION_ID,
  actor: {
    role: 'player',
    playerId: PLAYER_ID,
    clientId: PLAYER_CLIENT_ID,
    displayName: PLAYER_DISPLAY_NAME,
  },
  currentRevision: INITIAL_SESSION_REVISION,
  resumed: true,
  heartbeat: {
    intervalMs: 25000,
    timeoutMs: 60000,
  },
}

const fastServerHelloMessage: SessionServerMessage = {
  ...serverHelloMessage,
  heartbeat: {
    intervalMs: 1000,
    timeoutMs: 3000,
  },
}

const serverPingMessage: SessionServerMessage = {
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'heartbeat',
  direction: 'server',
  sessionId: SESSION_ID,
  heartbeat: 'ping',
  nonce: 'hb-server-1',
  lastSeenRevision: INITIAL_SESSION_REVISION,
}

const reconnectSnapshotMessage: SessionServerMessage = {
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'snapshot',
  direction: 'server',
  sessionId: SESSION_ID,
  reason: 'reconnect',
  currentRevision: INITIAL_SESSION_REVISION,
  replayAvailable: false,
  snapshot: {
    sessionId: SESSION_ID,
    revision: INITIAL_SESSION_REVISION,
    selectedMapSlug: null,
  },
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

describe('createSessionClientHelloMessage', () => {
  it('builds GM and player hello frames from remembered session-local identities', () => {
    expect(createSessionClientHelloMessage(gmIdentity, {
      reconnect: false,
      messageId: 'hello-gm-1',
      sentAt: '2026-05-26T11:00:00.000Z',
    })).toEqual({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'hello',
      direction: 'client',
      sessionId: SESSION_ID,
      reconnect: false,
      messageId: 'hello-gm-1',
      sentAt: '2026-05-26T11:00:00.000Z',
      identity: {
        role: 'gm',
        clientId: GM_CLIENT_ID,
        gmKey: GM_KEY,
      },
    })

    expect(createSessionClientHelloMessage(playerIdentity)).toEqual({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'hello',
      direction: 'client',
      sessionId: SESSION_ID,
      reconnect: true,
      lastSeenRevision: INITIAL_SESSION_REVISION,
      identity: {
        role: 'player',
        clientId: PLAYER_CLIENT_ID,
        playerId: PLAYER_ID,
        displayName: PLAYER_DISPLAY_NAME,
      },
    })
  })

  it('builds client heartbeat frames with optional nonce and revision', () => {
    expect(createSessionClientHeartbeatMessage(SESSION_ID, {
      heartbeat: 'pong',
      nonce: 'hb-server-1',
      sentAt: '2026-05-26T11:00:00.000Z',
      lastSeenRevision: INITIAL_SESSION_REVISION,
    })).toEqual({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'heartbeat',
      direction: 'client',
      sessionId: SESSION_ID,
      heartbeat: 'pong',
      nonce: 'hb-server-1',
      sentAt: '2026-05-26T11:00:00.000Z',
      lastSeenRevision: INITIAL_SESSION_REVISION,
    })
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

  it('auto-sends a client hello before flushing queued messages and tracks server acceptance', () => {
    const fake = makeFakeWebSocketConstructor()
    const sessionSocket = useSessionSocket({
      webSocketConstructor: fake.Constructor,
      location: { protocol: 'http:', host: 'localhost:3000' },
      hello: {
        identity: playerIdentity,
        messageId: 'hello-player-1',
      },
    })

    sessionSocket.send(clientHeartbeatMessage)
    sessionSocket.connect()
    fake.instances[0]?.open()

    const expectedHello = createSessionClientHelloMessage(playerIdentity, {
      messageId: 'hello-player-1',
    })
    expect(fake.instances[0]?.sent).toEqual([
      JSON.stringify(expectedHello),
      JSON.stringify(clientHeartbeatMessage),
    ])
    expect(sessionSocket.helloStatus.value).toBe('sent')

    fake.instances[0]?.receive(JSON.stringify(serverHelloMessage))

    expect(sessionSocket.helloStatus.value).toBe('accepted')
    expect(sessionSocket.reconnectStatus.value).toBe('resumed')
    expect(sessionSocket.lastServerHello.value).toEqual(serverHelloMessage)
    expect(sessionSocket.lastKnownRevision.value).toBe(INITIAL_SESSION_REVISION)
  })

  it('queues manual client hello frames before the socket opens', () => {
    const fake = makeFakeWebSocketConstructor()
    const sessionSocket = useSessionSocket({
      webSocketConstructor: fake.Constructor,
      location: { protocol: 'http:', host: 'localhost:3000' },
    })

    expect(sessionSocket.sendHello(gmIdentity, { reconnect: false })).toMatchObject({
      ok: true,
      delivery: 'queued',
    })
    expect(sessionSocket.helloStatus.value).toBe('queued')

    sessionSocket.connect()
    fake.instances[0]?.open()

    expect(fake.instances[0]?.sent).toEqual([
      JSON.stringify(createSessionClientHelloMessage(gmIdentity, { reconnect: false })),
    ])
  })

  it('tracks reconnect snapshot fallback after a server hello requires it', () => {
    const fake = makeFakeWebSocketConstructor()
    const sessionSocket = useSessionSocket({
      webSocketConstructor: fake.Constructor,
      location: { protocol: 'http:', host: 'localhost:3000' },
    })

    sessionSocket.connect()
    fake.instances[0]?.open()
    fake.instances[0]?.receive(JSON.stringify({
      ...serverHelloMessage,
      snapshotRequired: true,
    }))

    expect(sessionSocket.helloStatus.value).toBe('accepted')
    expect(sessionSocket.reconnectStatus.value).toBe('snapshot-required')
    expect(sessionSocket.lastSnapshot.value).toBeNull()
    expect(sessionSocket.lastKnownRevision.value).toBe(INITIAL_SESSION_REVISION)

    fake.instances[0]?.receive(JSON.stringify(reconnectSnapshotMessage))

    expect(sessionSocket.reconnectStatus.value).toBe('snapshot-received')
    expect(sessionSocket.lastSnapshot.value).toEqual(reconnectSnapshotMessage)
    expect(sessionSocket.lastKnownRevision.value).toBe(INITIAL_SESSION_REVISION)
  })

  it('starts client heartbeat pings after server hello and pongs server pings', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T12:00:00.000Z'))

    try {
      const fake = makeFakeWebSocketConstructor()
      const sessionSocket = useSessionSocket({
        webSocketConstructor: fake.Constructor,
        location: { protocol: 'http:', host: 'localhost:3000' },
        now: () => new Date(Date.now()).toISOString(),
      })

      sessionSocket.connect()
      fake.instances[0]?.open()
      fake.instances[0]?.receive(JSON.stringify(fastServerHelloMessage))

      expect(sessionSocket.heartbeatStatus.value).toBe('active')
      expect(sessionSocket.heartbeatConfig.value).toEqual({ intervalMs: 1000, timeoutMs: 3000 })
      expect(sessionSocket.lastServerMessageAt.value).toBe('2026-05-26T12:00:00.000Z')

      vi.advanceTimersByTime(1000)

      expect(fake.instances[0]?.sent[0]).toBe(JSON.stringify(createSessionClientHeartbeatMessage(SESSION_ID, {
        heartbeat: 'ping',
        nonce: 'hb-client-1',
        sentAt: '2026-05-26T12:00:01.000Z',
        lastSeenRevision: INITIAL_SESSION_REVISION,
      })))
      expect(sessionSocket.lastHeartbeatSentAt.value).toBe('2026-05-26T12:00:01.000Z')
      expect(sessionSocket.lastHeartbeatNonce.value).toBe('hb-client-1')

      fake.instances[0]?.receive(JSON.stringify(serverPingMessage))

      expect(sessionSocket.lastHeartbeatReceivedAt.value).toBe('2026-05-26T12:00:01.000Z')
      expect(fake.instances[0]?.sent[1]).toBe(JSON.stringify(createSessionClientHeartbeatMessage(SESSION_ID, {
        heartbeat: 'pong',
        nonce: 'hb-server-1',
        sentAt: '2026-05-26T12:00:01.000Z',
        lastSeenRevision: INITIAL_SESSION_REVISION,
      })))

      vi.advanceTimersByTime(1000)
      expect(fake.instances[0]?.sent[2]).toBe(JSON.stringify(createSessionClientHeartbeatMessage(SESSION_ID, {
        heartbeat: 'ping',
        nonce: 'hb-client-2',
        sentAt: '2026-05-26T12:00:02.000Z',
        lastSeenRevision: INITIAL_SESSION_REVISION,
      })))

      sessionSocket.cleanup()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the client socket when server heartbeat activity becomes stale', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T12:10:00.000Z'))

    try {
      const fake = makeFakeWebSocketConstructor()
      const sessionSocket = useSessionSocket({
        webSocketConstructor: fake.Constructor,
        location: { protocol: 'http:', host: 'localhost:3000' },
        now: () => new Date(Date.now()).toISOString(),
      })

      sessionSocket.connect()
      fake.instances[0]?.open()
      fake.instances[0]?.receive(JSON.stringify(fastServerHelloMessage))

      vi.advanceTimersByTime(3000)

      expect(sessionSocket.heartbeatStatus.value).toBe('stale')
      expect(sessionSocket.status.value).toBe('closing')
      expect(sessionSocket.lastError.value).toBe('Session WebSocket heartbeat timed out.')
      expect(fake.instances[0]?.closed).toEqual([
        { code: 1008, reason: 'Session WebSocket heartbeat timed out.' },
      ])
      expect(fake.instances[0]?.sent).toEqual([
        JSON.stringify(createSessionClientHeartbeatMessage(SESSION_ID, {
          heartbeat: 'ping',
          nonce: 'hb-client-1',
          sentAt: '2026-05-26T12:10:01.000Z',
          lastSeenRevision: INITIAL_SESSION_REVISION,
        })),
        JSON.stringify(createSessionClientHeartbeatMessage(SESSION_ID, {
          heartbeat: 'ping',
          nonce: 'hb-client-2',
          sentAt: '2026-05-26T12:10:02.000Z',
          lastSeenRevision: INITIAL_SESSION_REVISION,
        })),
      ])

      sessionSocket.cleanup()
    } finally {
      vi.useRealTimers()
    }
  })

  it('updates the last known revision from command results and patch broadcasts', () => {
    const fake = makeFakeWebSocketConstructor()
    const sessionSocket = useSessionSocket({
      webSocketConstructor: fake.Constructor,
      location: { protocol: 'http:', host: 'localhost:3000' },
    })

    sessionSocket.connect()
    fake.instances[0]?.open()
    fake.instances[0]?.receive(JSON.stringify({
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
        commandType: 'moveToken',
        actor: {
          role: 'player',
          playerId: PLAYER_ID,
          clientId: PLAYER_CLIENT_ID,
          displayName: PLAYER_DISPLAY_NAME,
        },
        currentRevision: SESSION_REVISION_3,
        scopes: [],
      },
    } satisfies SessionServerMessage))

    expect(sessionSocket.lastKnownRevision.value).toBe(SESSION_REVISION_3)

    fake.instances[0]?.receive(JSON.stringify({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'patch',
      direction: 'server',
      sessionId: SESSION_ID,
      event: {
        eventType: 'tokenMoved',
        revision: parseSessionRevision(4),
        commandType: 'moveToken',
        opId: OP_ID,
        scopes: [],
        payload: {
          tokenId: 'token-pikachu',
          to: { x: 3, y: 0, z: 2 },
        },
      },
    } satisfies SessionServerMessage))

    expect(sessionSocket.lastKnownRevision.value).toBe(parseSessionRevision(4))
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
