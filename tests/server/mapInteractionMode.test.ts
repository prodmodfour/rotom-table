import { describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { getMapInteractionModeUseCase } from '~~/server/useCases/getMapInteractionMode'
import { setMapInteractionModeUseCase } from '~~/server/useCases/setMapInteractionMode'
import type { TabletopMap } from '~/types/map'

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  revision: 4,
  dimensions: { x: 4, y: 2, z: 4 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  updatedAt: 100,
  ...overrides,
})

describe('map interaction mode use cases', () => {
  it('loads shared map mode after validating SQLite map access', () => {
    const modeRepository = {
      get: vi.fn(() => ({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 123 })),
    }
    const mapRepository = { getBySlug: vi.fn(() => mapFixture()) }

    const result = getMapInteractionModeUseCase({ role: 'gm', slug: 'arena' }, {
      mapRepository,
      modeRepository,
    })

    expect(mapRepository.getBySlug).toHaveBeenCalledWith('arena')
    expect(result).toEqual({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 123 })
    expect(modeRepository.get).toHaveBeenCalledWith('arena')
  })

  it('persists shared mode changes and publishes a map-scoped realtime event', () => {
    const modeRepository = {
      get: vi.fn(() => ({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 0 })),
      set: vi.fn((input: { slug: string; interactionMode: typeof MAP_INTERACTION_MODES.SETUP_EDIT; updatedAt: number }) => input),
    }

    const result = setMapInteractionModeUseCase({
      slug: 'arena',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      clientId: 'gm-client',
    }, {
      mapRepository: { getBySlug: vi.fn(() => mapFixture()) },
      modeRepository,
      now: () => 456,
    })

    expect(modeRepository.set).toHaveBeenCalledWith({
      slug: 'arena',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      updatedAt: 456,
    })
    expect(result).toMatchObject({
      slug: 'arena',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      previousInteractionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      updatedAt: 456,
      syncedMapForLivePlay: false,
    })
    expect(result.events).toEqual([
      {
        channel: 'map:arena',
        type: 'map-interaction-mode-updated',
        clientId: 'gm-client',
        data: { slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 456 },
      },
    ])
  })

  it('switching back to live play only updates mode state and does not copy or revise maps', () => {
    const mapRepository = { getBySlug: vi.fn(() => mapFixture({ name: 'Prepared Arena', revision: 4 })) }
    const modeRepository = {
      get: vi.fn(() => ({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 111 })),
      set: vi.fn((input) => input),
    }

    const result = setMapInteractionModeUseCase({
      slug: 'arena',
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
    }, {
      mapRepository,
      modeRepository,
      now: () => 222,
    })

    expect(mapRepository.getBySlug).toHaveBeenCalledWith('arena')
    expect(modeRepository.set).toHaveBeenCalledWith({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 222 })
    expect(result.syncedMapForLivePlay).toBe(false)
  })
})
