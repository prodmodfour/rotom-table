import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UseCaseHttpError } from '~~/server/utils/useCaseErrors'
import type { TabletopMap } from '~/types/map'

const mocks = vi.hoisted(() => ({
  moveMapTokenUseCase: vi.fn(),
  turnMapTokenUseCase: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))

vi.mock('../../server/useCases/applyMapTokenAction', () => ({
  moveMapTokenUseCase: mocks.moveMapTokenUseCase,
  turnMapTokenUseCase: mocks.turnMapTokenUseCase,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))

const moveRoute = (await import('../../server/api/maps/tokens/move.post')).default
const turnRoute = (await import('../../server/api/maps/tokens/turn.post')).default

type MapTokenActionRouteHandler = EventHandler<EventHandlerRequest, unknown>

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
  placements: [
    { id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 0, y: 0, z: 0 } },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

const invokeRoute = async (
  handler: MapTokenActionRouteHandler,
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

describe('map token action API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves selected player profiles before document-backed token moves', async () => {
    const map = mapFixture()
    const placement = map.placements[0]!
    const profile = {
      schemaVersion: 1,
      id: 'profile_ash00000',
      displayName: 'Ash',
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
    }
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(profile)
    mocks.moveMapTokenUseCase.mockReturnValue({ ok: true, path: 'data/maps/arena.json', map, placement, events: [] })

    await expect(invokeRoute(moveRoute, {
      role: 'player',
      body: {
        slug: 'arena',
        placementId: 'token-1',
        position: { x: 2, y: 0, z: 1 },
        pathLength: 3,
        clientId: 'client-1',
        profileId: 'profile_ash00000',
      },
    })).resolves.toEqual({ ok: true, path: 'data/maps/arena.json', map, placement })

    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
    expect(mocks.moveMapTokenUseCase).toHaveBeenCalledWith({
      role: 'player',
      slug: 'arena',
      placementId: 'token-1',
      position: { x: 2, y: 0, z: 1 },
      pathLength: 3,
      clientId: 'client-1',
      playerProfile: profile,
    })
  })

  it('keeps GM document-backed token turns independent from player profile selection', async () => {
    const map = mapFixture()
    const placement = { ...map.placements[0]!, facing: 'north-east' as const, turned: false }
    mocks.turnMapTokenUseCase.mockReturnValue({ ok: true, path: 'data/maps/arena.json', map, placement, events: [] })

    await expect(invokeRoute(turnRoute, {
      role: 'gm',
      body: {
        slug: 'arena',
        placementId: 'token-1',
        facing: 'north-east',
        clientId: 'gm-client',
        profileId: 'profile_ash00000',
      },
    })).resolves.toEqual({ ok: true, path: 'data/maps/arena.json', map, placement })

    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.turnMapTokenUseCase).toHaveBeenCalledWith({
      role: 'gm',
      slug: 'arena',
      placementId: 'token-1',
      facing: 'north-east',
      clientId: 'gm-client',
      playerProfile: null,
    })
  })

  it('maps missing selected profile errors before token actions run', async () => {
    mocks.resolvePlayerProfileForPolicy.mockImplementation(() => {
      throw new UseCaseHttpError(404, 'Player profile profile_missing1 not found')
    })

    await expect(invokeRoute(turnRoute, {
      role: 'player',
      body: {
        slug: 'arena',
        placementId: 'token-1',
        facing: 'south-east',
        profileId: 'profile_missing1',
      },
    })).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Player profile profile_missing1 not found',
    })
    expect(mocks.turnMapTokenUseCase).not.toHaveBeenCalled()
  })
})
