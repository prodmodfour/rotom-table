import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
  type SessionCommandEnvelope,
} from '#shared/sessionCommands'
import { SESSION_COMMAND_RESULT_SCHEMA_VERSION } from '#shared/sessionCommandResults'
import {
  SESSION_MESSAGE_SCHEMA_VERSION,
  type SessionClientMessage,
  type SessionServerMessage,
} from '#shared/sessionMessages'
import {
  parseClientId,
  parseGmKey,
  parseSessionId,
} from '#shared/sessionIdentity'
import {
  isSessionRevision,
  parseMapRevision,
  parseSessionRevision,
  type SessionRevision,
} from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
} from '#shared/sessionState'
import {
  createSessionClientHelloMessage,
  type CreateSessionClientHelloMessageOptions,
  type SessionSocketMessageHandler,
  type SessionSocketSendResult,
} from '~/composables/useSessionSocket'
import {
  createSessionCommandClientMessage,
  useSessionMap,
  type SessionMapSocket,
} from '~/composables/map-editor/useSessionMap'
import type { TabletopMap } from '~/types/map'
import type { SessionClientIdentityStorage } from '~/utils/sessionClientIdentityStorage'

const SESSION_ID = parseSessionId('session_abcdefghijkl')
const OTHER_SESSION_ID = parseSessionId('session_bcdefghijklm')
const GM_CLIENT_ID = parseClientId('client_gmclient01')
const OTHER_CLIENT_ID = parseClientId('client_othergm01')
const GM_KEY = parseGmKey('gmkey_abcdefghijklmnopqrstuvwxyz')
const OP_ID = parseOpId('op_12345678')
const REVISION_0 = parseSessionRevision(0)
const REVISION_1 = parseSessionRevision(1)
const REVISION_2 = parseSessionRevision(2)
const REVISION_3 = parseSessionRevision(3)
const MAP_REVISION_1 = parseMapRevision(1)

const gmIdentity = (
  overrides: Partial<Extract<SessionClientIdentity, { role: 'gm' }>> = {},
): Extract<SessionClientIdentity, { role: 'gm' }> => ({
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'gm',
  sessionId: SESSION_ID,
  clientId: GM_CLIENT_ID,
  gmKey: GM_KEY,
  rememberedAt: '2026-05-26T12:00:00.000Z',
  lastSeenRevision: REVISION_1,
  ...overrides,
})

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
      position: { x: 1, y: 0, z: 1 },
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
  sequence = 1,
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

class FakeSessionMapSocket implements SessionMapSocket {
  readonly status = ref<'idle' | 'unavailable' | 'connecting' | 'open' | 'closing' | 'closed' | 'error'>('idle')
  readonly helloStatus = ref<'idle' | 'queued' | 'sent' | 'accepted' | 'rejected'>('idle')
  readonly heartbeatStatus = ref<'idle' | 'active' | 'stale'>('idle')
  readonly reconnectStatus = ref<'idle' | 'resumed' | 'snapshot-required' | 'snapshot-received'>('idle')
  readonly lastError = ref<string | null>(null)
  readonly lastKnownRevision = ref<SessionRevision | null>(null)
  readonly lastSnapshot = ref(null)
  readonly handlers: SessionSocketMessageHandler<SessionServerMessage>[] = []
  readonly sentHellos: Array<{
    readonly identity: SessionClientIdentity
    readonly options: CreateSessionClientHelloMessageOptions | undefined
  }> = []
  readonly sentMessages: SessionClientMessage[] = []
  connectResult = true
  cleanupCount = 0
  sendResult: Extract<SessionSocketSendResult<SessionClientMessage>, { readonly ok: false }> | null = null

  connect(): boolean {
    if (!this.connectResult) {
      this.status.value = 'unavailable'
      this.lastError.value = 'socket unavailable'
      return false
    }
    if (this.status.value === 'idle' || this.status.value === 'closed') this.status.value = 'connecting'
    return true
  }

  disconnect(): void {
    this.status.value = 'closed'
  }

  cleanup(): void {
    this.cleanupCount += 1
    this.status.value = 'closed'
  }

  sendHello(
    identity: SessionClientIdentity,
    options?: CreateSessionClientHelloMessageOptions,
  ): SessionSocketSendResult<SessionClientMessage> {
    this.sentHellos.push({ identity, options })
    const message = createSessionClientHelloMessage(identity, options)
    this.helloStatus.value = 'queued'
    return queuedResult(message, this.sentHellos.length)
  }

  send(message: SessionClientMessage): SessionSocketSendResult<SessionClientMessage> {
    if (this.sendResult !== null) return this.sendResult
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
    if (message.type === 'snapshot') {
      this.lastSnapshot.value = message as never
      if (isSessionRevision(message.currentRevision)) this.lastKnownRevision.value = message.currentRevision
      if (message.reason === 'reconnect') this.reconnectStatus.value = 'snapshot-received'
    } else if (message.type === 'hello') {
      this.helloStatus.value = 'accepted'
      if (isSessionRevision(message.currentRevision)) this.lastKnownRevision.value = message.currentRevision
    } else if (message.type === 'patch') {
      if (isSessionRevision(message.event.revision)) this.lastKnownRevision.value = message.event.revision
    } else if (message.type === 'commandAck' || message.type === 'commandReject') {
      if (isSessionRevision(message.result.currentRevision)) this.lastKnownRevision.value = message.result.currentRevision
    } else if (message.type === 'presence') {
      if (isSessionRevision(message.currentRevision)) this.lastKnownRevision.value = message.currentRevision
    } else if (message.type === 'error' && isSessionRevision(message.currentRevision)) {
      this.lastKnownRevision.value = message.currentRevision
    }

    for (const handler of [...this.handlers]) handler(message, JSON.stringify(message))
  }
}

const snapshotMessage = (map: TabletopMap): SessionServerMessage => ({
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
      document: map,
    })],
    createdAt: '2026-05-26T12:00:00.000Z',
  }),
})

const patchMessage = (revision = REVISION_3): SessionServerMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'patch',
  direction: 'server',
  sessionId: SESSION_ID,
  event: {
    eventType: 'tokenMoved',
    revision,
    scopes: [],
    payload: {
      tokenId: 'token-pikachu',
      mapSlug: 'arena-map',
      from: { x: 5, y: 0, z: 5 },
      to: { x: 2, y: 0, z: 2 },
    },
  },
})

const commandFixture = (
  overrides: Partial<SessionCommandEnvelope> = {},
): SessionCommandEnvelope => ({
    schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
    type: 'testCommand',
    sessionId: SESSION_ID,
    actor: {
      role: 'gm',
      clientId: GM_CLIENT_ID,
    },
    opId: OP_ID,
    baseRevision: REVISION_1,
    scopes: [{ lane: 'map', mapSlug: 'arena-map' }],
    payload: { ok: true },
    ...overrides,
  })

describe('createSessionCommandClientMessage', () => {
  it('wraps command envelopes as schema-versioned client command messages', () => {
    const command = commandFixture()

    expect(createSessionCommandClientMessage(command)).toEqual({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'command',
      direction: 'client',
      sessionId: SESSION_ID,
      command,
    })
  })
})

describe('useSessionMap', () => {
  it('loads the remembered identity and requests a reconnect snapshot over the session socket', () => {
    const identity = gmIdentity()
    const storage = createStorage(identity)
    const socket = new FakeSessionMapSocket()
    const sessionMap = useSessionMap({
      enabled: ref(true),
      localMap: ref(mapFixture()),
      mapSlug: 'arena-map',
      identityStorage: storage,
      socket,
    })

    const result = sessionMap.loadSessionSnapshot()

    expect(result).toMatchObject({ ok: true, delivery: 'hello-queued' })
    expect(socket.status.value).toBe('connecting')
    expect(socket.sentHellos).toHaveLength(1)
    expect(socket.sentHellos[0]?.identity).toEqual({
      schemaVersion: identity.schemaVersion,
      role: 'gm',
      sessionId: identity.sessionId,
      clientId: identity.clientId,
      gmKey: identity.gmKey,
      rememberedAt: identity.rememberedAt,
    })
    expect(socket.sentHellos[0]?.options).toEqual({ reconnect: true })
    expect(socket.sentHellos[0]?.identity).not.toHaveProperty('lastSeenRevision')
    expect(sessionMap.snapshotStatus.value).toBe('requested')
    expect(sessionMap.status.value).toBe('connecting')
  })

  it('refreshes the session snapshot by resetting the socket and forcing a fresh reconnect hello', () => {
    const identity = gmIdentity()
    const storage = createStorage(identity)
    const socket = new FakeSessionMapSocket()
    socket.status.value = 'open'
    socket.helloStatus.value = 'accepted'
    const sessionMap = useSessionMap({
      enabled: ref(true),
      localMap: ref(mapFixture()),
      mapSlug: 'arena-map',
      identityStorage: storage,
      socket,
    })

    const result = sessionMap.refreshSessionSnapshot()

    expect(result).toMatchObject({ ok: true, delivery: 'hello-queued' })
    expect(socket.cleanupCount).toBe(1)
    expect(socket.status.value).toBe('connecting')
    expect(socket.sentHellos).toHaveLength(1)
    expect(socket.sentHellos[0]?.identity).not.toHaveProperty('lastSeenRevision')
    expect(socket.sentHellos[0]?.options).toEqual({ reconnect: true })
  })

  it('adopts session snapshots and patches from socket events without mutating the local editable map', () => {
    const identity = gmIdentity()
    const storage = createStorage(identity)
    const localMap = ref(mapFixture({ name: 'Local Map' }))
    const socket = new FakeSessionMapSocket()
    socket.status.value = 'open'
    socket.helloStatus.value = 'accepted'

    const sessionMap = useSessionMap({
      enabled: ref(true),
      localMap,
      mapSlug: 'arena-map',
      identityStorage: storage,
      socket,
      now: () => '2026-05-26T12:05:00.000Z',
    })

    socket.emit(snapshotMessage(mapFixture({
      name: 'Authoritative Map',
      placements: [{
        id: 'token-pikachu',
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
        position: { x: 5, y: 0, z: 5 },
      }],
    })))

    expect(sessionMap.map.value?.name).toBe('Authoritative Map')
    expect(sessionMap.map.value?.placements[0]?.position).toEqual({ x: 5, y: 0, z: 5 })
    expect(localMap.value.name).toBe('Local Map')
    expect(localMap.value.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })
    expect(sessionMap.snapshotStatus.value).toBe('received')
    expect(sessionMap.status.value).toBe('ready')
    expect(storage.remember).toHaveBeenLastCalledWith({
      ...identity,
      rememberedAt: '2026-05-26T12:05:00.000Z',
      lastSeenRevision: REVISION_2,
    })

    socket.emit(patchMessage())

    expect(sessionMap.map.value?.placements[0]?.position).toEqual({ x: 2, y: 0, z: 2 })
    expect(localMap.value.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })
    expect(sessionMap.mapState.lastAppliedPatch.value).toEqual({
      eventType: 'tokenMoved',
      revision: REVISION_3,
      mapSlug: 'arena-map',
    })
    expect(storage.remember).toHaveBeenLastCalledWith({
      ...identity,
      rememberedAt: '2026-05-26T12:05:00.000Z',
      lastSeenRevision: REVISION_3,
    })
  })

  it('dispatches commands through the shared socket after ensuring hello/auth is queued', () => {
    const identity = gmIdentity()
    const storage = createStorage(identity)
    const socket = new FakeSessionMapSocket()
    const sessionMap = useSessionMap({
      enabled: ref(true),
      localMap: ref(mapFixture()),
      mapSlug: 'arena-map',
      identityStorage: storage,
      socket,
    })
    const command = commandFixture()

    const result = sessionMap.dispatchCommand(command)

    expect(result).toMatchObject({ dispatched: true })
    expect(socket.sentHellos).toHaveLength(1)
    expect(socket.sentMessages).toEqual([{
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'command',
      direction: 'client',
      sessionId: SESSION_ID,
      command,
    }])
    expect(sessionMap.lastError.value).toBeNull()
  })

  it('rejects local command dispatch for different sessions or actors before sending', () => {
    const identity = gmIdentity()
    const storage = createStorage(identity)
    const socket = new FakeSessionMapSocket()
    const sessionMap = useSessionMap({
      enabled: ref(true),
      localMap: ref(mapFixture()),
      mapSlug: 'arena-map',
      identityStorage: storage,
      socket,
    })

    expect(sessionMap.dispatchCommand(commandFixture({ sessionId: OTHER_SESSION_ID }))).toMatchObject({
      dispatched: false,
      reason: 'session-mismatch',
    })
    expect(sessionMap.dispatchCommand(commandFixture({
      actor: { role: 'gm', clientId: OTHER_CLIENT_ID },
    }))).toMatchObject({
      dispatched: false,
      reason: 'actor-mismatch',
    })
    expect(socket.sentHellos).toHaveLength(0)
    expect(socket.sentMessages).toHaveLength(0)
  })

  it('exposes server command rejection and error state for rejection UI surfaces', () => {
    const identity = gmIdentity({ lastSeenRevision: REVISION_0 })
    const storage = createStorage(identity)
    const socket = new FakeSessionMapSocket()
    const sessionMap = useSessionMap({
      enabled: ref(true),
      localMap: ref(mapFixture()),
      mapSlug: 'arena-map',
      identityStorage: storage,
      socket,
    })
    const rejectMessage: SessionServerMessage = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'commandReject',
      direction: 'server',
      sessionId: SESSION_ID,
      result: {
        schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
        status: 'rejected',
        accepted: false,
        reason: 'invalid',
        message: 'That command was malformed.',
        retryable: false,
        sessionId: SESSION_ID,
        opId: OP_ID,
        commandType: 'testCommand',
        actor: { role: 'gm', clientId: GM_CLIENT_ID },
        currentRevision: REVISION_1,
        scopes: [],
        issues: [],
      },
    }
    const serverError: SessionServerMessage = {
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'error',
      direction: 'server',
      sessionId: SESSION_ID,
      code: 'internal-error',
      message: 'Session socket failed safely.',
      retryable: true,
      currentRevision: REVISION_2,
    }

    socket.emit(rejectMessage)

    expect(sessionMap.lastCommandReject.value).toEqual(rejectMessage)
    expect(sessionMap.error.value).toBe('That command was malformed.')
    expect(storage.remember).toHaveBeenLastCalledWith({
      ...identity,
      rememberedAt: expect.any(String),
      lastSeenRevision: REVISION_1,
    })

    socket.emit(serverError)

    expect(sessionMap.lastServerError.value).toEqual(serverError)
    expect(sessionMap.status.value).toBe('error')
    expect(sessionMap.error.value).toBe('Session socket failed safely.')
  })
})
