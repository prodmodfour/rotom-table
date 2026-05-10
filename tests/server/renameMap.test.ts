import { describe, expect, it, vi } from 'vitest'
import {
  RenameMapUseCaseError,
  normalizeRenameMapName,
  normalizeRenameMapSlug,
  renameMapUseCase,
} from '../../server/useCases/renameMap'
import type { TabletopMap } from '../../types/map'

const makeMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'old-map',
  name: 'Old Map',
  folder: 'folder',
  dimensions: { x: 10, y: 5, z: 8 },
  groundLevelY: 0,
  playerVisible: false,
  placements: [],
  initiative: { activeId: null, round: 1 },
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  lights: [],
  createdAt: 111,
  updatedAt: 222,
  ...overrides,
})

const createDeps = (options: {
  paths?: Record<string, string>
  existingPaths?: string[]
  map?: TabletopMap
  slugify?: (name: string) => string
  allocatedSlug?: string
} = {}) => {
  const paths = new Map(Object.entries(options.paths ?? {
    'old-map': '/repo/data/maps/folder/old-map.json',
  }))
  const existingPaths = new Set(options.existingPaths ?? Array.from(paths.values()))
  const writes: Array<{ path: string; map: TabletopMap }> = []
  const renames: Array<{ from: string; to: string }> = []
  const deps = {
    now: () => 999,
    findMapPath: vi.fn((slug: string) => paths.get(slug) ?? null),
    readMap: vi.fn(() => makeMap(options.map)),
    writeMap: vi.fn((path: string, map: TabletopMap) => {
      writes.push({ path, map })
    }),
    pathExists: vi.fn((path: string) => existingPaths.has(path)),
    renameMapPath: vi.fn((from: string, to: string) => {
      renames.push({ from, to })
      existingPaths.delete(from)
      existingPaths.add(to)
    }),
    slugifyName: vi.fn(options.slugify ?? ((name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))),
    allocateMapSlug: vi.fn(() => options.allocatedSlug ?? 'allocated-map'),
    relativePath: vi.fn((path: string) => path.replace('/repo/', '')),
  }
  return { deps, writes, renames }
}

describe('rename map use case', () => {
  it('updates the display name in place when the slug does not change', () => {
    const { deps, writes, renames } = createDeps({ slugify: () => 'old-map' })

    const result = renameMapUseCase({
      slug: 'old-map',
      name: ' Old Map ',
      clientId: 'client-1',
    }, deps)

    expect(renames).toEqual([])
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe('/repo/data/maps/folder/old-map.json')
    expect(result).toMatchObject({ ok: true, slug: 'old-map', name: 'Old Map', path: 'data/maps/folder/old-map.json' })
    expect(result.map).toMatchObject({ slug: 'old-map', name: 'Old Map', updatedAt: 999 })
    expect(result.events).toEqual([
      {
        channel: 'map:old-map',
        type: 'updated',
        clientId: 'client-1',
        data: result.map,
      },
      {
        channel: 'maps',
        type: 'updated',
        clientId: 'client-1',
        data: {
          slug: 'old-map',
          name: 'Old Map',
          folder: 'folder',
          dimensions: { x: 10, y: 5, z: 8 },
          placementCount: 0,
          playerVisible: false,
          schemaVersion: 2,
          updatedAt: 999,
        },
      },
    ])
  })

  it('renames the file, updates the slug, and emits old/new map events when the slug changes', () => {
    const { deps, writes, renames } = createDeps()

    const result = renameMapUseCase({ slug: 'old-map', name: 'Sky Atrium' }, deps)

    expect(deps.findMapPath).toHaveBeenCalledWith('old-map')
    expect(deps.findMapPath).toHaveBeenCalledWith('sky-atrium')
    expect(renames).toEqual([
      {
        from: '/repo/data/maps/folder/old-map.json',
        to: '/repo/data/maps/folder/sky-atrium.json',
      },
    ])
    expect(writes[0]).toEqual({ path: '/repo/data/maps/folder/sky-atrium.json', map: result.map })
    expect(result.slug).toBe('sky-atrium')
    expect(result.path).toBe('data/maps/folder/sky-atrium.json')
    expect(result.map).toMatchObject({ slug: 'sky-atrium', name: 'Sky Atrium', updatedAt: 999 })
    expect(result.events).toEqual([
      {
        channel: 'map:old-map',
        type: 'renamed',
        clientId: undefined,
        data: { oldSlug: 'old-map', newSlug: 'sky-atrium', map: result.map },
      },
      {
        channel: 'map:sky-atrium',
        type: 'updated',
        clientId: undefined,
        data: result.map,
      },
      {
        channel: 'maps',
        type: 'renamed',
        clientId: undefined,
        data: {
          oldSlug: 'old-map',
          summary: {
            slug: 'sky-atrium',
            name: 'Sky Atrium',
            folder: 'folder',
            dimensions: { x: 10, y: 5, z: 8 },
            placementCount: 0,
            playerVisible: false,
            schemaVersion: 2,
            updatedAt: 999,
          },
        },
      },
    ])
  })

  it('allocates a unique slug when the desired slug already belongs to another map', () => {
    const { deps, renames } = createDeps({
      paths: {
        'old-map': '/repo/data/maps/folder/old-map.json',
        'sky-atrium': '/repo/data/maps/other/sky-atrium.json',
      },
      allocatedSlug: 'sky-atrium-1',
    })

    const result = renameMapUseCase({ slug: 'old-map', name: 'Sky Atrium' }, deps)

    expect(deps.allocateMapSlug).toHaveBeenCalledWith('Sky Atrium')
    expect(renames[0]?.to).toBe('/repo/data/maps/folder/sky-atrium-1.json')
    expect(result.slug).toBe('sky-atrium-1')
  })

  it('rejects invalid input and conflicting destination paths with compatible status messages', () => {
    expect(() => normalizeRenameMapSlug('Bad Slug')).toThrow(RenameMapUseCaseError)
    expect(() => normalizeRenameMapSlug('Bad Slug')).toThrow('slug must match /^[a-z0-9-]+$/')
    expect(() => normalizeRenameMapName('  ')).toThrow('name is required')
    expect(() => normalizeRenameMapName('x'.repeat(81))).toThrow('name too long (max 80 chars)')

    const missing = createDeps({ paths: {} })
    try {
      renameMapUseCase({ slug: 'old-map', name: 'Name' }, missing.deps)
      throw new Error('expected missing map to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RenameMapUseCaseError)
      expect(err).toMatchObject({
        statusCode: 404,
        message: 'Map old-map.json not found',
      })
    }

    const conflict = createDeps({ existingPaths: [
      '/repo/data/maps/folder/old-map.json',
      '/repo/data/maps/folder/sky-atrium.json',
    ] })
    try {
      renameMapUseCase({ slug: 'old-map', name: 'Sky Atrium' }, conflict.deps)
      throw new Error('expected conflicting map path to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RenameMapUseCaseError)
      expect(err).toMatchObject({
        statusCode: 409,
        message: 'Map sky-atrium.json already exists',
      })
    }
  })
})
