import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODE_REALTIME_EVENT_TYPE, MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { useSharedMapInteractionMode } from '~/composables/map-editor/useSharedMapInteractionMode'
import { MAP_API_PATHS } from '~/utils/apiRoutes'

const mocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  realtimeHandlers: [] as Array<(event: { type: string; clientId?: string; data?: unknown }) => void>,
}))

vi.mock('~/utils/clientId', () => ({
  getClientId: () => 'mode-client',
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => ({
    getJson: mocks.getJson,
    postJson: mocks.postJson,
  }),
}))

vi.mock('~/composables/useRealtime', () => ({
  useRealtimeChannel: vi.fn((_channel: string, handler: (event: { type: string; clientId?: string; data?: unknown }) => void) => {
    mocks.realtimeHandlers.push(handler)
    return vi.fn()
  }),
}))

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useSharedMapInteractionMode', () => {
  beforeEach(() => {
    mocks.getJson.mockReset()
    mocks.postJson.mockReset()
    mocks.realtimeHandlers.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads interaction mode automatically by default', async () => {
    mocks.getJson.mockResolvedValueOnce({
      slug: 'arena-map',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      updatedAt: 10,
    })

    const mode = useSharedMapInteractionMode('arena-map')
    await flushPromises()

    expect(mocks.getJson).toHaveBeenCalledWith(MAP_API_PATHS.interactionMode, {
      params: { slug: 'arena-map' },
    })
    expect(mode.interactionMode.value).toBe(MAP_INTERACTION_MODES.SETUP_EDIT)
    expect(mode.status.value).toBe('idle')
  })

  it('can disable automatic load and adopt authoritative snapshot mode state', async () => {
    const mode = useSharedMapInteractionMode('arena-map', { autoLoad: false })
    await flushPromises()

    expect(mocks.getJson).not.toHaveBeenCalled()

    mode.applyAuthoritativeMode({
      slug: 'arena-map',
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      updatedAt: 25,
    })

    expect(mode.interactionMode.value).toBe(MAP_INTERACTION_MODES.LIVE_PLAY)
    expect(mode.updatedAt.value).toBe(25)
    expect(mode.status.value).toBe('idle')
  })

  it('continues to post mode changes and adopt realtime mode updates', async () => {
    mocks.postJson.mockResolvedValueOnce({
      slug: 'arena-map',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      updatedAt: 30,
    })
    const mode = useSharedMapInteractionMode('arena-map', { autoLoad: false })

    await mode.setInteractionMode(MAP_INTERACTION_MODES.SETUP_EDIT)

    expect(mocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.interactionMode, {
      slug: 'arena-map',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      clientId: 'mode-client',
    })
    expect(mode.interactionMode.value).toBe(MAP_INTERACTION_MODES.SETUP_EDIT)

    mocks.realtimeHandlers[0]?.({
      type: MAP_INTERACTION_MODE_REALTIME_EVENT_TYPE,
      clientId: 'other-client',
      data: {
        slug: 'arena-map',
        interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
        updatedAt: 40,
      },
    })

    expect(mode.interactionMode.value).toBe(MAP_INTERACTION_MODES.LIVE_PLAY)
    expect(mode.updatedAt.value).toBe(40)
  })
})
