import { describe, expect, it, vi } from 'vitest'
import {
  CreateMapFolderUseCaseError,
  createMapFolderUseCase,
  normalizeCreateMapFolder,
} from '../../server/useCases/createMapFolder'

const MAPS_ROOT = '/repo/data/maps'

const createDeps = (options: {
  existingPaths?: string[]
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
} = {}) => {
  const existingPaths = new Set(options.existingPaths ?? [])
  const ensuredDirs: string[] = []
  const deps = {
    mapsRoot: MAPS_ROOT,
    sanitizeFolder: vi.fn(options.sanitizeFolder ?? ((folder: string) => folder.replace(/^\/+|\/+$/g, ''))),
    pathExists: vi.fn((path: string) => existingPaths.has(path)),
    ensureDirectory: vi.fn((path: string) => {
      ensuredDirs.push(path)
      existingPaths.add(path)
    }),
    relativePath: vi.fn((path: string) => path.replace('/repo/', '')),
  }
  return { deps, ensuredDirs }
}

describe('create map folder use case', () => {
  it('normalizes the folder, creates the directory, and emits a maps-channel folder event', () => {
    const { deps, ensuredDirs } = createDeps()

    const result = createMapFolderUseCase({
      folder: '/helix/maps/',
      clientId: 'client-1',
    }, deps)

    expect(deps.sanitizeFolder).toHaveBeenCalledWith('/helix/maps/', false)
    expect(deps.pathExists).toHaveBeenCalledWith(`${MAPS_ROOT}/helix/maps`)
    expect(ensuredDirs).toEqual([`${MAPS_ROOT}/helix/maps`])
    expect(result).toEqual({
      ok: true,
      created: true,
      path: 'data/maps/helix/maps',
      events: [
        {
          channel: 'maps',
          type: 'folder-created',
          clientId: 'client-1',
          data: { folder: 'helix/maps' },
        },
      ],
    })
  })

  it('reports existing folders without changing the response shape', () => {
    const { deps, ensuredDirs } = createDeps({ existingPaths: [`${MAPS_ROOT}/helix/maps`] })

    const result = createMapFolderUseCase({ folder: 'helix/maps' }, deps)

    expect(result.created).toBe(false)
    expect(result.path).toBe('data/maps/helix/maps')
    expect(ensuredDirs).toEqual([`${MAPS_ROOT}/helix/maps`])
  })

  it('turns folder sanitizer failures into bad-request use-case errors', () => {
    expect(() => normalizeCreateMapFolder('', () => {
      throw new Error('folder must not be empty')
    })).toThrow(CreateMapFolderUseCaseError)
    expect(() => normalizeCreateMapFolder('', () => {
      throw new Error('folder must not be empty')
    })).toThrow('folder must not be empty')
  })

  it('rejects sanitized paths that escape the maps root', () => {
    const { deps } = createDeps({ sanitizeFolder: () => '../escape' })

    try {
      createMapFolderUseCase({ folder: '../escape' }, deps)
      throw new Error('expected escaped path to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(CreateMapFolderUseCaseError)
      expect(err).toMatchObject({
        statusCode: 400,
        message: 'Invalid destination',
      })
    }
  })
})
