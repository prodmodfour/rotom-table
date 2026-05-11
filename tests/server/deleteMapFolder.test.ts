import { describe, expect, it, vi } from 'vitest'
import {
  DeleteMapFolderUseCaseError,
  deleteMapFolderUseCase,
  normalizeDeleteMapFolderPath,
} from '../../server/useCases/deleteMapFolder'

const createDeps = () => ({
  sanitizeFolder: vi.fn((folder: string) => folder.replace(/^\/+|\/+$/g, '')),
  deleteFolder: vi.fn<(folder: string) => { removed: string } | null>((folder: string) => ({ removed: `data/maps/${folder}` })),
})

describe('delete map folder use case', () => {
  it('normalizes the folder, removes it through storage, and emits a maps-channel event', () => {
    const deps = createDeps()

    const result = deleteMapFolderUseCase({
      folder: '/old-folder/',
      clientId: 'client-1',
    }, deps)

    expect(deps.sanitizeFolder).toHaveBeenCalledWith('/old-folder/', false)
    expect(deps.deleteFolder).toHaveBeenCalledWith('old-folder')
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
    const escaped = createDeps()
    escaped.deleteFolder.mockImplementation(() => {
      throw new Error('Invalid path: outside root')
    })
    expect(() => deleteMapFolderUseCase({ folder: '../escape' }, escaped))
      .toThrow('Invalid folder path')

    const root = createDeps()
    root.sanitizeFolder.mockReturnValue('')
    root.deleteFolder.mockImplementation(() => {
      throw new Error('Invalid folder path')
    })
    expect(() => deleteMapFolderUseCase({ folder: '' }, root))
      .toThrow('Invalid folder path')
  })

  it('rejects missing folders and non-directory targets with compatible messages', () => {
    const missing = createDeps()
    missing.deleteFolder.mockReturnValue(null)
    try {
      deleteMapFolderUseCase({ folder: 'missing' }, missing)
      throw new Error('expected missing folder to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DeleteMapFolderUseCaseError)
      expect(err).toMatchObject({
        statusCode: 404,
        message: 'Folder "missing" not found',
      })
    }

    const fileInsteadOfFolder = createDeps()
    fileInsteadOfFolder.deleteFolder.mockImplementation(() => {
      throw new Error('Not a directory')
    })
    try {
      deleteMapFolderUseCase({ folder: 'old-folder' }, fileInsteadOfFolder)
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
