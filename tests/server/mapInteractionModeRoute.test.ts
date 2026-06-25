import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'

const mocks = vi.hoisted(() => ({
  getMapInteractionModeUseCase: vi.fn(),
  setMapInteractionModeUseCase: vi.fn(),
}))

vi.mock('../../server/useCases/getMapInteractionMode', () => ({
  getMapInteractionModeUseCase: mocks.getMapInteractionModeUseCase,
}))
vi.mock('../../server/useCases/setMapInteractionMode', () => ({
  setMapInteractionModeUseCase: mocks.setMapInteractionModeUseCase,
}))

const getRoute = (await import('../../server/api/maps/interaction-mode.get')).default
const postRoute = (await import('../../server/api/maps/interaction-mode.post')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const invokeRoute = async (
  handler: RouteHandler,
  options: { role?: 'gm' | 'player'; body?: unknown; query?: Record<string, unknown>; method?: string } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  const query = new URLSearchParams(
    Object.entries(options.query ?? {}).map(([key, value]) => [key, String(value)]),
  ).toString()
  const path = `/api/maps/interaction-mode${query ? `?${query}` : ''}`

  return handler({
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    path,
    node: {
      req: {
        url: path,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
    context: {},
  } as unknown as H3Event)
}

describe('map interaction mode API routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('loads the shared map mode for authenticated viewers', async () => {
    mocks.getMapInteractionModeUseCase.mockReturnValue({
      slug: 'arena',
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      updatedAt: 10,
    })

    await expect(invokeRoute(getRoute, { role: 'player', query: { slug: 'arena' } })).resolves.toEqual({
      slug: 'arena',
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      updatedAt: 10,
    })
    expect(mocks.getMapInteractionModeUseCase).toHaveBeenCalledWith({ role: 'player', slug: 'arena' })
  })

  it('lets GMs change shared map mode through the durable-publishing use case', async () => {
    mocks.setMapInteractionModeUseCase.mockResolvedValue({
      slug: 'arena',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      previousInteractionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      updatedAt: 25,
      syncedMapForLivePlay: false,
      realtimeEvents: [],
    })

    await expect(invokeRoute(postRoute, {
      role: 'gm',
      body: {
        slug: 'arena',
        interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
        clientId: 'gm-client',
      },
    })).resolves.toEqual({
      slug: 'arena',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      previousInteractionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      updatedAt: 25,
      syncedMapForLivePlay: false,
    })

    expect(mocks.setMapInteractionModeUseCase).toHaveBeenCalledWith({
      slug: 'arena',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      clientId: 'gm-client',
    })
  })

  it('requires GM role and a valid explicit mode for changes', async () => {
    await expect(invokeRoute(postRoute, {
      role: 'player',
      body: { slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT },
    })).rejects.toMatchObject({ statusCode: 403 })

    await expect(invokeRoute(postRoute, {
      role: 'gm',
      body: { slug: 'arena', interactionMode: 'prepare' },
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'interactionMode must be "setup-edit" or "live-play"',
    })

    expect(mocks.setMapInteractionModeUseCase).not.toHaveBeenCalled()
  })
})
