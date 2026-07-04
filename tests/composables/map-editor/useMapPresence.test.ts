import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import {
  LIVE_PLAY_PRESENCE_AUTHORITY,
  LIVE_PLAY_PRESENCE_MAX_ATTENTION_LABEL_CHARS,
  LIVE_PLAY_PRESENCE_MAX_PING_LABEL_CHARS,
  LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE,
  LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  type LivePlayPresenceEntry,
  type LivePlayPresenceSnapshot,
  type LivePlayPresenceUpdate,
} from '#shared/livePlayPresence'
import { useMapPresence } from '~/composables/map-editor/useMapPresence'

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  realtimeSubscriptions: [] as Array<{
    channel: string
    handler: (event: Record<string, unknown>) => void
    unsubscribe: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('~/utils/clientId', () => ({
  getClientId: () => 'c-local-tab',
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => ({
    getJson: mocks.getJson,
    postJson: mocks.postJson,
  }),
}))

vi.mock('~/composables/useRealtime', () => ({
  subscribeChannel: vi.fn((channel: string, handler: (event: Record<string, unknown>) => void) => {
    const unsubscribe = vi.fn()
    mocks.realtimeSubscriptions.push({ channel, handler, unsubscribe })
    return unsubscribe
  }),
}))

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

interface FakeVisibilityDocument {
  hidden: boolean
  visibilityState: 'visible' | 'hidden'
  addEventListener: (type: 'visibilitychange', listener: () => void) => void
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void
  setHidden: (hidden: boolean) => void
}

const createVisibilityDocument = (): FakeVisibilityDocument => {
  const listeners = new Set<() => void>()
  const documentRef: FakeVisibilityDocument = {
    hidden: false,
    visibilityState: 'visible',
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    setHidden(nextHidden) {
      documentRef.hidden = nextHidden
      documentRef.visibilityState = nextHidden ? 'hidden' : 'visible'
      for (const listener of Array.from(listeners)) listener()
    },
  }
  return documentRef
}

const presenceEntry = (overrides: Partial<LivePlayPresenceEntry> = {}): LivePlayPresenceEntry => ({
  schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  authority: LIVE_PLAY_PRESENCE_AUTHORITY,
  clientSequence: 1,
  selectedTokenId: null,
  hoveredTokenId: null,
  intent: { kind: 'idle' },
  ping: null,
  attention: null,
  participant: {
    role: 'player',
    profileDisplayName: 'Ash',
    clientIdSuffix: 'facefeed',
    accent: 'blue',
  },
  lastSeenAt: 900,
  expiresAt: 16_000,
  ...overrides,
})

const presenceSnapshot = (
  entries: readonly LivePlayPresenceEntry[] = [],
  overrides: Partial<LivePlayPresenceSnapshot> = {},
): LivePlayPresenceSnapshot => ({
  schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  authority: LIVE_PLAY_PRESENCE_AUTHORITY,
  mapSlug: 'arena',
  serverTime: 1_000,
  entries,
  ...overrides,
})

beforeEach(() => {
  mocks.getJson.mockReset()
  mocks.postJson.mockReset()
  mocks.realtimeSubscriptions.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useMapPresence', () => {
  it('loads the initial presence snapshot on start', async () => {
    let now = 1_000
    const profileId = ref('profile_ash00000')
    const snapshot = presenceSnapshot([
      presenceEntry({ selectedTokenId: 'token-pikachu' }),
    ])
    mocks.getJson.mockResolvedValue(snapshot)
    mocks.postJson.mockResolvedValue(snapshot)

    const presence = useMapPresence({
      slug: 'arena',
      profileId,
      document: createVisibilityDocument(),
      now: () => now,
    })
    await flushPromises()

    expect(mocks.getJson).toHaveBeenCalledWith('/api/maps/arena/presence', {
      params: { profileId: 'profile_ash00000' },
    })
    expect(mocks.realtimeSubscriptions).toHaveLength(1)
    expect(mocks.realtimeSubscriptions[0]?.channel).toBe('map:arena')
    expect(presence.entries.value).toEqual([
      expect.objectContaining({ selectedTokenId: 'token-pikachu' }),
    ])
    expect(presence.status.value).toBe('ready')
    expect(presence.error.value).toBeNull()
    expect(presence.transportFreshness.value.lastSnapshotAt).toBe(1_000)

    now = 2_000
    presence.dispose()
  })

  it('publishes heartbeat updates from the local own-presence state', async () => {
    let now = 2_000
    const heartbeatSnapshot = presenceSnapshot([
      presenceEntry({
        clientSequence: 1,
        selectedTokenId: 'token-pikachu',
        participant: {
          role: 'gm',
          clientIdSuffix: 'local-tab',
          accent: 'violet',
        },
        lastSeenAt: 2_000,
        expiresAt: 17_000,
      }),
    ], { serverTime: 2_000 })
    mocks.postJson.mockResolvedValue(heartbeatSnapshot)

    const presence = useMapPresence({
      slug: 'arena',
      autoStart: false,
      profileId: ref(null),
      now: () => now,
    })

    await expect(presence.updateOwnPresence({ selectedTokenId: 'token-pikachu' })).resolves.toBe(true)

    expect(presence.ownPresence.value).toMatchObject({
      clientSequence: 1,
      selectedTokenId: 'token-pikachu',
      hoveredTokenId: null,
      intent: { kind: 'idle' },
    })
    expect(mocks.postJson).toHaveBeenCalledWith('/api/maps/arena/presence', {
      presence: expect.objectContaining({
        clientSequence: 1,
        selectedTokenId: 'token-pikachu',
      }),
      clientId: 'client_c-local-tab',
    })
    expect(presence.entries.value).toEqual([
      expect.objectContaining({
        clientSequence: 1,
        selectedTokenId: 'token-pikachu',
        participant: expect.objectContaining({ role: 'gm' }),
      }),
    ])
    expect(presence.transportFreshness.value.lastHeartbeatAt).toBe(2_000)

    now = 2_500
    presence.dispose()
  })

  it('sanitizes own token presence against the visible token set before publishing', async () => {
    let now = 2_000
    const visibleTokenIds = ref<readonly string[]>(['token-pikachu'])
    mocks.postJson.mockResolvedValue(presenceSnapshot([], { serverTime: 2_000 }))

    const presence = useMapPresence({
      slug: 'arena',
      autoStart: false,
      visibleTokenIds,
      now: () => now,
    })

    await expect(presence.updateOwnPresence({
      selectedTokenId: 'token-pikachu',
      hoveredTokenId: 'token-hidden',
      intent: { kind: 'targeting', sourceTokenId: 'token-hidden', candidateCount: 2 },
    })).resolves.toBe(true)

    expect(presence.ownPresence.value).toMatchObject({
      clientSequence: 1,
      selectedTokenId: 'token-pikachu',
      hoveredTokenId: null,
      intent: { kind: 'targeting', candidateCount: 2 },
    })
    expect(presence.ownPresence.value.intent).not.toHaveProperty('sourceTokenId')
    expect(mocks.postJson).toHaveBeenCalledWith('/api/maps/arena/presence', {
      presence: expect.objectContaining({
        clientSequence: 1,
        selectedTokenId: 'token-pikachu',
        hoveredTokenId: null,
        intent: { kind: 'targeting', candidateCount: 2 },
      }),
      clientId: 'client_c-local-tab',
    })

    visibleTokenIds.value = []
    now = 2_500
    mocks.postJson.mockClear()
    mocks.postJson.mockResolvedValue(presenceSnapshot([], { serverTime: 2_500 }))

    await presence.sendHeartbeat()

    expect(presence.ownPresence.value).toMatchObject({
      clientSequence: 2,
      selectedTokenId: null,
      hoveredTokenId: null,
      intent: { kind: 'targeting', candidateCount: 2 },
    })
    expect(mocks.postJson).toHaveBeenCalledWith('/api/maps/arena/presence', {
      presence: expect.objectContaining({
        clientSequence: 2,
        selectedTokenId: null,
        hoveredTokenId: null,
        intent: { kind: 'targeting', candidateCount: 2 },
      }),
      clientId: 'client_c-local-tab',
    })

    presence.dispose()
  })

  it('uses the current profile id and drops inaccessible token references before outgoing heartbeats', async () => {
    let now = 3_000
    const profileId = ref('profile_ash00000')
    const visibleTokenIds = ref<readonly string[]>(['token-pikachu'])
    mocks.postJson.mockResolvedValue(presenceSnapshot([], { serverTime: 3_000 }))

    const presence = useMapPresence({
      slug: 'arena',
      autoStart: false,
      profileId,
      visibleTokenIds,
      now: () => now,
    })

    await expect(presence.updateOwnPresence({
      selectedTokenId: 'token-pikachu',
      attention: {
        id: 'attn1',
        target: { kind: 'token', tokenId: 'token-hidden' },
        createdAt: 3_000,
        expiresAt: 11_000,
      },
    }, { publish: false })).resolves.toBe(true)
    expect(presence.ownPresence.value).toMatchObject({
      clientSequence: 1,
      selectedTokenId: 'token-pikachu',
      attention: null,
    })

    profileId.value = 'profile_brock000'
    visibleTokenIds.value = []
    now = 3_500
    mocks.postJson.mockResolvedValue(presenceSnapshot([], { serverTime: 3_500 }))

    await presence.sendHeartbeat()

    expect(presence.ownPresence.value).toMatchObject({
      clientSequence: 2,
      selectedTokenId: null,
      attention: null,
    })
    expect(mocks.postJson).toHaveBeenCalledWith('/api/maps/arena/presence', {
      presence: expect.objectContaining({
        clientSequence: 2,
        selectedTokenId: null,
        attention: null,
      }),
      clientId: 'client_c-local-tab',
      profileId: 'profile_brock000',
    })

    presence.dispose()
  })

  it('applies transient realtime snapshots for the current map', async () => {
    let now = 3_000
    mocks.getJson.mockResolvedValue(presenceSnapshot([], { serverTime: 3_000 }))
    mocks.postJson.mockResolvedValue(presenceSnapshot([], { serverTime: 3_000 }))

    const presence = useMapPresence({
      slug: 'arena',
      document: createVisibilityDocument(),
      now: () => now,
    })
    await flushPromises()

    now = 3_250
    mocks.realtimeSubscriptions[0]?.handler({
      channel: 'map:arena',
      type: LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE,
      mapSlug: 'arena',
      timestamp: 3_250,
      data: presenceSnapshot([
        presenceEntry({
          participant: {
            role: 'player',
            profileDisplayName: 'Misty',
            clientIdSuffix: 'remote99',
            accent: 'cyan',
          },
          hoveredTokenId: 'token-staryu',
          lastSeenAt: 3_200,
          expiresAt: 18_200,
        }),
      ], { serverTime: 3_250 }),
    })

    expect(presence.entries.value).toEqual([
      expect.objectContaining({
        hoveredTokenId: 'token-staryu',
        participant: expect.objectContaining({ profileDisplayName: 'Misty' }),
      }),
    ])
    expect(presence.transportFreshness.value.lastTransientAt).toBe(3_250)

    mocks.realtimeSubscriptions[0]?.handler({
      channel: 'map:other-map',
      type: LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE,
      mapSlug: 'other-map',
      timestamp: 3_300,
      data: presenceSnapshot([], { mapSlug: 'other-map', serverTime: 3_300 }),
    })
    expect(presence.entries.value).toHaveLength(1)

    presence.dispose()
  })

  it('locally expires stale entries when heartbeats stop', async () => {
    vi.useFakeTimers()
    let now = 1_000
    mocks.getJson.mockResolvedValue(presenceSnapshot([], { serverTime: 1_000 }))
    mocks.postJson.mockResolvedValue(presenceSnapshot([], { serverTime: 1_000 }))

    const presence = useMapPresence({
      slug: 'arena',
      document: createVisibilityDocument(),
      heartbeatIntervalMs: 10_000,
      expirySweepIntervalMs: 100,
      now: () => now,
    })
    await flushPromises()

    mocks.realtimeSubscriptions[0]?.handler({
      channel: 'map:arena',
      type: LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE,
      mapSlug: 'arena',
      timestamp: 1_000,
      data: presenceSnapshot([
        presenceEntry({ lastSeenAt: 900, expiresAt: 1_500 }),
      ], { serverTime: 1_000 }),
    })
    expect(presence.entries.value).toHaveLength(1)

    now = 1_501
    await vi.advanceTimersByTimeAsync(100)

    expect(presence.entries.value).toEqual([])
    presence.dispose()
  })

  it('publishes sanitized map pings and exposes creator summaries from heartbeat snapshots', async () => {
    const createdAt = 4_000
    const expectedLabel = 'L'.repeat(LIVE_PLAY_PRESENCE_MAX_PING_LABEL_CHARS)
    mocks.postJson.mockImplementation(async (_path, body) => {
      const request = body as { presence: LivePlayPresenceUpdate }
      return presenceSnapshot([
        presenceEntry({
          clientSequence: request.presence.clientSequence,
          intent: request.presence.intent,
          ping: request.presence.ping,
          participant: {
            role: 'player',
            profileDisplayName: 'Brock',
            clientIdSuffix: 'creator1',
            accent: 'amber',
          },
          lastSeenAt: createdAt,
          expiresAt: 19_000,
        }),
      ], { serverTime: createdAt })
    })

    const presence = useMapPresence({
      slug: 'arena',
      autoStart: false,
      now: () => createdAt,
      pingIdFactory: () => 'pmanual1',
    })

    await expect(presence.placePing(
      { x: 2, y: 0, z: 3 },
      { label: ` <${'L'.repeat(LIVE_PLAY_PRESENCE_MAX_PING_LABEL_CHARS + 8)}\n> ` },
    )).resolves.toBe(true)

    expect(presence.ownPresence.value).toMatchObject({
      clientSequence: 1,
      intent: { kind: 'placing-ping' },
      ping: {
        id: 'pmanual1',
        cell: { x: 2, y: 0, z: 3 },
        label: expectedLabel,
        createdAt,
        expiresAt: createdAt + 4_000,
      },
    })
    expect(mocks.postJson).toHaveBeenCalledWith('/api/maps/arena/presence', {
      presence: expect.objectContaining({
        clientSequence: 1,
        intent: { kind: 'placing-ping' },
        ping: expect.objectContaining({
          id: 'pmanual1',
          label: expectedLabel,
        }),
      }),
      clientId: 'client_c-local-tab',
    })
    expect(presence.pings.value).toEqual([
      expect.objectContaining({
        id: 'pmanual1',
        cell: { x: 2, y: 0, z: 3 },
        label: expectedLabel,
        creator: expect.objectContaining({ profileDisplayName: 'Brock', clientIdSuffix: 'creator1' }),
      }),
    ])

    presence.dispose()
  })

  it('publishes sanitized GM attention requests through own presence state', async () => {
    const createdAt = 6_000
    const expectedLabel = 'F'.repeat(LIVE_PLAY_PRESENCE_MAX_ATTENTION_LABEL_CHARS)
    mocks.postJson.mockImplementation(async (_path, body) => {
      const request = body as { presence: LivePlayPresenceUpdate }
      return presenceSnapshot([
        presenceEntry({
          clientSequence: request.presence.clientSequence,
          attention: request.presence.attention,
          participant: {
            role: 'gm',
            clientIdSuffix: 'gmfocus1',
            accent: 'violet',
          },
          lastSeenAt: createdAt,
          expiresAt: 21_000,
        }),
      ], { serverTime: createdAt })
    })

    const presence = useMapPresence({
      slug: 'arena',
      autoStart: false,
      now: () => createdAt,
      attentionIdFactory: () => 'amanual1',
    })

    await expect(presence.requestAttention(
      { kind: 'cell', cell: { x: 2, y: 0, z: 3 } },
      { label: ` <${'F'.repeat(LIVE_PLAY_PRESENCE_MAX_ATTENTION_LABEL_CHARS + 8)}\n> ` },
    )).resolves.toBe(true)

    expect(presence.ownPresence.value).toMatchObject({
      clientSequence: 1,
      attention: {
        id: 'amanual1',
        target: { kind: 'cell', cell: { x: 2, y: 0, z: 3 } },
        label: expectedLabel,
        createdAt,
        expiresAt: createdAt + 8_000,
      },
    })
    expect(mocks.postJson).toHaveBeenCalledWith('/api/maps/arena/presence', {
      presence: expect.objectContaining({
        clientSequence: 1,
        attention: expect.objectContaining({
          id: 'amanual1',
          label: expectedLabel,
        }),
      }),
      clientId: 'client_c-local-tab',
    })
    expect(presence.entries.value).toEqual([
      expect.objectContaining({
        attention: expect.objectContaining({ id: 'amanual1', label: expectedLabel }),
        participant: expect.objectContaining({ role: 'gm', clientIdSuffix: 'gmfocus1' }),
      }),
    ])

    presence.dispose()
  })

  it('locally expires presence pings before their participant entry expires', async () => {
    vi.useFakeTimers()
    let now = 10_000
    mocks.getJson.mockResolvedValue(presenceSnapshot([], { serverTime: 10_000 }))
    mocks.postJson.mockResolvedValue(presenceSnapshot([], { serverTime: 10_000 }))

    const presence = useMapPresence({
      slug: 'arena',
      document: createVisibilityDocument(),
      heartbeatIntervalMs: 10_000,
      expirySweepIntervalMs: 100,
      now: () => now,
    })
    await flushPromises()

    mocks.realtimeSubscriptions[0]?.handler({
      channel: 'map:arena',
      type: LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE,
      mapSlug: 'arena',
      timestamp: 10_000,
      data: presenceSnapshot([
        presenceEntry({
          ping: {
            id: 'premote1',
            cell: { x: 1, y: 0, z: 2 },
            label: 'Here',
            createdAt: 10_000,
            expiresAt: 10_400,
          },
          lastSeenAt: 10_000,
          expiresAt: 25_000,
        }),
      ], { serverTime: 10_000 }),
    })
    expect(presence.pings.value).toEqual([
      expect.objectContaining({ id: 'premote1', label: 'Here' }),
    ])
    expect(presence.entries.value[0]?.ping).toEqual(expect.objectContaining({ id: 'premote1' }))

    now = 10_401
    await vi.advanceTimersByTimeAsync(100)

    expect(presence.pings.value).toEqual([])
    expect(presence.entries.value).toEqual([
      expect.objectContaining({ ping: null, expiresAt: 25_000 }),
    ])
    presence.dispose()
  })

  it('uses a slower heartbeat interval while the tab is hidden', async () => {
    vi.useFakeTimers()
    let now = 5_000
    const visibilityDocument = createVisibilityDocument()
    mocks.getJson.mockResolvedValue(presenceSnapshot([], { serverTime: 5_000 }))
    mocks.postJson.mockResolvedValue(presenceSnapshot([], { serverTime: 5_000 }))

    const presence = useMapPresence({
      slug: 'arena',
      document: visibilityDocument,
      heartbeatIntervalMs: 100,
      hiddenHeartbeatIntervalMs: 500,
      expirySweepIntervalMs: 1_000,
      now: () => now,
    })
    await flushPromises()
    mocks.postJson.mockClear()

    now = 5_100
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    expect(mocks.postJson).toHaveBeenCalledTimes(1)

    mocks.postJson.mockClear()
    visibilityDocument.setHidden(true)
    expect(presence.transportFreshness.value.hidden).toBe(true)
    expect(presence.transportFreshness.value.heartbeatIntervalMs).toBe(500)

    now = 5_599
    await vi.advanceTimersByTimeAsync(499)
    await flushPromises()
    expect(mocks.postJson).not.toHaveBeenCalled()

    now = 5_600
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(mocks.postJson).toHaveBeenCalledTimes(1)

    presence.dispose()
  })

  it('records presence transport errors without throwing to callers', async () => {
    const commandDispatch = vi.fn(() => 'accepted')
    mocks.postJson.mockRejectedValue(new Error('presence transport offline'))

    const presence = useMapPresence({
      slug: 'arena',
      autoStart: false,
      now: () => 8_000,
    })

    await expect(presence.sendHeartbeat()).resolves.toBeUndefined()

    expect(presence.status.value).toBe('error')
    expect(presence.error.value).toContain('presence transport offline')
    expect(commandDispatch()).toBe('accepted')
    presence.dispose()
  })
})
