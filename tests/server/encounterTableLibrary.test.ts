import { describe, expect, it, vi } from 'vitest'
import {
  EncounterTableLibraryUseCaseError,
  createEncounterTableFolderUseCase,
  createEncounterTableUseCase,
  deleteEncounterTableFolderUseCase,
  deleteEncounterTableUseCase,
  listEncounterTableFoldersUseCase,
  listEncounterTablesUseCase,
  moveEncounterTableFolderUseCase,
  moveEncounterTableUseCase,
  renameEncounterTableUseCase,
} from '~~/server/useCases/encounterTableLibrary'
import type { EncounterTableEntry } from '~/types/encounterTable'

const entry: EncounterTableEntry = {
  region: 'vale',
  key: 'forest',
  table: { name: 'Forest', min_level: 1, max_level: 5, entries: [[100, 'Pidgey']] },
}

const errorFor = (fn: () => unknown): unknown => {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
}

describe('encounter table library use cases', () => {
  it('lists tables and folders through injected storage', () => {
    expect(listEncounterTablesUseCase({ listTables: () => [entry] })).toEqual({ tables: [entry] })
    expect(listEncounterTableFoldersUseCase({ listFolders: () => ['vale'] })).toEqual({ folders: ['vale'] })
  })

  it('creates tables and folders with normalized inputs', () => {
    const createTable = vi.fn(() => ({ entry, path: 'encounter_tables/vale/forest.json' }))
    const createFolder = vi.fn(() => ({ created: true, folder: 'vale/deep', path: 'encounter_tables/vale/deep' }))

    expect(createEncounterTableUseCase({ folder: 'vale', name: '  Forest  ' }, { createTable })).toEqual({
      ok: true,
      entry,
      path: 'encounter_tables/vale/forest.json',
    })
    expect(createTable).toHaveBeenCalledWith('vale', 'Forest')

    expect(createEncounterTableFolderUseCase({ folder: 'vale/deep' }, { createFolder })).toEqual({
      ok: true,
      created: true,
      folder: 'vale/deep',
      path: 'encounter_tables/vale/deep',
    })
  })

  it('moves and renames tables', () => {
    const movedEntry = { ...entry, region: 'vale/deep' }
    const renamedEntry = { ...entry, key: 'dark-forest', table: { ...entry.table, name: 'Dark Forest' } }
    const moveTable = vi.fn(() => ({ entry: movedEntry, path: 'encounter_tables/vale/deep/forest.json' }))
    const renameTable = vi.fn(() => ({ entry: renamedEntry, path: 'encounter_tables/vale/dark-forest.json' }))

    expect(moveEncounterTableUseCase({ region: 'vale', key: 'forest', folder: 'vale/deep' }, { moveTable })).toEqual({
      ok: true,
      entry: movedEntry,
      path: 'encounter_tables/vale/deep/forest.json',
    })
    expect(moveTable).toHaveBeenCalledWith('vale', 'forest', 'vale/deep')

    expect(renameEncounterTableUseCase({ region: 'vale', key: 'forest', name: 'Dark Forest' }, { renameTable })).toEqual({
      ok: true,
      entry: renamedEntry,
      path: 'encounter_tables/vale/dark-forest.json',
    })
  })

  it('moves and deletes folders', () => {
    expect(moveEncounterTableFolderUseCase({ from: 'vale/deep', to: 'deep' }, {
      moveFolder: () => ({ moved: true }),
    })).toEqual({ ok: true, moved: true })

    expect(deleteEncounterTableFolderUseCase({ folder: 'deep' }, {
      deleteFolder: () => ({ removed: 'encounter_tables/deep' }),
    })).toEqual({ ok: true, removed: 'encounter_tables/deep' })
  })

  it('deletes tables and reports missing storage entries', () => {
    expect(deleteEncounterTableUseCase({ region: 'vale', key: 'forest' }, {
      deleteTable: () => ({ entry, path: 'encounter_tables/vale/forest.json' }),
    })).toEqual({ ok: true, entry, path: 'encounter_tables/vale/forest.json' })

    const missing = errorFor(() => deleteEncounterTableUseCase({ region: 'vale', key: 'forest' }, {
      deleteTable: () => null,
    }))
    expect(missing).toBeInstanceOf(EncounterTableLibraryUseCaseError)
    expect(missing).toMatchObject({ statusCode: 404 })
  })

  it('rejects unsafe folders and storage conflicts', () => {
    const invalid = errorFor(() => createEncounterTableFolderUseCase({ folder: '../bad' }))
    expect(invalid).toBeInstanceOf(EncounterTableLibraryUseCaseError)
    expect(invalid).toMatchObject({ statusCode: 400 })

    const conflict = errorFor(() => moveEncounterTableFolderUseCase({ from: 'a', to: 'b' }, {
      moveFolder: () => {
        throw new Error('Destination folder already exists')
      },
    }))
    expect(conflict).toMatchObject({ statusCode: 409 })
  })
})
