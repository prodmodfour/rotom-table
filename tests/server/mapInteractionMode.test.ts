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
  it('loads shared map mode after validating map access', () => {
    const modeRepository = {
      get: vi.fn(() => ({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 123 })),
    }

    const result = getMapInteractionModeUseCase({ role: 'gm', slug: 'arena' }, {
      findMapPath: () => '/campaign/data/maps/arena.json',
      readMap: () => mapFixture(),
      modeRepository,
    })

    expect(result).toEqual({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 123 })
    expect(modeRepository.get).toHaveBeenCalledWith('arena')
  })

  it('persists shared mode changes and publishes a map-scoped realtime event', async () => {
    const modeRepository = {
      get: vi.fn(() => ({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 0 })),
      set: vi.fn((input: { slug: string; interactionMode: typeof MAP_INTERACTION_MODES.SETUP_EDIT; updatedAt: number }) => input),
    }

    const result = await setMapInteractionModeUseCase({
      slug: 'arena',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      clientId: 'gm-client',
    }, {
      findMapPath: () => '/campaign/data/maps/arena.json',
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

  it('syncs the prepared JSON map into SQLite when switching back to live play', async () => {
    const map = mapFixture({ name: 'Prepared Arena' })
    const saveSetupMap = vi.fn(() => map)

    await setMapInteractionModeUseCase({
      slug: 'arena',
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
    }, {
      findMapPath: () => '/campaign/data/maps/arena.json',
      readMap: () => map,
      modeRepository: {
        get: () => ({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 111 }),
        set: (input) => input,
      },
      mapRepository: { saveSetupMap },
      now: () => 222,
    })

    expect(saveSetupMap).toHaveBeenCalledWith(map)
  })
})
