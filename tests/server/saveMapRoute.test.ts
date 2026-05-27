import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UseCaseHttpError } from '~~/server/utils/useCaseErrors'
import type { TabletopMap } from '~/types/map'

const mocks = vi.hoisted(() => ({
  saveMapUseCase: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))

vi.mock('../../server/useCases/saveMap', () => ({
  saveMapUseCase: mocks.saveMapUseCase,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))

const saveRoute = (await import('../../server/api/maps/save.post')).default

type MapSaveRouteHandler = EventHandler<EventHandlerRequest, unknown>

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 4, y: 2, z: 4 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

const invokeRoute = async (
  handler: MapSaveRouteHandler,
  options: { role?: 'gm' | 'player'; body?: unknown; method?: string } = {},
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

describe('map save API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves selected player profiles before player map saves', async () => {
    const map = mapFixture()
    const profile = {
      schemaVersion: 1,
      id: 'profile_ash00000',
      displayName: 'Ash',
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
    }
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(profile)
    mocks.saveMapUseCase.mockReturnValue({ ok: true, path: 'data/maps/arena.json', map, events: [] })

    await expect(invokeRoute(saveRoute, {
      role: 'player',
      body: {
        slug: 'arena',
        map,
        clientId: 'client-1',
        profileId: 'profile_ash00000',
      },
    })).resolves.toEqual({ ok: true, path: 'data/maps/arena.json', map })

    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
    expect(mocks.saveMapUseCase).toHaveBeenCalledWith({
      role: 'player',
      slug: 'arena',
      map,
      clientId: 'client-1',
      playerProfile: profile,
    })
  })

  it('keeps GM map saves independent from player profile selection', async () => {
    const map = mapFixture()
    mocks.saveMapUseCase.mockReturnValue({ ok: true, path: 'data/maps/arena.json', map, events: [] })

    await expect(invokeRoute(saveRoute, {
      role: 'gm',
      body: {
        slug: 'arena',
        map,
        clientId: 'gm-client',
        profileId: 'profile_ash00000',
      },
    })).resolves.toEqual({ ok: true, path: 'data/maps/arena.json', map })

    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.saveMapUseCase).toHaveBeenCalledWith({
      role: 'gm',
      slug: 'arena',
      map,
      clientId: 'gm-client',
      playerProfile: null,
    })
  })

  it('maps invalid or missing selected profile errors before saving', async () => {
    const map = mapFixture()
    mocks.resolvePlayerProfileForPolicy.mockImplementation(() => {
      throw new UseCaseHttpError(404, 'Player profile profile_missing1 not found')
    })

    await expect(invokeRoute(saveRoute, {
      role: 'player',
      body: { slug: 'arena', map, profileId: 'profile_missing1' },
    })).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Player profile profile_missing1 not found',
    })
    expect(mocks.saveMapUseCase).not.toHaveBeenCalled()
  })
})
