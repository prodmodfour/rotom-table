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
  const writes: Array<{ path: string; map: TabletopMap }> = []
  return {
    writes,
    deps: {
      mapsRoot: '/tmp/rotom-maps',
      now: () => 12345,
      ensureRoot: vi.fn(),
      sanitizeFolder: vi.fn((folder: string) => folder.replace(/^\/+|\/+$/g, '')),
      allocateMapSlug: vi.fn((name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')),
      writeMap: vi.fn((path: string, map: TabletopMap) => {
        writes.push({ path, map })
      }),
    },
  }
}

describe('create map use case', () => {
  it('normalizes input, writes the new map, and emits a maps-channel summary', () => {
    const { deps, writes } = createDeps()

    const result = createMapUseCase({
      name: ' Sky Atrium ',
      folder: '/helix/maps/',
      dimensions: { x: 2.4, y: 999, z: 'bad' },
      clientId: 'client-1',
    }, deps)

    expect(deps.ensureRoot).toHaveBeenCalledOnce()
    expect(deps.sanitizeFolder).toHaveBeenCalledWith('/helix/maps/', true)
    expect(deps.allocateMapSlug).toHaveBeenCalledWith('Sky Atrium')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe('/tmp/rotom-maps/helix/maps/sky-atrium.json')
    expect(writes[0]?.map).toEqual(result.map)
    expect(result.map).toMatchObject({
      schemaVersion: 2,
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
        clientId: 'client-1',
        data: {
          slug: 'sky-atrium',
          name: 'Sky Atrium',
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
    const { deps, writes } = createDeps()

    const result = createMapUseCase({ name: '   ', dimensions: null }, deps)

    expect(result.map.name).toBe('Untitled Map')
    expect(result.map.folder).toBe('')
    expect(result.map.dimensions).toEqual(DEFAULT_MAP_DIMENSIONS)
    expect(writes[0]?.path).toBe('/tmp/rotom-maps/untitled-map.json')
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
