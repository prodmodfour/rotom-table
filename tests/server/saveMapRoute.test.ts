import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeRealtime } from '~~/server/utils/realtime'
import { UseCaseHttpError } from '~~/server/utils/useCaseErrors'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import type { TabletopMap } from '~/types/map'

const mocks = vi.hoisted(() => ({
  saveMapUseCase: vi.fn(),
}))

vi.mock('../../server/useCases/saveMap', () => ({
  saveMapUseCase: mocks.saveMapUseCase,
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
    vi.resetAllMocks()
  })

  it('accepts explicit GM setup/edit map saves', async () => {
    const map = mapFixture()
    mocks.saveMapUseCase.mockReturnValue({ ok: true, path: 'data/maps/arena.json', map, events: [] })

    await expect(invokeRoute(saveRoute, {
      role: 'gm',
      body: {
        slug: 'arena',
        map,
        clientId: 'gm-client',
        profileId: 'profile_ash00000',
        interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      },
    })).resolves.toEqual({ ok: true, path: 'data/maps/arena.json', map })

    expect(mocks.saveMapUseCase).toHaveBeenCalledWith({
      role: 'gm',
      slug: 'arena',
      map,
      clientId: 'gm-client',
      interactionMode: 'setup-edit',
    })
  })

  it('publishes GM setup/edit whole-map save events to realtime subscribers', async () => {
    const map = mapFixture()
    const events = [
      { channel: 'map:arena', type: 'updated' as const, clientId: 'client-1', data: map },
      { channel: 'maps', type: 'updated' as const, clientId: 'client-1', data: { slug: 'arena', name: 'Arena' } },
    ]
    const received: unknown[] = []
    const unsubscribe = subscribeRealtime((event) => received.push(event))
    const now = vi.spyOn(Date, 'now').mockReturnValue(654_321)

    try {
      mocks.saveMapUseCase.mockReturnValue({ ok: true, path: 'data/maps/arena.json', map, events })

      await expect(invokeRoute(saveRoute, {
        role: 'gm',
        body: {
          slug: 'arena',
          map,
          clientId: 'client-1',
          interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
        },
      })).resolves.toEqual({ ok: true, path: 'data/maps/arena.json', map })
    } finally {
      unsubscribe()
      now.mockRestore()
    }

    expect(received).toEqual([
      { ...events[0], timestamp: 654_321 },
      { ...events[1], timestamp: 654_321 },
    ])
  })

  it('rejects player whole-map save requests', async () => {
    const map = mapFixture()
    mocks.saveMapUseCase.mockImplementation(() => {
      throw new UseCaseHttpError(403, 'Player whole-map saves are not allowed; live play uses commands')
    })

    await expect(invokeRoute(saveRoute, {
      role: 'player',
      body: {
        slug: 'arena',
        map,
        clientId: 'player-client',
        profileId: 'profile_ash00000',
        interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Player whole-map saves are not allowed; live play uses commands',
    })

    expect(mocks.saveMapUseCase).toHaveBeenCalledWith({
      role: 'player',
      slug: 'arena',
      map,
      clientId: 'player-client',
      interactionMode: 'setup-edit',
    })
  })

  it('rejects live-play whole-map save requests', async () => {
    const map = mapFixture()
    mocks.saveMapUseCase.mockImplementation(() => {
      throw new UseCaseHttpError(403, 'Whole-map saves are setup/edit-only; live play uses commands')
    })

    await expect(invokeRoute(saveRoute, {
      role: 'gm',
      body: {
        slug: 'arena',
        map,
        interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'Whole-map saves are setup/edit-only; live play uses commands',
    })
  })

  it('requires an explicit map interaction mode', async () => {
    const map = mapFixture()

    await expect(invokeRoute(saveRoute, {
      role: 'gm',
      body: { slug: 'arena', map },
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'interactionMode must be "setup-edit" or "live-play"',
    })

    expect(mocks.saveMapUseCase).not.toHaveBeenCalled()
  })
})
