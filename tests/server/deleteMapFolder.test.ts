import { describe, expect, it, vi } from 'vitest'
import {
  DeleteMapFolderUseCaseError,
  deleteMapFolderUseCase,
  normalizeDeleteMapFolderPath,
} from '../../server/useCases/deleteMapFolder'

const MAPS_ROOT = '/repo/data/maps'

const createDeps = (options: {
  existingPaths?: string[]
  directories?: string[]
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
} = {}) => {
  const existingPaths = new Set(options.existingPaths ?? [`${MAPS_ROOT}/old-folder`])
  const directories = new Set(options.directories ?? Array.from(existingPaths))
  const removed: string[] = []
  const pruned: string[] = []
  const deps = {
    mapsRoot: MAPS_ROOT,
    sanitizeFolder: vi.fn(options.sanitizeFolder ?? ((folder: string) => folder.replace(/^\/+|\/+$/g, ''))),
    pathExists: vi.fn((path: string) => existingPaths.has(path)),
    isDirectory: vi.fn((path: string) => directories.has(path)),
    removeFolder: vi.fn((path: string) => {
      removed.push(path)
      existingPaths.delete(path)
      directories.delete(path)
    }),
    pruneEmptyParents: vi.fn((path: string) => {
      pruned.push(path)
    }),
    relativePath: vi.fn((path: string) => path.replace('/repo/', '')),
  }
  return { deps, removed, pruned }
}

describe('delete map folder use case', () => {
  it('normalizes the folder, removes it recursively, prunes parents, and emits a maps-channel event', () => {
    const { deps, removed, pruned } = createDeps()

    const result = deleteMapFolderUseCase({
      folder: '/old-folder/',
      clientId: 'client-1',
    }, deps)

    expect(deps.sanitizeFolder).toHaveBeenCalledWith('/old-folder/', false)
    expect(deps.pathExists).toHaveBeenCalledWith(`${MAPS_ROOT}/old-folder`)
    expect(deps.isDirectory).toHaveBeenCalledWith(`${MAPS_ROOT}/old-folder`)
    expect(removed).toEqual([`${MAPS_ROOT}/old-folder`])
    expect(pruned).toEqual([`${MAPS_ROOT}/old-folder`])
    expect(result).toEqual({
      ok: true,
      removed: 'data/maps/old-folder',
      events: [
        {
          channel: 'maps',
          type: 'folder-deleted',
          clientId: 'client-1',
          data: { folder: 'old-folder' },
        },
      ],
    })
  })

  it('turns folder sanitizer failures into bad-request use-case errors', () => {
    expect(() => normalizeDeleteMapFolderPath('', () => {
      throw new Error('folder must not be empty')
    })).toThrow(DeleteMapFolderUseCaseError)
    expect(() => normalizeDeleteMapFolderPath('', () => {
      throw new Error('folder must not be empty')
    })).toThrow('folder must not be empty')
  })

  it('rejects escaped or root folder targets before filesystem mutation', () => {
    const escaped = createDeps({ sanitizeFolder: () => '../escape' })
    expect(() => deleteMapFolderUseCase({ folder: '../escape' }, escaped.deps))
      .toThrow('Invalid folder path')
    expect(escaped.removed).toEqual([])

    const root = createDeps({
      existingPaths: [MAPS_ROOT],
      directories: [MAPS_ROOT],
      sanitizeFolder: () => '',
    })
    expect(() => deleteMapFolderUseCase({ folder: '' }, root.deps))
      .toThrow('Invalid folder path')
    expect(root.removed).toEqual([])
  })

  it('rejects missing folders and non-directory targets with compatible messages', () => {
    const missing = createDeps({ existingPaths: [], directories: [] })
    try {
      deleteMapFolderUseCase({ folder: 'missing' }, missing.deps)
      throw new Error('expected missing folder to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DeleteMapFolderUseCaseError)
      expect(err).toMatchObject({
        statusCode: 404,
        message: 'Folder "missing" not found',
      })
    }

    const fileInsteadOfFolder = createDeps({
      existingPaths: [`${MAPS_ROOT}/old-folder`],
      directories: [],
    })
    try {
      deleteMapFolderUseCase({ folder: 'old-folder' }, fileInsteadOfFolder.deps)
      throw new Error('expected non-directory target to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DeleteMapFolderUseCaseError)
      expect(err).toMatchObject({
        statusCode: 400,
        message: 'Not a directory',
      })
    }
  })
})
