import { describe, expect, it, vi } from 'vitest'
import {
  MoveMapFolderUseCaseError,
  moveMapFolderUseCase,
  normalizeMoveMapFolderPath,
} from '../../server/useCases/moveMapFolder'

const createDeps = () => ({
  sanitizeFolder: vi.fn((folder: string) => folder.replace(/^\/+|\/+$/g, '')),
  moveFolder: vi.fn<(from: string, to: string) => { moved: boolean } | null>(() => ({ moved: true })),
})

describe('move map folder use case', () => {
  it('normalizes folders, moves through storage, and emits a maps-channel event', () => {
    const deps = createDeps()

    const result = moveMapFolderUseCase({
      from: '/old-folder/',
      to: 'new-parent/new-folder',
      clientId: 'client-1',
    }, deps)

    expect(deps.sanitizeFolder).toHaveBeenNthCalledWith(1, '/old-folder/', false)
    expect(deps.sanitizeFolder).toHaveBeenNthCalledWith(2, 'new-parent/new-folder', false)
    expect(deps.moveFolder).toHaveBeenCalledWith('old-folder', 'new-parent/new-folder')
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
    const deps = createDeps()

    const result = moveMapFolderUseCase({ from: 'old-folder', to: 'old-folder' }, deps)

    expect(result).toEqual({ ok: true, moved: false, events: [] })
    expect(deps.moveFolder).not.toHaveBeenCalled()
  })

  it('turns sanitizer failures into bad-request use-case errors', () => {
    expect(() => normalizeMoveMapFolderPath('', () => {
      throw new Error('folder must not be empty')
    })).toThrow(MoveMapFolderUseCaseError)
    expect(() => normalizeMoveMapFolderPath('', () => {
      throw new Error('folder must not be empty')
    })).toThrow('folder must not be empty')
  })

  it('maps descendant moves and storage failures to compatible errors', () => {
    try {
      moveMapFolderUseCase({ from: 'old-folder', to: 'old-folder/child' }, createDeps())
      throw new Error('expected descendant move to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MoveMapFolderUseCaseError)
      expect(err).toMatchObject({
        statusCode: 400,
        message: 'Cannot move a folder into itself or one of its descendants',
      })
    }

    const escaped = createDeps()
    escaped.moveFolder.mockImplementation(() => {
      throw new Error('Invalid path: outside root')
    })
    expect(() => moveMapFolderUseCase({ from: 'old-folder', to: 'escape' }, escaped))
      .toThrow('Invalid path')

    const missing = createDeps()
    missing.moveFolder.mockReturnValue(null)
    try {
      moveMapFolderUseCase({ from: 'missing', to: 'new-folder' }, missing)
      throw new Error('expected missing folder to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MoveMapFolderUseCaseError)
      expect(err).toMatchObject({
        statusCode: 404,
        message: 'Folder "missing" not found',
      })
    }

    const conflict = createDeps()
    conflict.moveFolder.mockImplementation(() => {
      throw new Error('Destination folder already exists')
    })
    try {
      moveMapFolderUseCase({ from: 'old-folder', to: 'new-folder' }, conflict)
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
