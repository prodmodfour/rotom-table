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
import type { TabletopMap } from '~/types/map'
import { closeRotomDatabase, getRotomDatabase, ROTOM_DB_PATH_ENV } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
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

type RouteHandler = EventHandler<EventHandlerRequest, unknown>
type TestRole = 'gm' | 'player'

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
  },
): Promise<{ readonly response: unknown; readonly headers: ReadonlyMap<string, string> }> => {
  const requestHeaders: Record<string, string> = {}
  if (options.role) requestHeaders.cookie = `rotom-role=${options.role}`

  const query = new URLSearchParams(
    Object.entries(options.query ?? {}).map(([key, value]) => [key, String(value)]),
  ).toString()
  const path = `/api/maps/${options.slug}/presence${query ? `?${query}` : ''}`
  const responseHeaders = new Map<string, string>()

  const response = await handler({
    method: 'GET',
    path,
    node: {
      req: {
        url: path,
        headers: requestHeaders,
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
