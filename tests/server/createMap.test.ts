import { describe, expect, it, vi } from 'vitest'
import {
  CreateMapUseCaseError,
  DEFAULT_MAP_DIMENSIONS,
  createMapUseCase,
  normalizeCreateMapDimensions,
  normalizeCreateMapName,
} from '../../server/useCases/createMap'
import type { TabletopMap } from '~/types/map'

const createDeps = () => {
  let createdMap: TabletopMap | null = null
  const mapRepository = {
    allocateSlug: vi.fn((name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
    create: vi.fn((input: { map: TabletopMap }) => {
      createdMap = input.map
      return input.map
    }),
  }
  return {
    get createdMap() { return createdMap },
    deps: {
      now: () => 12345,
      sanitizeFolder: vi.fn((folder: string) => folder.replace(/^\/+|\/+$/g, '')),
      mapRepository,
    },
  }
}

describe('create map use case', () => {
  it('normalizes input, creates the new SQLite map, and emits a maps-channel summary', () => {
    const harness = createDeps()
    const { deps } = harness

    const result = createMapUseCase({
      name: ' Sky Atrium ',
      folder: '/helix/maps/',
      dimensions: { x: 2.4, y: 999, z: 'bad' },
      clientId: 'client-1',
    }, deps)

    expect(deps.sanitizeFolder).toHaveBeenCalledWith('/helix/maps/', true)
    expect(deps.mapRepository.allocateSlug).toHaveBeenCalledWith('Sky Atrium')
    expect(deps.mapRepository.create).toHaveBeenCalledWith({ slug: 'sky-atrium', map: result.map, now: 12345 })
    expect(harness.createdMap).toEqual(result.map)
    expect(result.map).toMatchObject({
      schemaVersion: 2,
      revision: 0,
      slug: 'sky-atrium',
      name: 'Sky Atrium',
      folder: 'helix/maps',
      dimensions: { x: 2, y: 200, z: DEFAULT_MAP_DIMENSIONS.z },
      groundLevelY: 0,
      playerVisible: false,
      placements: [],
      initiative: { activeId: null, round: 1 },
      voxels: [],
      hazards: [],
      fieldEffects: { weather: [], terrains: [], rooms: [] },
      lights: [],
      createdAt: 12345,
      updatedAt: 12345,
    })
    expect(result.events).toEqual([
      {
        channel: 'maps',
        type: 'created',
        revision: 0,
        clientId: 'client-1',
        data: {
          slug: 'sky-atrium',
          name: 'Sky Atrium',
          revision: 0,
          folder: 'helix/maps',
          dimensions: { x: 2, y: 200, z: DEFAULT_MAP_DIMENSIONS.z },
          placementCount: 0,
          playerVisible: false,
          schemaVersion: 2,
          updatedAt: 12345,
        },
      },
    ])
  })

  it('uses default name, dimensions, and root folder when optional fields are absent', () => {
    const { deps } = createDeps()

    const result = createMapUseCase({ name: '   ', dimensions: null }, deps)

    expect(result.map.name).toBe('Untitled Map')
    expect(result.map.folder).toBe('')
    expect(result.map.dimensions).toEqual(DEFAULT_MAP_DIMENSIONS)
    expect(deps.mapRepository.create).toHaveBeenCalledWith({ slug: 'untitled-map', map: result.map, now: 12345 })
  })

  it('rejects names longer than the persisted map-name limit', () => {
    expect(() => normalizeCreateMapName('x'.repeat(81))).toThrow(CreateMapUseCaseError)
    expect(() => normalizeCreateMapName('x'.repeat(81))).toThrow('name too long (max 80 chars)')
  })

  it('turns folder sanitizer failures into bad-request use-case errors', () => {
    const { deps } = createDeps()
    deps.sanitizeFolder.mockImplementation(() => {
      throw new Error('Invalid folder path')
    })

    expect(() => createMapUseCase({ folder: '../bad' }, deps)).toThrow(CreateMapUseCaseError)
    expect(() => createMapUseCase({ folder: '../bad' }, deps)).toThrow('Invalid folder path')
  })

  it('clamps dimensions to the supported map bounds with fallbacks', () => {
    expect(normalizeCreateMapDimensions({ x: 0, y: 1.6, z: 9999 })).toEqual({
      x: 1,
      y: 2,
      z: 200,
    })
    expect(normalizeCreateMapDimensions(42)).toEqual(DEFAULT_MAP_DIMENSIONS)
  })
})
