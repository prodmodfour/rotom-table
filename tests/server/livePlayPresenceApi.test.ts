import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_PRESENCE_AUTHORITY,
  LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
  parseLivePlayPresenceSnapshot,
} from '#shared/livePlayPresence'
import {
  SESSION_CLIENT_IDENTITY_COOKIE,
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
} from '#shared/sessionClientIdentity'
import type { TabletopMap } from '~/types/map'
import { closeRotomDatabase, getRotomDatabase, ROTOM_DB_PATH_ENV } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { livePlayPresenceRegistry, type LivePlayPresenceRegistryPrincipalContext } from '~~/server/livePlay/presenceRegistry'

const mocks = vi.hoisted(() => ({
  resolvePlayerProfileForPolicy: vi.fn(),
  getPlayerSessionAccessGrant: vi.fn(),
}))

vi.mock('../../server/policies/playerProfilePolicy', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/policies/playerProfilePolicy')>(),
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))

vi.mock('../../server/utils/sessionPlayerAccess', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/utils/sessionPlayerAccess')>(),
  getPlayerSessionAccessGrant: mocks.getPlayerSessionAccessGrant,
}))

const presenceRoute = (await import('../../server/api/maps/[slug]/presence.get')).default
const presencePostRoute = (await import('../../server/api/maps/[slug]/presence.post')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>
type TestRole = 'gm' | 'player'

const sessionIdentityCookie = (identity: Record<string, unknown>): string => (
  `${SESSION_CLIENT_IDENTITY_COOKIE}=${encodeURIComponent(JSON.stringify({
    schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
    sessionId: 'session_presence0001',
    rememberedAt: '2025-01-01T00:00:00.000Z',
    ...identity,
  }))}`
)

const originalDatabasePath = process.env[ROTOM_DB_PATH_ENV]
let tempDirectory: string | null = null

const restoreEnvValue = (value: string | undefined): void => {
  if (value === undefined) delete process.env[ROTOM_DB_PATH_ENV]
  else process.env[ROTOM_DB_PATH_ENV] = value
}

const useFreshTestDatabase = (): void => {
  closeRotomDatabase()
  tempDirectory = mkdtempSync(join(tmpdir(), 'rotom-presence-api-'))
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
  ...overrides,
})

const playerPrincipal = (
  overrides: Partial<LivePlayPresenceRegistryPrincipalContext> = {},
): LivePlayPresenceRegistryPrincipalContext => ({
  role: 'player',
  clientId: 'client_secretabcdef01',
  profileContextKey: 'profile_secret_ash',
  profileDisplayName: 'Ash',
  ...overrides,
})

const seedMap = (map: TabletopMap): void => {
  createSqliteMapRepository<TabletopMap>(getRotomDatabase()).saveSetupMap(map)
}

const seedPresence = (
  mapSlug: string,
  now: number,
  principal: LivePlayPresenceRegistryPrincipalContext = playerPrincipal(),
): void => {
  livePlayPresenceRegistry.update({
    mapSlug,
    principal,
    update: presenceUpdate(),
    now,
  })
}

const invokePresenceRoute = async (
  handler: RouteHandler,
  options: {
    readonly slug: string
    readonly role?: TestRole
    readonly query?: Record<string, unknown>
    readonly method?: 'GET' | 'POST'
    readonly body?: unknown
    readonly sessionIdentity?: Record<string, unknown>
  },
): Promise<{ readonly response: unknown; readonly headers: ReadonlyMap<string, string> }> => {
  const requestHeaders: Record<string, string> = {}
  const cookies: string[] = []
  if (options.role) cookies.push(`rotom-role=${options.role}`)
  if (options.sessionIdentity) cookies.push(sessionIdentityCookie(options.sessionIdentity))
  if (cookies.length > 0) requestHeaders.cookie = cookies.join('; ')
  if (options.body !== undefined) requestHeaders['content-type'] = 'application/json'

  const query = new URLSearchParams(
    Object.entries(options.query ?? {}).map(([key, value]) => [key, String(value)]),
  ).toString()
  const path = `/api/maps/${options.slug}/presence${query ? `?${query}` : ''}`
  const responseHeaders = new Map<string, string>()

  const response = await handler({
    method: options.method ?? 'GET',
    path,
    node: {
      req: {
        url: path,
        headers: requestHeaders,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      res: {
        setHeader: vi.fn((name: string, value: string | number | readonly string[]) => {
          responseHeaders.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value))
        }),
      },
    },
    context: { params: { slug: options.slug } },
  } as unknown as H3Event)

  return { response, headers: responseHeaders }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.resolvePlayerProfileForPolicy.mockReturnValue(null)
  mocks.getPlayerSessionAccessGrant.mockReturnValue(null)
  useFreshTestDatabase()
})

afterEach(() => {
  livePlayPresenceRegistry.prune({ now: Number.MAX_SAFE_INTEGER })
  cleanupTestDatabase()
})

describe('map live-play presence snapshot API', () => {
  it('returns a display-safe, non-cacheable presence snapshot for an authorised GM', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(20_000)
    seedMap(mapFixture({ slug: 'hidden-arena', playerVisible: false }))
    seedPresence('hidden-arena', 19_900)

    try {
      const { response, headers } = await invokePresenceRoute(presenceRoute, {
        role: 'gm',
        slug: 'hidden-arena',
      })

      expect(headers.get('cache-control')).toBe('private, no-store, no-cache, must-revalidate')
      expect(headers.get('pragma')).toBe('no-cache')
      expect(headers.get('expires')).toBe('0')
      expect(response).toMatchObject({
        schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
        authority: LIVE_PLAY_PRESENCE_AUTHORITY,
        mapSlug: 'hidden-arena',
        serverTime: 20_000,
        entries: [expect.objectContaining({
          selectedTokenId: 'token-pikachu',
          participant: expect.objectContaining({
            role: 'player',
            profileDisplayName: 'Ash',
            clientIdSuffix: 'abcdef01',
          }),
        })],
      })
      expect(parseLivePlayPresenceSnapshot(response).valid).toBe(true)

      const serialized = JSON.stringify(response)
      expect(serialized).not.toContain('client_secretabcdef01')
      expect(serialized).not.toContain('profile_secret_ash')
      expect(serialized).not.toContain('voxels')
      expect(serialized).not.toContain('placements')
      expect(serialized).not.toContain('sheetSlug')
      expect(serialized).not.toContain('mapRevision')
      expect(serialized).not.toContain('sheetPayload')
      expect(serialized).not.toContain('commandBody')
    } finally {
      now.mockRestore()
    }
  })

  it('lets profiled players read only player-visible map presence', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(30_000)
    const selectedProfile = { id: 'profile_ash00000', displayName: 'Ash', linkedCharacters: [] }
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(selectedProfile)
    seedMap(mapFixture({ slug: 'visible-arena', playerVisible: true }))
    seedMap(mapFixture({ slug: 'hidden-arena', playerVisible: false }))
    seedPresence('visible-arena', 29_900, playerPrincipal({ clientId: 'client_visible001' }))
    seedPresence('hidden-arena', 29_900, playerPrincipal({ clientId: 'client_hidden001', profileContextKey: 'profile_secret_hidden' }))

    try {
      const { response } = await invokePresenceRoute(presenceRoute, {
        role: 'player',
        slug: 'visible-arena',
        query: { profileId: 'profile_ash00000' },
      })

      expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
      expect(response).toMatchObject({
        mapSlug: 'visible-arena',
        entries: [expect.objectContaining({ participant: expect.objectContaining({ clientIdSuffix: 'sible001' }) })],
      })
      expect(JSON.stringify(response)).not.toContain('hidden001')

      await expect(invokePresenceRoute(presenceRoute, {
        role: 'player',
        slug: 'hidden-arena',
        query: { profileId: 'profile_ash00000' },
      })).rejects.toMatchObject({
        statusCode: 403,
        statusMessage: 'Map is not player visible',
      })
    } finally {
      now.mockRestore()
    }
  })

  it('rejects malformed or unauthenticated presence snapshot requests before exposing entries', async () => {
    seedMap(mapFixture({ slug: 'arena', playerVisible: true }))
    seedPresence('arena', Date.now())

    await expect(invokePresenceRoute(presenceRoute, {
      slug: 'arena',
    })).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'Login required',
    })

    await expect(invokePresenceRoute(presenceRoute, {
      role: 'gm',
      slug: '../bad',
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'slug must match /^[a-z0-9-]+$/',
    })
  })
})

describe('map live-play presence heartbeat API', () => {
  it('creates a display-safe heartbeat snapshot without mutating authoritative map or realtime state', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(40_000)
    const selectedProfile = { id: 'profile_ash00000', displayName: 'Ash', linkedCharacters: [] }
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(selectedProfile)
    seedMap(mapFixture({ slug: 'arena', revision: 4 }))

    try {
      const { response, headers } = await invokePresenceRoute(presencePostRoute, {
        method: 'POST',
        role: 'player',
        slug: 'arena',
        body: {
          presence: presenceUpdate({ clientSequence: 7, hoveredTokenId: 'token-pikachu' }),
          profileId: 'profile_ash00000',
          clientId: 'client_body5678',
        },
        sessionIdentity: {
          role: 'player',
          playerId: 'player_ash00000',
          displayName: 'Ash',
          clientId: 'client_sess1234',
        },
      })

      expect(headers.get('cache-control')).toBe('private, no-store, no-cache, must-revalidate')
      expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
      expect(response).toMatchObject({
        schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
        authority: LIVE_PLAY_PRESENCE_AUTHORITY,
        mapSlug: 'arena',
        serverTime: 40_000,
        entries: [expect.objectContaining({
          clientSequence: 7,
          selectedTokenId: 'token-pikachu',
          hoveredTokenId: 'token-pikachu',
          lastSeenAt: 40_000,
          expiresAt: 55_000,
          participant: expect.objectContaining({
            role: 'player',
            profileDisplayName: 'Ash',
            clientIdSuffix: 'sess1234',
          }),
        })],
      })
      expect(parseLivePlayPresenceSnapshot(response).valid).toBe(true)

      now.mockReturnValue(41_000)
      const { response: refreshed } = await invokePresenceRoute(presencePostRoute, {
        method: 'POST',
        role: 'player',
        slug: 'arena',
        body: {
          presence: presenceUpdate({ clientSequence: 8, selectedTokenId: null, hoveredTokenId: null }),
          profileId: 'profile_ash00000',
          clientId: 'client_body5678',
        },
        sessionIdentity: {
          role: 'player',
          playerId: 'player_ash00000',
          displayName: 'Ash',
          clientId: 'client_sess1234',
        },
      })
      expect(refreshed).toMatchObject({
        mapSlug: 'arena',
        serverTime: 41_000,
        entries: [expect.objectContaining({
          clientSequence: 8,
          selectedTokenId: null,
          hoveredTokenId: null,
          lastSeenAt: 41_000,
          expiresAt: 56_000,
        })],
      })
      expect((refreshed as { entries: readonly unknown[] }).entries).toHaveLength(1)
      expect(parseLivePlayPresenceSnapshot(refreshed).valid).toBe(true)

      const serialized = JSON.stringify(refreshed)
      expect(serialized).not.toContain('client_sess1234')
      expect(serialized).not.toContain('client_body5678')
      expect(serialized).not.toContain('profile_ash00000')
      expect(serialized).not.toContain('player_ash00000')
      expect(serialized).not.toContain('"ok":')
      expect(serialized).not.toContain('previousRevision')
      expect(serialized).not.toContain('patches')
      expect(serialized).not.toContain('mapRevision')

      expect(createSqliteMapRepository<TabletopMap>(getRotomDatabase()).getBySlug('arena')?.revision).toBe(4)
      expect(createSqliteRealtimeEventRepository({ database: getRotomDatabase() }).cursorState().latestSequence).toBe(0)
    } finally {
      now.mockRestore()
    }
  })

  it('rejects malformed heartbeat updates without mutating presence', async () => {
    seedMap(mapFixture({ slug: 'arena' }))

    await expect(invokePresenceRoute(presencePostRoute, {
      method: 'POST',
      role: 'gm',
      slug: 'arena',
      body: { presence: presenceUpdate({ selectedTokenId: 'token-missing' }) },
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'selectedTokenId must reference a token on the requested map.',
    })

    await expect(invokePresenceRoute(presencePostRoute, {
      method: 'POST',
      role: 'gm',
      slug: 'arena',
      body: { presence: presenceUpdate({ intent: { kind: 'targeting', sourceTokenId: 'token-missing' } }) },
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'intent.sourceTokenId must reference a token on the requested map.',
    })

    await expect(invokePresenceRoute(presencePostRoute, {
      method: 'POST',
      role: 'gm',
      slug: 'arena',
      body: {
        presence: presenceUpdate({
          selectedTokenId: null,
          ping: {
            id: 'ping1',
            cell: { x: 99, y: 0, z: 0 },
            createdAt: 1,
            expiresAt: 2,
          },
        }),
      },
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'ping.cell must be inside the requested map dimensions.',
    })

    await expect(invokePresenceRoute(presencePostRoute, {
      method: 'POST',
      role: 'gm',
      slug: 'arena',
      body: { presence: presenceUpdate({ intent: { kind: 'targeting', cell: { x: 99, y: 0, z: 0 } } }) },
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'intent.cell must be inside the requested map dimensions.',
    })

    expect(livePlayPresenceRegistry.list({ mapSlug: 'arena', now: 50_000 })).toEqual([])
  })

  it('rejects client-supplied presence identity fields before storing a heartbeat', async () => {
    seedMap(mapFixture({ slug: 'arena' }))

    await expect(invokePresenceRoute(presencePostRoute, {
      method: 'POST',
      role: 'gm',
      slug: 'arena',
      body: {
        presence: {
          ...presenceUpdate(),
          participant: { role: 'player', clientIdSuffix: 'fake0001', accent: 'rose' },
        },
      },
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'participant is not a supported live-play presence field.',
    })

    expect(livePlayPresenceRegistry.list({ mapSlug: 'arena', now: 50_000 })).toEqual([])
  })

  it('rejects heartbeat writes from players who cannot view the requested map', async () => {
    mocks.resolvePlayerProfileForPolicy.mockReturnValue({ id: 'profile_ash00000', displayName: 'Ash', linkedCharacters: [] })
    seedMap(mapFixture({ slug: 'hidden-arena', playerVisible: false }))

    await expect(invokePresenceRoute(presencePostRoute, {
      method: 'POST',
      role: 'player',
      slug: 'hidden-arena',
      body: { presence: presenceUpdate(), profileId: 'profile_ash00000' },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Map is not player visible',
    })

    expect(livePlayPresenceRegistry.list({ mapSlug: 'hidden-arena', now: 50_000 })).toEqual([])
  })
})
