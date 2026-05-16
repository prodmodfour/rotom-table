import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useEncounterTableLibraryActions } from '~/composables/encounters/useEncounterTableLibraryActions'
import { encounterTableLibraryKey } from '~/utils/encounterTableLibrary'
import type { EncounterTableEntry } from '~/types/encounterTable'

const table = (region: string, key: string, name = key): EncounterTableEntry => ({
  region,
  key,
  table: { name, min_level: 1, max_level: 5, entries: [[100, 'Pidgey']] },
})

describe('useEncounterTableLibraryActions', () => {
  it('moves tables and folders locally after persistence succeeds', async () => {
    const first = table('vale', 'forest', 'Forest')
    const tables = new Map([[encounterTableLibraryKey(first), first]])
    const extraFolders = new Set(['vale/deep'])
    const moveTable = vi.fn(async () => ({ entry: table('archive', 'forest', 'Forest') }))
    const moveFolder = vi.fn(async () => undefined)
    const goToFolder = vi.fn()

    const actions = useEncounterTableLibraryActions({
      currentPath: ref(''),
      allFolders: ref(new Set(['vale', 'vale/deep', 'archive'])),
      tables,
      extraFolders,
      goToFolder,
      moveTable,
      moveFolder,
      renameTable: vi.fn(),
      deleteTable: vi.fn(),
      deleteFolder: vi.fn(),
    })

    await actions.movePayload({ type: 'table', id: 'vale/forest', region: 'vale', key: 'forest' }, 'archive')
    expect(moveTable).toHaveBeenCalledWith({ region: 'vale', key: 'forest', folder: 'archive' })
    expect([...tables.keys()]).toEqual(['archive/forest'])

    await actions.movePayload({ type: 'folder', path: 'vale/deep' }, 'archive')
    expect(moveFolder).toHaveBeenCalledWith({ from: 'vale/deep', to: 'archive/deep' })
    expect([...extraFolders]).toContain('archive/deep')
  })

  it('renames and deletes context targets', async () => {
    const first = table('vale', 'forest', 'Forest')
    const tables = new Map([[encounterTableLibraryKey(first), first]])
    const extraFolders = new Set(['vale/deep'])
    const goToFolder = vi.fn()
    const renameTable = vi.fn(async () => ({ entry: table('vale', 'dark-forest', 'Dark Forest') }))
    const deleteFolder = vi.fn(async () => undefined)

    const actions = useEncounterTableLibraryActions({
      currentPath: ref('vale/deep'),
      allFolders: ref(new Set(['vale', 'vale/deep'])),
      tables,
      extraFolders,
      goToFolder,
      moveTable: vi.fn(),
      moveFolder: vi.fn(async () => undefined),
      renameTable,
      deleteTable: vi.fn(),
      deleteFolder,
    })

    await actions.renameTarget({ type: 'table', item: first }, 'Dark Forest')
    expect(renameTable).toHaveBeenCalledWith({ region: 'vale', key: 'forest', name: 'Dark Forest' })
    expect([...tables.keys()]).toEqual(['vale/dark-forest'])

    await actions.deleteTarget({ type: 'folder', tile: { path: 'vale/deep', label: 'deep', count: 0 } })
    expect(deleteFolder).toHaveBeenCalledWith({ folder: 'vale/deep' })
    expect(goToFolder).toHaveBeenCalledWith('vale')
  })
})
