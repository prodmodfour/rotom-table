import { describe, expect, it, vi } from 'vitest'
import {
  CreateSheetFolderUseCaseError,
  createSheetFolderUseCase,
} from '../../server/useCases/createSheetFolder'
import {
  DeleteSheetFolderUseCaseError,
  deleteSheetFolderUseCase,
} from '../../server/useCases/deleteSheetFolder'
import { listSheetFoldersUseCase } from '../../server/useCases/listSheetFolders'
import {
  MoveSheetFolderUseCaseError,
  moveSheetFolderUseCase,
} from '../../server/useCases/moveSheetFolder'

describe('sheet folder use cases', () => {
  it('creates sanitized sheet folders and preserves response shape', () => {
    const createFolder = vi.fn((folder: string) => ({
      created: true,
      folder,
      path: `data/sheets/${folder}`,
    }))

    const result = createSheetFolderUseCase({ folder: ' party/boxed ' }, { createFolder })

    expect(createFolder).toHaveBeenCalledWith('party/boxed')
    expect(result).toEqual({ ok: true, created: true, path: 'data/sheets/party/boxed' })
  })

  it('maps create-folder validation failures while preserving unexpected storage failures', () => {
    expect(() => createSheetFolderUseCase({ folder: '' }, { createFolder: vi.fn() })).toThrow('folder must not be empty')

    try {
      createSheetFolderUseCase({ folder: '' }, { createFolder: vi.fn() })
    } catch (err) {
      expect(err).toBeInstanceOf(CreateSheetFolderUseCaseError)
      expect(err).toMatchObject({ statusCode: 400 })
    }

    const diskFailure = new Error('disk full')
    expect(() => createSheetFolderUseCase({ folder: 'party' }, {
      createFolder: () => { throw diskFailure },
    })).toThrow(diskFailure)
  })

  it('moves sheet folders with compatible count responses', () => {
    const moveFolder = vi.fn((_from: string, _to: string) => ({ moved: true, count: 2 }))

    const result = moveSheetFolderUseCase({ from: '/party', to: 'archive/party/' }, { moveFolder })

    expect(moveFolder).toHaveBeenCalledWith('party', 'archive/party')
    expect(result).toEqual({ ok: true, moved: true, count: 2 })
  })

  it('maps missing, conflict, and invalid move-folder failures', () => {
    expect(() => moveSheetFolderUseCase({ from: 'missing', to: 'archive' }, {
      moveFolder: () => null,
    })).toThrow('Folder "missing" not found')
    try {
      moveSheetFolderUseCase({ from: 'missing', to: 'archive' }, { moveFolder: () => null })
    } catch (err) {
      expect(err).toBeInstanceOf(MoveSheetFolderUseCaseError)
      expect(err).toMatchObject({ statusCode: 404 })
    }

    expect(() => moveSheetFolderUseCase({ from: 'party', to: 'archive' }, {
      moveFolder: () => { throw new Error('Destination already exists in data/sheets') },
    })).toThrow('Destination already exists')
    try {
      moveSheetFolderUseCase({ from: 'party', to: 'archive' }, {
        moveFolder: () => { throw new Error('Destination already exists in data/sheets') },
      })
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 409 })
    }

    expect(() => moveSheetFolderUseCase({ from: '', to: 'archive' }, { moveFolder: vi.fn() })).toThrow('from must not be empty')
    try {
      moveSheetFolderUseCase({ from: '', to: 'archive' }, { moveFolder: vi.fn() })
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 400 })
    }
  })

  it('deletes sheet folders with compatible removed path arrays', () => {
    const deleteFolder = vi.fn((folder: string) => ({
      count: 2,
      removed: [`data/sheets/${folder}`, `data/trainers/${folder}`],
    }))

    const result = deleteSheetFolderUseCase({ folder: 'archive/party' }, { deleteFolder })

    expect(deleteFolder).toHaveBeenCalledWith('archive/party')
    expect(result).toEqual({
      ok: true,
      count: 2,
      removed: ['data/sheets/archive/party', 'data/trainers/archive/party'],
    })
  })

  it('maps missing and invalid delete-folder failures', () => {
    expect(() => deleteSheetFolderUseCase({ folder: 'missing' }, { deleteFolder: () => null })).toThrow('Folder "missing" not found')
    try {
      deleteSheetFolderUseCase({ folder: 'missing' }, { deleteFolder: () => null })
    } catch (err) {
      expect(err).toBeInstanceOf(DeleteSheetFolderUseCaseError)
      expect(err).toMatchObject({ statusCode: 404 })
    }

    expect(() => deleteSheetFolderUseCase({ folder: '' }, { deleteFolder: vi.fn() })).toThrow('folder must not be empty')
    try {
      deleteSheetFolderUseCase({ folder: '' }, { deleteFolder: vi.fn() })
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 400 })
    }
  })

  it('lists sheet folders for GMs and hides them from players', () => {
    const listFolders = vi.fn(() => ['party', 'archive'])

    expect(listSheetFoldersUseCase({ role: 'gm' }, { listFolders })).toEqual({ folders: ['party', 'archive'] })
    expect(listFolders).toHaveBeenCalledTimes(1)
    expect(listSheetFoldersUseCase({ role: 'player' }, { listFolders })).toEqual({ folders: [] })
    expect(listFolders).toHaveBeenCalledTimes(1)
  })
})
