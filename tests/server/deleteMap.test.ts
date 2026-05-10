import { describe, expect, it, vi } from 'vitest'
import {
  DeleteMapUseCaseError,
  deleteMapUseCase,
  normalizeDeleteMapSlug,
} from '../../server/useCases/deleteMap'

const MAPS_ROOT = '/repo/data/maps'

const createDeps = (options: {
  paths?: Record<string, string>
} = {}) => {
  const paths = new Map(Object.entries(options.paths ?? {
    'old-map': `${MAPS_ROOT}/old-folder/old-map.json`,
  }))
  const removed: string[] = []
  const pruned: string[] = []
  const deps = {
    mapsRoot: MAPS_ROOT,
    findMapPath: vi.fn((slug: string) => paths.get(slug) ?? null),
    removeMapFile: vi.fn((path: string) => {
      removed.push(path)
      for (const [slug, filePath] of paths.entries()) {
        if (filePath === path) paths.delete(slug)
      }
    }),
    pruneEmptyParents: vi.fn((path: string) => {
      pruned.push(path)
    }),
    relativePath: vi.fn((path: string) => path.replace('/repo/', '')),
  }
  return { deps, removed, pruned }
}

describe('delete map use case', () => {
  it('removes the map file, prunes empty parents, and emits compatible realtime events', () => {
    const { deps, removed, pruned } = createDeps()

    const result = deleteMapUseCase({
      slug: 'old-map',
      clientId: 'client-1',
    }, deps)

    expect(deps.findMapPath).toHaveBeenCalledWith('old-map')
    expect(removed).toEqual([`${MAPS_ROOT}/old-folder/old-map.json`])
    expect(pruned).toEqual([`${MAPS_ROOT}/old-folder/old-map.json`])
    expect(result).toEqual({
      ok: true,
      path: 'data/maps/old-folder/old-map.json',
      events: [
        {
          channel: 'map:old-map',
          type: 'deleted',
          clientId: 'client-1',
          data: { slug: 'old-map' },
        },
        {
          channel: 'maps',
          type: 'deleted',
          clientId: 'client-1',
          data: { slug: 'old-map' },
        },
      ],
    })
  })

  it('rejects invalid slugs and missing maps with compatible messages', () => {
    expect(() => normalizeDeleteMapSlug('Bad Slug')).toThrow(DeleteMapUseCaseError)
    expect(() => normalizeDeleteMapSlug('Bad Slug')).toThrow('slug must match /^[a-z0-9-]+$/')

    const missing = createDeps({ paths: {} })
    try {
      deleteMapUseCase({ slug: 'old-map' }, missing.deps)
      throw new Error('expected missing map to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DeleteMapUseCaseError)
      expect(err).toMatchObject({
        statusCode: 404,
        message: 'Map old-map.json not found',
      })
    }
  })

  it('rejects escaped or root map paths before filesystem mutation', () => {
    const escaped = createDeps({
      paths: { 'old-map': `${MAPS_ROOT}-escape/old-map.json` },
    })
    expect(() => deleteMapUseCase({ slug: 'old-map' }, escaped.deps)).toThrow('Invalid map path')
    expect(escaped.removed).toEqual([])

    const root = createDeps({
      paths: { 'old-map': MAPS_ROOT },
    })
    expect(() => deleteMapUseCase({ slug: 'old-map' }, root.deps)).toThrow('Invalid map path')
    expect(root.removed).toEqual([])
  })
})
