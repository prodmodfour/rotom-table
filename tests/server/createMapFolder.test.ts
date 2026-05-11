import { describe, expect, it, vi } from 'vitest'
import {
  CreateMapFolderUseCaseError,
  createMapFolderUseCase,
  normalizeCreateMapFolder,
} from '../../server/useCases/createMapFolder'

describe('create map folder use case', () => {
  it('normalizes the folder, creates it through storage, and emits a maps-channel folder event', () => {
    const createFolder = vi.fn((folder: string) => ({
      created: true,
      folder,
      path: `data/maps/${folder}`,
    }))
    const sanitizeFolder = vi.fn((folder: string) => folder.replace(/^\/+|\/+$/g, ''))

    const result = createMapFolderUseCase({
      folder: '/helix/maps/',
      clientId: 'client-1',
    }, { createFolder, sanitizeFolder })

    expect(sanitizeFolder).toHaveBeenCalledWith('/helix/maps/', false)
    expect(createFolder).toHaveBeenCalledWith('helix/maps')
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
    const createFolder = vi.fn((folder: string) => ({
      created: false,
      folder,
      path: `data/maps/${folder}`,
    }))

    const result = createMapFolderUseCase({ folder: 'helix/maps' }, { createFolder })

    expect(result.created).toBe(false)
    expect(result.path).toBe('data/maps/helix/maps')
  })

  it('turns folder sanitizer failures into bad-request use-case errors', () => {
    expect(() => normalizeCreateMapFolder('', () => {
      throw new Error('folder must not be empty')
    })).toThrow(CreateMapFolderUseCaseError)
    expect(() => normalizeCreateMapFolder('', () => {
      throw new Error('folder must not be empty')
    })).toThrow('folder must not be empty')
  })

  it('rejects storage paths that escape the maps root with the compatible message', () => {
    const createFolder = vi.fn(() => {
      throw new Error('Invalid path: outside root')
    })

    try {
      createMapFolderUseCase({ folder: 'escape' }, { createFolder })
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
