import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeRealtime } from '~~/server/utils/realtime'
import { MAP_ACTION_EVENT_MAX_PAYLOAD_BYTES } from '../../server/useCases/publishMapActionEvent'
import {
  MAP_ACTION_EVENT_SCHEMA_VERSION,
  MAP_ACTION_REALTIME_EVENT_TYPE,
  type MapActionEventEnvelope,
} from '../../shared/mapActionEvents'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'
import type { TabletopMap } from '~/types/map'

const mocks = vi.hoisted(() => {
  const mapsBySlug = new Map<string, unknown>()
  const profilesById = new Map<string, unknown>()

  return {
    mapsBySlug,
    profilesById,
    findMapFile: vi.fn((slug: string) => (mapsBySlug.has(slug) ? `/maps/${slug}.json` : null)),
    readMapFile: vi.fn((path: string) => {
      const slug = path.split('/').pop()?.replace(/\.json$/, '') ?? ''
      const map = mapsBySlug.get(slug)
      if (!map) throw new Error(`unexpected map read for ${path}`)
      return map
    }),
    readPlayerProfile: vi.fn((profileId: string) => profilesById.get(profileId) ?? null),
  }
})

vi.mock('../../server/utils/mapStorage', () => ({
  findMapFile: mocks.findMapFile,
  readMapFile: mocks.readMapFile,
}))

vi.mock('../../server/utils/playerProfileStorage', () => ({
  readPlayerProfile: mocks.readPlayerProfile,
}))

const actionEventRoute = (await import('../../server/api/maps/action-event.post')).default

type MapActionEventRouteHandler = EventHandler<EventHandlerRequest, unknown>
type SplashEvent = Extract<MapActionEventEnvelope, { kind: 'action-splash' }>

type RouteRole = 'gm' | 'player'

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'linked-token', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 1, y: 0, z: 1 } },
    { id: 'unlinked-token', sheetKind: 'trainer', sheetSlug: 'giovanni', position: { x: 2, y: 0, z: 2 } },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_ash00000' as PlayerProfileId,
  displayName: 'Ash' as PlayerProfileDisplayName,
  linkedCharacters,
})

const actionSplashEvent = (overrides: Partial<SplashEvent> = {}): SplashEvent => ({
  schemaVersion: MAP_ACTION_EVENT_SCHEMA_VERSION,
  id: 'event-1',
  kind: 'action-splash',
  actorPlacementId: 'linked-token',
  sourceClientId: 'client-1',
  createdAt: 1_000,
  payload: { actionName: 'Thunderbolt', verb: 'used' },
  ...overrides,
})

const setMap = (map: TabletopMap): void => {
  mocks.mapsBySlug.set(map.slug, map)
}

const setProfile = (profile: PlayerProfile): void => {
  mocks.profilesById.set(profile.id, profile)
}

const invokeRoute = async (
  handler: MapActionEventRouteHandler,
  options: { role?: RouteRole; body?: unknown; method?: string } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  return handler({
    method: options.method ?? 'POST',
    node: {
      req: {
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
  } as unknown as H3Event)
}

describe('map action event route security boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mapsBySlug.clear()
    mocks.profilesById.clear()
  })

  it('publishes GM action events only to the map-specific map-action realtime event', async () => {
    const map = baseMap({ slug: 'hidden-arena', playerVisible: false })
    const event = actionSplashEvent({
      actorPlacementId: 'unlinked-token',
      sourceClientId: 'gm-client',
    })
    const received: unknown[] = []
    const unsubscribe = subscribeRealtime((incoming) => received.push(incoming))
    const now = vi.spyOn(Date, 'now').mockReturnValue(111_000)
    setMap(map)

    try {
      await expect(invokeRoute(actionEventRoute, {
        role: 'gm',
        body: { slug: 'hidden-arena', event },
      })).resolves.toEqual({ ok: true })
    } finally {
      unsubscribe()
      now.mockRestore()
    }

    expect(received).toEqual([{
      channel: 'map:hidden-arena',
      type: MAP_ACTION_REALTIME_EVENT_TYPE,
      clientId: 'gm-client',
      data: event,
      timestamp: 111_000,
    }])
  })

  it('publishes player action events for selected-profile controlled tokens', async () => {
    const event = actionSplashEvent()
    const profile = playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }])
    const received: unknown[] = []
    const unsubscribe = subscribeRealtime((incoming) => received.push(incoming))
    const now = vi.spyOn(Date, 'now').mockReturnValue(222_000)
    setMap(baseMap())
    setProfile(profile)

    try {
      await expect(invokeRoute(actionEventRoute, {
        role: 'player',
        body: {
          slug: 'arena',
          event,
          profileId: profile.id,
        },
      })).resolves.toEqual({ ok: true })
    } finally {
      unsubscribe()
      now.mockRestore()
    }

    expect(mocks.readPlayerProfile).toHaveBeenCalledWith(profile.id)
    expect(received).toEqual([{
      channel: 'map:arena',
      type: 'map-action',
      clientId: 'client-1',
      data: event,
      timestamp: 222_000,
    }])
  })

  it('rejects player action events for uncontrolled tokens without publishing', async () => {
    const profile = playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }])
    const received: unknown[] = []
    const unsubscribe = subscribeRealtime((incoming) => received.push(incoming))
    setMap(baseMap())
    setProfile(profile)

    try {
      await expect(invokeRoute(actionEventRoute, {
        role: 'player',
        body: {
          slug: 'arena',
          event: actionSplashEvent({ actorPlacementId: 'unlinked-token' }),
          profileId: profile.id,
        },
      })).rejects.toMatchObject({
        statusCode: 403,
        statusMessage: 'Token is not linked to selected player profile',
      })
    } finally {
      unsubscribe()
    }

    expect(received).toEqual([])
  })

  it('rejects hidden maps for players before exposing placement information', async () => {
    const profile = playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }])
    const received: unknown[] = []
    const unsubscribe = subscribeRealtime((incoming) => received.push(incoming))
    setMap(baseMap({ playerVisible: false }))
    setProfile(profile)

    try {
      await expect(invokeRoute(actionEventRoute, {
        role: 'player',
        body: {
          slug: 'arena',
          event: actionSplashEvent({ actorPlacementId: 'missing-token' }),
          profileId: profile.id,
        },
      })).rejects.toMatchObject({
        statusCode: 403,
        statusMessage: 'Map is not player visible',
      })
    } finally {
      unsubscribe()
    }

    expect(received).toEqual([])
  })

  it('rejects unknown event kinds before map lookup or publishing', async () => {
    const received: unknown[] = []
    const unsubscribe = subscribeRealtime((incoming) => received.push(incoming))

    try {
      await expect(invokeRoute(actionEventRoute, {
        role: 'gm',
        body: {
          slug: 'arena',
          event: { ...actionSplashEvent(), kind: 'unknown-action' },
        },
      })).rejects.toMatchObject({
        statusCode: 400,
        statusMessage: 'event must be a valid map action event envelope',
      })
    } finally {
      unsubscribe()
    }

    expect(mocks.findMapFile).not.toHaveBeenCalled()
    expect(received).toEqual([])
  })

  it('rejects oversized payloads before publishing through realtime', async () => {
    const received: unknown[] = []
    const unsubscribe = subscribeRealtime((incoming) => received.push(incoming))
    const event = actionSplashEvent({
      payload: { actionName: 'x'.repeat(MAP_ACTION_EVENT_MAX_PAYLOAD_BYTES + 1) },
    })

    try {
      await expect(invokeRoute(actionEventRoute, {
        role: 'gm',
        body: { slug: 'arena', event },
      })).rejects.toMatchObject({
        statusCode: 413,
        statusMessage: `event.payload too large (max ${MAP_ACTION_EVENT_MAX_PAYLOAD_BYTES} bytes)`,
      })
    } finally {
      unsubscribe()
    }

    expect(received).toEqual([])
  })
})
