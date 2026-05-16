import { describe, expect, it } from 'vitest'
import {
  buildEncounterTableFolderSet,
  countFilteredEncounterTables,
  deleteEncounterTableFolderFromLibrary,
  encounterTableLibraryKey,
  filterVisibleEncounterTables,
  moveEncounterTableFolderInLibrary,
} from '~/utils/encounterTableLibrary'
import type { EncounterTableEntry } from '~/types/encounterTable'

const entries: EncounterTableEntry[] = [
  {
    region: 'vale/forest',
    key: 'day',
    table: { name: 'Forest Day', min_level: 2, max_level: 5, entries: [[100, 'Oddish']] },
  },
  {
    region: 'vale/river',
    key: 'bank',
    table: { name: 'River Bank', min_level: 3, max_level: 6, entries: [[100, 'Magikarp']] },
  },
  {
    region: '',
    key: 'root',
    table: { name: 'Root Table', min_level: 1, max_level: 2, entries: [[100, 'Pidgey']] },
  },
]

describe('encounter table library helpers', () => {
  it('builds folder sets and keys', () => {
    expect(encounterTableLibraryKey(entries[0])).toBe('vale/forest/day')
    expect([...buildEncounterTableFolderSet(entries, ['empty/folder'])].sort()).toEqual([
      'empty/folder',
      'vale/forest',
      'vale/river',
    ])
  })

  it('filters visible tables by current folder and search query', () => {
    expect(filterVisibleEncounterTables({ items: entries, currentPath: '', searchTerm: '' }).map((entry) => entry.key)).toEqual(['root'])
    expect(filterVisibleEncounterTables({ items: entries, currentPath: 'vale', searchTerm: '' }).map((entry) => entry.key)).toEqual([])
    expect(filterVisibleEncounterTables({ items: entries, currentPath: 'vale/forest', searchTerm: '' }).map((entry) => entry.key)).toEqual(['day'])
    expect(filterVisibleEncounterTables({ items: entries, currentPath: 'vale', searchTerm: 'magikarp' }).map((entry) => entry.key)).toEqual(['bank'])
    expect(countFilteredEncounterTables(entries, 'forest')).toBe(1)
  })

  it('updates table and folder collections after folder moves/deletes', () => {
    const tables = new Map(entries.map((entry) => [encounterTableLibraryKey(entry), entry]))
    const extraFolders = new Set(['vale/forest/deep'])

    moveEncounterTableFolderInLibrary({ tables, extraFolders }, 'vale', 'routes/vale')
    expect([...tables.values()].map((entry) => entry.region).sort()).toEqual([
      '',
      'routes/vale/forest',
      'routes/vale/river',
    ])
    expect([...extraFolders]).toEqual(['routes/vale/forest/deep'])

    deleteEncounterTableFolderFromLibrary({ tables, extraFolders }, 'routes/vale/forest')
    expect([...tables.values()].map((entry) => entry.key).sort()).toEqual(['bank', 'root'])
    expect([...extraFolders]).toEqual([])
  })
})
