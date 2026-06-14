import { describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import type { TabletopMap } from '~/types/map'
import {
  LoadMapUseCaseError,
  loadMapUseCase,
  normalizeLoadMapSlug,
} from '../../server/useCases/loadMap'

const visibleMap: TabletopMap = {
  schemaVersion: 2,
  revision: 7,
  slug: 'visible-map',
  name: 'Visible Map',
  folder: 'public',
  dimensions: { x: 8, y: 4, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  placements: [],
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  lights: [],
  initiative: { activeId: null, round: 1 },
}

const hiddenMap: TabletopMap = {
  ...visibleMap,
  slug: 'hidden-map',
  name: 'Hidden Map',
  playerVisible: false,
}

const livePlayMap: TabletopMap = {
  ...visibleMap,
  revision: 9,
  name: 'SQLite Live Map',
  placements: [{
    id: 'token-live',
    sheetKind: 'pokemon',
    sheetSlug: 'pikachu',
    position: { x: 4, y: 0, z: 4 },
  }],
  updatedAt: 900,
}

const createDeps = (options: {
  paths?: Record<string, string>
  maps?: Record<string, TabletopMap>
  readError?: Error
  interactionMode?: (typeof MAP_INTERACTION_MODES)[keyof typeof MAP_INTERACTION_MODES]
  liveMaps?: Record<string, TabletopMap>
} = {}) => {
  const paths = new Map(Object.entries(options.paths ?? {
    'visible-map': '/repo/data/maps/public/visible-map.json',
    'hidden-map': '/repo/data/maps/hidden-map.json',
  }))
  const maps = new Map(Object.entries(options.maps ?? {
    '/repo/data/maps/public/visible-map.json': visibleMap,
    '/repo/data/maps/hidden-map.json': hiddenMap,
  }))
  const liveMaps = new Map(Object.entries(options.liveMaps ?? {}))
  return {
    findMapPath: vi.fn((slug: string) => paths.get(slug) ?? null),
    readMap: vi.fn((path: string) => {
      if (options.readError) throw options.readError
      const map = maps.get(path)
      if (!map) throw new Error('unexpected missing map fixture')
      return map
    }),
    modeRepository: {
      get: vi.fn((slug: string) => ({
        slug,
        interactionMode: options.interactionMode ?? MAP_INTERACTION_MODES.SETUP_EDIT,
        updatedAt: 0,
      })),
    },
    mapRepository: {
      get: vi.fn((slug: string) => {
        const map = liveMaps.get(slug)
        return map
          ? {
              slug,
              document: map,
              revision: map.revision ?? 0,
              updatedAt: map.updatedAt ?? 0,
            }
          : null
      }),
    },
  }
}

describe('load map use case', () => {
  it('loads visible maps for players and hidden maps for GMs', () => {
    const deps = createDeps()

    expect(loadMapUseCase({ role: 'player', slug: 'visible-map' }, deps)).toEqual({ map: visibleMap, revision: 7 })
    expect(loadMapUseCase({ role: 'gm', slug: 'hidden-map' }, deps)).toEqual({ map: hiddenMap, revision: 7 })
    expect(deps.findMapPath).toHaveBeenCalledWith('visible-map')
    expect(deps.findMapPath).toHaveBeenCalledWith('hidden-map')
    expect(deps.readMap).toHaveBeenCalledWith('/repo/data/maps/public/visible-map.json')
  })

  it('loads the SQLite authoritative map while the shared mode is live play', () => {
    const deps = createDeps({
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      liveMaps: { 'visible-map': livePlayMap },
    })

    expect(loadMapUseCase({ role: 'player', slug: 'visible-map' }, deps)).toEqual({
      map: livePlayMap,
      revision: 9,
    })
    expect(deps.mapRepository.get).toHaveBeenCalledWith('visible-map')
    expect(deps.findMapPath).not.toHaveBeenCalled()
    expect(deps.readMap).not.toHaveBeenCalled()
  })

  it('keeps setup/edit loads file-backed even when a live-play row exists', () => {
    const deps = createDeps({
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      liveMaps: { 'visible-map': livePlayMap },
    })

    expect(loadMapUseCase({ role: 'player', slug: 'visible-map' }, deps)).toEqual({
      map: visibleMap,
      revision: 7,
    })
    expect(deps.mapRepository.get).not.toHaveBeenCalled()
    expect(deps.readMap).toHaveBeenCalledWith('/repo/data/maps/public/visible-map.json')
  })

  it('rejects invalid slugs and missing maps with compatible messages', () => {
    expect(() => normalizeLoadMapSlug('Bad Slug')).toThrow(LoadMapUseCaseError)
    expect(() => normalizeLoadMapSlug('Bad Slug')).toThrow('slug must match /^[a-z0-9-]+$/')

    const deps = createDeps({ paths: {} })
    try {
      loadMapUseCase({ role: 'gm', slug: 'missing-map' }, deps)
      throw new Error('expected missing map to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(LoadMapUseCaseError)
      expect(err).toMatchObject({
        statusCode: 404,
        message: 'Map missing-map.json not found',
      })
    }
  })

  it('rejects hidden maps for players after reading path-derived map data', () => {
    const deps = createDeps()

    try {
      loadMapUseCase({ role: 'player', slug: 'hidden-map' }, deps)
      throw new Error('expected hidden map to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(LoadMapUseCaseError)
      expect(err).toMatchObject({
        statusCode: 403,
        message: 'Map is not player visible',
      })
    }
    expect(deps.readMap).toHaveBeenCalledWith('/repo/data/maps/hidden-map.json')
  })

  it('wraps invalid map reads as bad requests with existing fallback copy', () => {
    const invalidDeps = createDeps({ readError: new Error('Map data/maps/bad.json is invalid: schemaVersion must be 2') })
    expect(() => loadMapUseCase({ role: 'gm', slug: 'visible-map' }, invalidDeps)).toThrow(
      'Map data/maps/bad.json is invalid: schemaVersion must be 2',
    )

    const emptyErrorDeps = createDeps({ readError: new Error('') })
    try {
      loadMapUseCase({ role: 'gm', slug: 'visible-map' }, emptyErrorDeps)
      throw new Error('expected invalid map to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(LoadMapUseCaseError)
      expect(err).toMatchObject({
        statusCode: 400,
        message: 'Map visible-map.json is invalid',
      })
    }
  })
})
