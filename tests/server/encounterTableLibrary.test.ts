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
  normalizeEncounterTableForSave,
  renameEncounterTableUseCase,
  saveEncounterTableUseCase,
} from '~~/server/useCases/encounterTableLibrary'
import type { EncounterTableEntry } from '~/types/encounterTable'

const entry: EncounterTableEntry = {
  region: 'vale',
  key: 'forest',
  table: { name: 'Forest', min_level: 1, max_level: 5, entries: [{ weight: 1, species: 'Pidgey' }] },
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

  it('saves tables with normalized weights and per-Pokémon level ranges', () => {
    const saveTable = vi.fn((region: string, key: string, table) => ({
      entry: { region, key, table },
      path: 'encounter_tables/vale/forest.json',
    }))

    expect(saveEncounterTableUseCase({
      region: 'vale',
      key: 'forest',
      table: {
        name: 'Forest',
        min_level: 1,
        max_level: 5,
        entries: [
          { weight: 2, species: 'Pidgey', min_level: 3, max_level: 4 },
          [100, 'Oddish', 6, 9],
        ],
      },
    }, { saveTable })).toEqual({
      ok: true,
      path: 'encounter_tables/vale/forest.json',
      entry: {
        region: 'vale',
        key: 'forest',
        table: {
          name: 'Forest',
          min_level: 3,
          max_level: 9,
          entries: [
            { weight: 2, species: 'Pidgey', min_level: 3, max_level: 4 },
            { weight: 98, species: 'Oddish', min_level: 6, max_level: 9 },
            { weight: 60, species: 'Nothing' },
          ],
        },
      },
    })
  })

  it('rejects invalid tables before saving', () => {
    const invalid = errorFor(() => normalizeEncounterTableForSave({
      name: 'Bad',
      min_level: 1,
      max_level: 5,
      entries: [{ weight: 1, species: '', min_level: 1, max_level: 5 }],
    }))

    expect(invalid).toBeInstanceOf(EncounterTableLibraryUseCaseError)
    expect(invalid).toMatchObject({ statusCode: 400, message: 'Row 1: species is required' })
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
