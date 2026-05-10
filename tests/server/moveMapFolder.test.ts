import { describe, expect, it, vi } from 'vitest'
import {
  MoveMapFolderUseCaseError,
  moveMapFolderUseCase,
  normalizeMoveMapFolderPath,
} from '../../server/useCases/moveMapFolder'

const MAPS_ROOT = '/repo/data/maps'

const createDeps = (options: {
  existingPaths?: string[]
  directories?: string[]
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
} = {}) => {
  const existingPaths = new Set(options.existingPaths ?? [`${MAPS_ROOT}/old-folder`])
  const directories = new Set(options.directories ?? Array.from(existingPaths))
  const ensuredDirs: string[] = []
  const renames: Array<{ from: string; to: string }> = []
  const pruned: string[] = []
  const deps = {
    mapsRoot: MAPS_ROOT,
    sanitizeFolder: vi.fn(options.sanitizeFolder ?? ((folder: string) => folder.replace(/^\/+|\/+$/g, ''))),
    pathExists: vi.fn((path: string) => existingPaths.has(path)),
    isDirectory: vi.fn((path: string) => directories.has(path)),
    ensureDirectory: vi.fn((path: string) => {
      ensuredDirs.push(path)
      existingPaths.add(path)
      directories.add(path)
    }),
    renameFolder: vi.fn((from: string, to: string) => {
      renames.push({ from, to })
      existingPaths.delete(from)
      directories.delete(from)
      existingPaths.add(to)
      directories.add(to)
    }),
    pruneEmptyParents: vi.fn((path: string) => {
      pruned.push(path)
    }),
  }
  return { deps, ensuredDirs, renames, pruned }
}

describe('move map folder use case', () => {
  it('moves a folder, creates the destination parent, prunes the old parent, and emits a maps-channel event', () => {
    const { deps, ensuredDirs, renames, pruned } = createDeps()

    const result = moveMapFolderUseCase({
      from: '/old-folder/',
      to: 'new-parent/new-folder',
      clientId: 'client-1',
    }, deps)

    expect(deps.sanitizeFolder).toHaveBeenNthCalledWith(1, '/old-folder/', false)
    expect(deps.sanitizeFolder).toHaveBeenNthCalledWith(2, 'new-parent/new-folder', false)
    expect(ensuredDirs).toEqual([`${MAPS_ROOT}/new-parent`])
    expect(renames).toEqual([
      {
        from: `${MAPS_ROOT}/old-folder`,
        to: `${MAPS_ROOT}/new-parent/new-folder`,
      },
    ])
    expect(pruned).toEqual([`${MAPS_ROOT}/old-folder`])
    expect(result).toEqual({
      ok: true,
      moved: true,
      events: [
        {
          channel: 'maps',
          type: 'folder-moved',
          clientId: 'client-1',
          data: { from: 'old-folder', to: 'new-parent/new-folder' },
        },
      ],
    })
  })

  it('treats same-folder moves as idempotent and does not publish events', () => {
    const { deps, ensuredDirs, renames, pruned } = createDeps()

    const result = moveMapFolderUseCase({ from: 'old-folder', to: 'old-folder' }, deps)

    expect(result).toEqual({ ok: true, moved: false, events: [] })
    expect(ensuredDirs).toEqual([])
    expect(renames).toEqual([])
    expect(pruned).toEqual([])
  })

  it('turns sanitizer failures into bad-request use-case errors', () => {
    expect(() => normalizeMoveMapFolderPath('', () => {
      throw new Error('folder must not be empty')
    })).toThrow(MoveMapFolderUseCaseError)
    expect(() => normalizeMoveMapFolderPath('', () => {
      throw new Error('folder must not be empty')
    })).toThrow('folder must not be empty')
  })

  it('rejects descendant moves, escaped paths, missing folders, and destination conflicts', () => {
    try {
      moveMapFolderUseCase({ from: 'old-folder', to: 'old-folder/child' }, createDeps().deps)
      throw new Error('expected descendant move to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MoveMapFolderUseCaseError)
      expect(err).toMatchObject({
        statusCode: 400,
        message: 'Cannot move a folder into itself or one of its descendants',
      })
    }

    const escaped = createDeps({ sanitizeFolder: (folder: string) => folder === 'escape' ? '../escape' : folder })
    expect(() => moveMapFolderUseCase({ from: 'old-folder', to: 'escape' }, escaped.deps))
      .toThrow('Invalid path')

    const missing = createDeps({ existingPaths: [], directories: [] })
    try {
      moveMapFolderUseCase({ from: 'missing', to: 'new-folder' }, missing.deps)
      throw new Error('expected missing folder to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MoveMapFolderUseCaseError)
      expect(err).toMatchObject({
        statusCode: 404,
        message: 'Folder "missing" not found',
      })
    }

    const fileInsteadOfFolder = createDeps({
      existingPaths: [`${MAPS_ROOT}/old-folder`],
      directories: [],
    })
    expect(() => moveMapFolderUseCase({ from: 'old-folder', to: 'new-folder' }, fileInsteadOfFolder.deps))
      .toThrow('Folder "old-folder" not found')

    const conflict = createDeps({
      existingPaths: [`${MAPS_ROOT}/old-folder`, `${MAPS_ROOT}/new-folder`],
      directories: [`${MAPS_ROOT}/old-folder`, `${MAPS_ROOT}/new-folder`],
    })
    try {
      moveMapFolderUseCase({ from: 'old-folder', to: 'new-folder' }, conflict.deps)
      throw new Error('expected destination conflict to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MoveMapFolderUseCaseError)
      expect(err).toMatchObject({
        statusCode: 409,
        message: 'Destination folder already exists',
      })
    }
  })
})
