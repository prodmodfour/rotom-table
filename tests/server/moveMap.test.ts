import { describe, expect, it, vi } from 'vitest'
import {
  MoveMapUseCaseError,
  moveMapUseCase,
  normalizeMoveMapFolder,
  normalizeMoveMapSlug,
} from '../../server/useCases/moveMap'
import type { TabletopMap } from '~/types/map'

const MAPS_ROOT = '/repo/data/maps'

const makeMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 2,
  slug: 'old-map',
  name: 'Old Map',
  folder: 'old-folder',
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

const folderFromPath = (path: string): string => {
  const rel = path.slice(MAPS_ROOT.length + 1)
  const lastSlash = rel.lastIndexOf('/')
  return lastSlash === -1 ? '' : rel.slice(0, lastSlash)
}

const createDeps = (options: {
  paths?: Record<string, string>
  existingPaths?: string[]
  readMap?: (path: string) => TabletopMap
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
} = {}) => {
  const paths = new Map(Object.entries(options.paths ?? {
    'old-map': `${MAPS_ROOT}/old-folder/old-map.json`,
  }))
  const existingPaths = new Set(options.existingPaths ?? Array.from(paths.values()))
  const writes: Array<{ path: string; map: TabletopMap }> = []
  const renames: Array<{ from: string; to: string }> = []
  const ensuredDirs: string[] = []
  const pruned: string[] = []
  const deps = {
    mapsRoot: MAPS_ROOT,
    now: () => 999,
    sanitizeFolder: vi.fn(options.sanitizeFolder ?? ((folder: string) => folder.replace(/^\/+|\/+$/g, ''))),
    findMapPath: vi.fn((slug: string) => paths.get(slug) ?? null),
    pathExists: vi.fn((path: string) => existingPaths.has(path)),
    ensureDirectory: vi.fn((path: string) => {
      ensuredDirs.push(path)
    }),
    renameMapPath: vi.fn((from: string, to: string) => {
      renames.push({ from, to })
      existingPaths.delete(from)
      existingPaths.add(to)
    }),
    pruneEmptyParents: vi.fn((path: string) => {
      pruned.push(path)
    }),
    readMap: vi.fn(options.readMap ?? ((path: string) => makeMap({ folder: folderFromPath(path) }))),
    writeMap: vi.fn((path: string, map: TabletopMap) => {
      writes.push({ path, map })
    }),
    relativePath: vi.fn((path: string) => path.replace('/repo/', '')),
  }
  return { deps, writes, renames, ensuredDirs, pruned }
}

describe('move map use case', () => {
  it('moves a map file, updates it from the destination path, and emits compatible realtime events', () => {
    const { deps, writes, renames, ensuredDirs, pruned } = createDeps()

    const result = moveMapUseCase({
      slug: 'old-map',
      folder: '/new-folder/',
      clientId: 'client-1',
    }, deps)

    expect(deps.sanitizeFolder).toHaveBeenCalledWith('/new-folder/', true)
    expect(renames).toEqual([
      {
        from: `${MAPS_ROOT}/old-folder/old-map.json`,
        to: `${MAPS_ROOT}/new-folder/old-map.json`,
      },
    ])
    expect(ensuredDirs).toEqual([`${MAPS_ROOT}/new-folder`])
    expect(pruned).toEqual([`${MAPS_ROOT}/old-folder/old-map.json`])
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe(`${MAPS_ROOT}/new-folder/old-map.json`)
    expect(result).toMatchObject({ ok: true, moved: true, path: 'data/maps/new-folder/old-map.json' })
    expect(result.map).toMatchObject({ folder: 'new-folder', revision: 3, updatedAt: 999 })
    expect(result.events).toEqual([
      {
        channel: 'map:old-map',
        type: 'updated',
        revision: 3,
        clientId: 'client-1',
        data: result.map,
      },
      {
        channel: 'maps',
        type: 'moved',
        revision: 3,
        clientId: 'client-1',
        data: {
          slug: 'old-map',
          name: 'Old Map',
          folder: 'new-folder',
          dimensions: { x: 10, y: 5, z: 8 },
          placementCount: 0,
          playerVisible: false,
          schemaVersion: 2,
          revision: 3,
          updatedAt: 999,
        },
      },
    ])
  })

  it('keeps same-path moves idempotent while still refreshing updatedAt and publishing events', () => {
    const { deps, writes, renames, ensuredDirs, pruned } = createDeps()

    const result = moveMapUseCase({ slug: 'old-map', folder: 'old-folder' }, deps)

    expect(result.moved).toBe(false)
    expect(renames).toEqual([])
    expect(ensuredDirs).toEqual([])
    expect(pruned).toEqual([])
    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe(`${MAPS_ROOT}/old-folder/old-map.json`)
    expect(result.map.revision).toBe(2)
    expect(result.map.updatedAt).toBe(999)
    expect(result.events).toHaveLength(2)
  })

  it('supports moving a map back to the root folder', () => {
    const { deps, writes, renames } = createDeps()

    const result = moveMapUseCase({ slug: 'old-map', folder: '' }, deps)

    expect(renames[0]).toEqual({
      from: `${MAPS_ROOT}/old-folder/old-map.json`,
      to: `${MAPS_ROOT}/old-map.json`,
    })
    expect(writes[0]?.map.folder).toBe('')
    expect(result.path).toBe('data/maps/old-map.json')
  })

  it('rejects invalid input, missing maps, conflicting destinations, and escaped destination paths', () => {
    expect(() => normalizeMoveMapSlug('Bad Slug')).toThrow(MoveMapUseCaseError)
    expect(() => normalizeMoveMapSlug('Bad Slug')).toThrow('slug must match /^[a-z0-9-]+$/')
    expect(() => normalizeMoveMapFolder('../bad', () => {
      throw new Error('Invalid folder path')
    })).toThrow('Invalid folder path')

    const missing = createDeps({ paths: {} })
    try {
      moveMapUseCase({ slug: 'old-map', folder: 'new-folder' }, missing.deps)
      throw new Error('expected missing map to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MoveMapUseCaseError)
      expect(err).toMatchObject({
        statusCode: 404,
        message: 'Map old-map.json not found',
      })
    }

    const conflict = createDeps({ existingPaths: [
      `${MAPS_ROOT}/old-folder/old-map.json`,
      `${MAPS_ROOT}/new-folder/old-map.json`,
    ] })
    try {
      moveMapUseCase({ slug: 'old-map', folder: 'new-folder' }, conflict.deps)
      throw new Error('expected conflicting destination to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MoveMapUseCaseError)
      expect(err).toMatchObject({
        statusCode: 409,
        message: 'A map with that name already exists in the target folder',
      })
    }

    const escaped = createDeps({ sanitizeFolder: () => '../escape' })
    expect(() => moveMapUseCase({ slug: 'old-map', folder: '../escape' }, escaped.deps))
      .toThrow('Invalid destination')
  })
})
