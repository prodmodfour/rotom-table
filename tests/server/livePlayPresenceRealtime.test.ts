import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_ROLE_COOKIE } from '#shared/auth'
import {
  LIVE_PLAY_PRESENCE_AUTHORITY,
  LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE,
  LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  parseLivePlayPresenceRealtimeEvent,
  type LivePlayPresenceSnapshot,
} from '#shared/livePlayPresence'
import type { RealtimeEventAccessDependencies, RealtimeDeliveryPrincipal } from '~~/server/realtime/realtimeEventAccessPolicy'
import { openRealtimeSseStream } from '~~/server/realtime/realtimeSseDelivery'
import { closeRotomDatabase, getRotomDatabase, ROTOM_DB_PATH_ENV } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { livePlayPresenceRegistry } from '~~/server/livePlay/presenceRegistry'
import { publishLivePlayPresenceSnapshotRealtime } from '~~/server/livePlay/presenceRealtime'
import {
  createRealtimeHub,
  subscribeTransientRealtime,
  type ScopedTransientRealtimeEvent,
} from '~~/server/utils/realtime'
import type { SseRequest, SseResponse } from '~~/server/utils/sseStream'
import type { TabletopMap } from '~/types/map'

const presencePostRoute = (await import('../../server/api/maps/[slug]/presence.post')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>

type SseFrame = {
  readonly chunk: string
  readonly data: Record<string, unknown>
}

const originalDatabasePath = process.env[ROTOM_DB_PATH_ENV]
let tempDirectory: string | null = null

const restoreEnvValue = (value: string | undefined): void => {
  if (value === undefined) delete process.env[ROTOM_DB_PATH_ENV]
  else process.env[ROTOM_DB_PATH_ENV] = value
}

const useFreshTestDatabase = (): void => {
  closeRotomDatabase()
  tempDirectory = mkdtempSync(join(tmpdir(), 'rotom-presence-realtime-'))
  process.env[ROTOM_DB_PATH_ENV] = join(tempDirectory, 'rotom-table.sqlite')
}

const cleanupTestDatabase = (): void => {
  closeRotomDatabase()
  restoreEnvValue(originalDatabasePath)
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true })
  tempDirectory = null
}

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  revision: 4,
  name: 'Arena',
  folder: '',
  dimensions: { x: 4, y: 2, z: 4 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'token-pikachu', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 1, y: 0, z: 1 } },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const presenceUpdate = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  authority: LIVE_PLAY_PRESENCE_AUTHORITY,
  clientSequence: 1,
  selectedTokenId: 'token-pikachu',
  hoveredTokenId: null,
  intent: { kind: 'idle' },
  ping: null,
  attention: null,
  ...overrides,
})

const presenceSnapshot = (mapSlug: string, overrides: Partial<LivePlayPresenceSnapshot> = {}): LivePlayPresenceSnapshot => ({
  schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  authority: LIVE_PLAY_PRESENCE_AUTHORITY,
  mapSlug,
  serverTime: 50_000,
  entries: [{
    schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
    authority: LIVE_PLAY_PRESENCE_AUTHORITY,
    clientSequence: 1,
    selectedTokenId: 'token-pikachu',
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
    lastSeenAt: 49_900,
    expiresAt: 64_900,
  }],
  ...overrides,
})

const seedMap = (map: TabletopMap): void => {
  createSqliteMapRepository<TabletopMap>(getRotomDatabase()).saveSetupMap(map)
}

const invokePresencePostRoute = async (
  handler: RouteHandler,
  options: {
    readonly slug: string
    readonly body: unknown
    readonly role?: 'gm' | 'player'
  },
): Promise<unknown> => {
  const path = `/api/maps/${options.slug}/presence`
  return await handler({
    method: 'POST',
    path,
    node: {
      req: {
        url: path,
        headers: {
          cookie: options.role ? `${AUTH_ROLE_COOKIE}=${options.role}` : '',
          'content-type': 'application/json',
        },
        body: JSON.stringify(options.body),
      },
      res: {
        setHeader: vi.fn(),
      },
    },
    context: { params: { slug: options.slug } },
  } as unknown as H3Event)
}

const createMemoryRealtimeRepository = () => ({
  cursorState: () => ({ latestSequence: 0, earliestAvailableSequence: 1 }),
  readAfter: vi.fn((input: { readonly afterSequence: number }) => ({
    status: 'ok' as const,
    requestedAfterSequence: input.afterSequence,
    earliestAvailableSequence: 1,
    latestSequence: 0,
    events: [],
    hasMore: false,
  })),
})

const createAccessDependencies = (
  maps: ReadonlyMap<string, TabletopMap>,
): RealtimeEventAccessDependencies => ({
  getMap: (slug) => maps.get(slug) ?? null,
  getSheet: () => null,
  listTrainerSheets: () => [],
  playerVisibleMapSheetAccessKeys: () => new Set(),
})

const parseSseFrames = (writes: readonly string[]): readonly SseFrame[] => (
  writes.flatMap((chunk) => {
    const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '))
    if (!dataLine) return []
    const data = JSON.parse(dataLine.slice('data: '.length)) as unknown
    return typeof data === 'object' && data !== null && !Array.isArray(data)
      ? [{ chunk, data: data as Record<string, unknown> }]
      : []
  })
)

const presenceFrames = (writes: readonly string[]): readonly SseFrame[] => (
  parseSseFrames(writes).filter((frame) => frame.data.type === LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE)
)

const waitForCaughtUp = async (writes: readonly string[]): Promise<void> => {
  await vi.waitFor(() => {
    expect(parseSseFrames(writes).some((frame) => frame.data.type === 'replay-caught-up')).toBe(true)
  })
}

const startSseStream = (input: {
  readonly principal: RealtimeDeliveryPrincipal
  readonly accessDependencies: RealtimeEventAccessDependencies
  readonly realtimeHub: ReturnType<typeof createRealtimeHub>
  readonly realtimeEventRepository: ReturnType<typeof createMemoryRealtimeRepository>
  readonly connectionId: string
}) => {
  const req = new EventEmitter() as EventEmitter & SseRequest
  const writes: string[] = []
  const res: SseResponse = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => {
      writes.push(chunk)
      return true
    }),
    end: vi.fn(),
  }
  const done = openRealtimeSseStream({
    req,
    res,
    cursor: { afterSequence: null, source: 'none' },
    principal: input.principal,
    realtimeEventRepository: input.realtimeEventRepository,
    accessDependencies: input.accessDependencies,
    realtimeHub: input.realtimeHub,
    pollIntervalMs: 60_000,
    keepaliveMs: 60_000,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    connectionId: input.connectionId,
  })

  return {
    writes,
    close: async () => {
      req.emit('close')
      await done
    },
  }
}

beforeEach(() => {
  useFreshTestDatabase()
})

afterEach(() => {
  livePlayPresenceRegistry.prune({ now: Number.MAX_SAFE_INTEGER })
  vi.restoreAllMocks()
  cleanupTestDatabase()
})

describe('live-play presence transient realtime publication', () => {
  it('broadcasts heartbeat snapshots as unsequenced transient map-access events without advancing durable realtime', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(50_000)
    seedMap(mapFixture({ slug: 'arena', revision: 4 }))
    const publications: ScopedTransientRealtimeEvent[] = []
    const unsubscribe = subscribeTransientRealtime((publication) => publications.push(publication))

    try {
      const response = await invokePresencePostRoute(presencePostRoute, {
        role: 'gm',
        slug: 'arena',
        body: {
          presence: presenceUpdate({ clientSequence: 7 }),
          clientId: 'client_gm00000001',
        },
      })

      await vi.waitFor(() => expect(publications).toHaveLength(1))
      expect(publications[0]).toMatchObject({
        access: { kind: 'map-access', mapSlug: 'arena' },
        event: {
          channel: 'map:arena',
          type: LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE,
          mapSlug: 'arena',
          timestamp: 50_000,
          data: response,
        },
      })
      expect(publications[0]?.event).not.toHaveProperty('sequence')
      expect(publications[0]?.event).not.toHaveProperty('revision')
      expect(publications[0]?.event).not.toHaveProperty('previousRevision')
      expect(publications[0]?.event).not.toHaveProperty('opId')
      expect(publications[0]?.event).not.toHaveProperty('patches')
      expect(publications[0]?.event).not.toHaveProperty('clientId')
      expect(parseLivePlayPresenceRealtimeEvent(publications[0]?.event).valid).toBe(true)
      expect(createSqliteRealtimeEventRepository({ database: getRotomDatabase() }).cursorState().latestSequence).toBe(0)
    } finally {
      unsubscribe()
    }
  })

  it('delivers transient snapshots only to currently authorised map viewers and never replays them to late streams', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(60_000)
    const visibleMap = mapFixture({ slug: 'visible-arena', playerVisible: true })
    const hiddenMap = mapFixture({ slug: 'hidden-arena', playerVisible: false, name: 'Hidden Realtime Secret Vault' })
    const maps = new Map<string, TabletopMap>([
      [visibleMap.slug, visibleMap],
      [hiddenMap.slug, hiddenMap],
    ])
    const accessDependencies = createAccessDependencies(maps)
    const realtimeHub = createRealtimeHub()
    const realtimeEventRepository = createMemoryRealtimeRepository()
    const streams = [
      startSseStream({
        principal: { role: 'gm' },
        accessDependencies,
        realtimeHub,
        realtimeEventRepository,
        connectionId: 'presence-gm',
      }),
      startSseStream({
        principal: { role: 'player', playerProfile: null, sessionAccess: null },
        accessDependencies,
        realtimeHub,
        realtimeEventRepository,
        connectionId: 'presence-player',
      }),
      startSseStream({
        principal: {
          role: 'player',
          playerProfile: {
            schemaVersion: 1,
            id: 'profile_ash00000',
            displayName: 'Ash',
            linkedCharacters: [],
          },
          sessionAccess: null,
        } as unknown as RealtimeDeliveryPrincipal,
        accessDependencies,
        realtimeHub,
        realtimeEventRepository,
        connectionId: 'presence-profiled-player',
      }),
    ]

    try {
      await Promise.all(streams.map((stream) => waitForCaughtUp(stream.writes)))

      publishLivePlayPresenceSnapshotRealtime(
        presenceSnapshot('visible-arena'),
        realtimeHub.publishTransientRealtime,
      )

      await vi.waitFor(() => {
        expect(presenceFrames(streams[0]!.writes).map((frame) => frame.data.mapSlug)).toContain('visible-arena')
        expect(presenceFrames(streams[1]!.writes).map((frame) => frame.data.mapSlug)).toContain('visible-arena')
        expect(presenceFrames(streams[2]!.writes).map((frame) => frame.data.mapSlug)).toContain('visible-arena')
      })

      const latePlayerStream = startSseStream({
        principal: { role: 'player', playerProfile: null, sessionAccess: null },
        accessDependencies,
        realtimeHub,
        realtimeEventRepository,
        connectionId: 'presence-late-player',
      })
      streams.push(latePlayerStream)
      await waitForCaughtUp(latePlayerStream.writes)
      expect(presenceFrames(latePlayerStream.writes)).toEqual([])

      publishLivePlayPresenceSnapshotRealtime(
        presenceSnapshot('hidden-arena'),
        realtimeHub.publishTransientRealtime,
      )

      await vi.waitFor(() => {
        expect(presenceFrames(streams[0]!.writes).map((frame) => frame.data.mapSlug)).toContain('hidden-arena')
      })
      expect(presenceFrames(streams[1]!.writes).map((frame) => frame.data.mapSlug)).not.toContain('hidden-arena')
      expect(presenceFrames(streams[2]!.writes).map((frame) => frame.data.mapSlug)).not.toContain('hidden-arena')
      expect(presenceFrames(latePlayerStream.writes).map((frame) => frame.data.mapSlug)).not.toContain('hidden-arena')

      for (const frame of [
        ...presenceFrames(streams[0]!.writes),
        ...presenceFrames(streams[1]!.writes),
        ...presenceFrames(streams[2]!.writes),
      ]) {
        expect(frame.chunk.startsWith('id:')).toBe(false)
        expect(frame.data).not.toHaveProperty('sequence')
        expect(frame.data).not.toHaveProperty('revision')
        expect(frame.data).not.toHaveProperty('access')
        expect(frame.data).not.toHaveProperty('clientId')
        const serialized = JSON.stringify(frame.data)
        expect(serialized).not.toContain('Hidden Realtime Secret Vault')
        expect(serialized).not.toContain('profile_')
        expect(serialized).not.toContain('sheetPayload')
        expect(serialized).not.toContain('commandBody')
        expect(parseLivePlayPresenceRealtimeEvent(frame.data).valid).toBe(true)
      }
    } finally {
      await Promise.all(streams.map((stream) => stream.close()))
    }
  })
})
