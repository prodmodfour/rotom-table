import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createEncounterTableFile,
  createEncounterTableFolder,
  deleteEncounterTableFile,
  listEncounterTableEntries,
  listEncounterTableFolders,
  moveEncounterTableFile,
  moveEncounterTableFolder,
  renameEncounterTableFile,
  writeEncounterTableStorageFile,
} from '~~/server/utils/encounterTableStorage'
import type { EncounterTable } from '~/types/encounterTable'

let roots: string[] = []

const tempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-encounters-'))
  roots.push(root)
  return root
}

const writeTable = (root: string, folder: string, key: string, table: EncounterTable): void => {
  const dir = folder ? join(root, folder) : root
  writeFileSync(join(dir, `${key}.json`), JSON.stringify(table, null, 2), 'utf8')
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('encounter table storage', () => {
  it('lists nested folders and table entries', () => {
    const root = tempRoot()
    createEncounterTableFolder('vale/deep', root)
    writeTable(root, 'vale/deep', 'forest', {
      name: 'Deep Forest',
      min_level: 5,
      max_level: 8,
      entries: [[100, 'Oddish']],
    })

    expect(listEncounterTableFolders(root)).toEqual(['vale', 'vale/deep'])
    expect(listEncounterTableEntries(root)).toEqual([
      {
        region: 'vale/deep',
        key: 'forest',
        table: { name: 'Deep Forest', min_level: 5, max_level: 8, entries: [[100, 'Oddish']] },
      },
    ])
  })

  it('creates, renames, moves, and deletes table files', () => {
    const root = tempRoot()
    createEncounterTableFolder('vale', root)

    const created = createEncounterTableFile('vale', 'Forest Path', root)
    expect(created.entry.region).toBe('vale')
    expect(created.entry.key).toBe('forest-path')
    expect(created.entry.table.entries).toEqual([{ ceiling: 100, species: 'Pidgey', min_level: 1, max_level: 5 }])

    const renamed = renameEncounterTableFile('vale', 'forest-path', 'River Bank', root)
    expect(renamed?.entry).toMatchObject({ region: 'vale', key: 'river-bank' })
    expect(renamed?.entry.table.name).toBe('River Bank')

    const moved = moveEncounterTableFile('vale', 'river-bank', 'vale/water', root)
    expect(moved?.entry).toMatchObject({ region: 'vale/water', key: 'river-bank' })
    expect(listEncounterTableFolders(root)).toContain('vale/water')

    const saved = writeEncounterTableStorageFile('vale/water', 'river-bank', {
      name: 'River Bank',
      min_level: 4,
      max_level: 9,
      entries: [{ ceiling: 100, species: 'Magikarp', min_level: 4, max_level: 9 }],
    }, root)
    expect(saved?.entry.table.entries).toEqual([{ ceiling: 100, species: 'Magikarp', min_level: 4, max_level: 9 }])

    const deleted = deleteEncounterTableFile('vale/water', 'river-bank', root)
    expect(deleted?.entry.key).toBe('river-bank')
    expect(listEncounterTableEntries(root)).toEqual([])
  })

  it('moves folders while preserving descendants', () => {
    const root = tempRoot()
    createEncounterTableFolder('vale/deep', root)
    writeTable(root, 'vale/deep', 'forest', {
      name: 'Deep Forest',
      min_level: 5,
      max_level: 8,
      entries: [[100, 'Oddish']],
    })

    expect(moveEncounterTableFolder('vale', 'routes/vale', root)).toEqual({ moved: true })
    expect(listEncounterTableEntries(root)[0]).toMatchObject({ region: 'routes/vale/deep', key: 'forest' })
  })
})
