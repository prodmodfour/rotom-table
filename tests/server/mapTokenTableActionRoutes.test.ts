import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UseCaseHttpError } from '~~/server/utils/useCaseErrors'
import type { TabletopMap } from '~/types/map'

const mocks = vi.hoisted(() => ({
  useMapTokenAbilityUseCase: vi.fn(),
  useMapTokenManeuverUseCase: vi.fn(),
  useMapTokenOrderUseCase: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))

vi.mock('../../server/useCases/applyMapTokenTableAction', () => ({
  useMapTokenAbilityUseCase: mocks.useMapTokenAbilityUseCase,
  useMapTokenManeuverUseCase: mocks.useMapTokenManeuverUseCase,
  useMapTokenOrderUseCase: mocks.useMapTokenOrderUseCase,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))

const abilityRoute = (await import('../../server/api/maps/tokens/use-ability.post')).default
const maneuverRoute = (await import('../../server/api/maps/tokens/use-maneuver.post')).default
const orderRoute = (await import('../../server/api/maps/tokens/use-order.post')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>

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
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'sandile', position: { x: 0, y: 0, z: 0 } },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

const invokeRoute = async (
  handler: RouteHandler,
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

describe('map token table action API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves selected player profiles before document-backed ability use', async () => {
    const map = mapFixture()
    const profile = {
      schemaVersion: 1,
      id: 'profile_ash00000',
      displayName: 'Ash',
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'sandile' }],
    }
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(profile)
    mocks.useMapTokenAbilityUseCase.mockReturnValue({
      ok: true,
      path: 'data/maps/arena.json',
      map,
      action: { type: 'ability', placementId: 'actor', targetPlacementId: 'target', name: 'Intimidate' },
      sheetUpdates: [],
      events: [],
    })

    await expect(invokeRoute(abilityRoute, {
      role: 'player',
      body: {
        slug: 'arena',
        placementId: 'actor',
        abilityName: 'Intimidate',
        targetPlacementId: 'target',
        clientId: 'client-1',
        profileId: 'profile_ash00000',
      },
    })).resolves.toEqual({
      ok: true,
      path: 'data/maps/arena.json',
      map,
      action: { type: 'ability', placementId: 'actor', targetPlacementId: 'target', name: 'Intimidate' },
      sheetUpdates: [],
    })

    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
    expect(mocks.useMapTokenAbilityUseCase).toHaveBeenCalledWith({
      role: 'player',
      slug: 'arena',
      placementId: 'actor',
      abilityName: 'Intimidate',
      targetPlacementId: 'target',
      clientId: 'client-1',
      playerProfile: profile,
    })
  })

  it('keeps GM table action routes independent from player profile selection', async () => {
    const map = mapFixture()
    mocks.useMapTokenOrderUseCase.mockReturnValue({
      ok: true,
      path: 'data/maps/arena.json',
      map,
      action: { type: 'order', placementId: 'trainer', name: 'Agility Training' },
      sheetUpdates: [],
      events: [],
    })

    await expect(invokeRoute(orderRoute, {
      role: 'gm',
      body: {
        slug: 'arena',
        placementId: 'trainer',
        orderName: 'Agility Training',
        profileId: 'profile_ash00000',
      },
    })).resolves.toMatchObject({ ok: true, action: { type: 'order' } })

    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.useMapTokenOrderUseCase).toHaveBeenCalledWith({
      role: 'gm',
      slug: 'arena',
      placementId: 'trainer',
      orderName: 'Agility Training',
      clientId: undefined,
      playerProfile: null,
    })
  })

  it('maps missing selected profile errors before table actions run', async () => {
    mocks.resolvePlayerProfileForPolicy.mockImplementation(() => {
      throw new UseCaseHttpError(404, 'Player profile profile_missing1 not found')
    })

    await expect(invokeRoute(maneuverRoute, {
      role: 'player',
      body: {
        slug: 'arena',
        placementId: 'actor',
        maneuverName: 'Trip',
        profileId: 'profile_missing1',
      },
    })).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Player profile profile_missing1 not found',
    })
    expect(mocks.useMapTokenManeuverUseCase).not.toHaveBeenCalled()
  })
})
