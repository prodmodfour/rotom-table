import { describe, expect, it, vi } from 'vitest'
import { useEncounterTableLibraryData } from '~/composables/encounters/useEncounterTableLibraryData'
import { encounterTableLibraryKey } from '~/utils/encounterTableLibrary'
import type { EncounterTableEntry } from '~/types/encounterTable'

const entry = (region: string, key: string): EncounterTableEntry => ({
  region,
  key,
  table: { name: key, min_level: 1, max_level: 5, entries: [[100, 'Pidgey']] },
})

describe('useEncounterTableLibraryData', () => {
  it('seeds initial entries and refreshes from injected fetchers', async () => {
    const initial = entry('initial', 'forest')
    const next = entry('next', 'river')
    const data = useEncounterTableLibraryData({
      initialEntries: [initial],
      autoRefreshOnMounted: false,
      fetchTables: vi.fn(async () => ({ tables: [next] })),
      fetchFolders: vi.fn(async () => ({ folders: ['empty'] })),
    })

    expect(data.loading.value).toBe(false)
    expect(data.tables.get(encounterTableLibraryKey(initial))).toEqual(initial)

    await data.refresh()
    expect([...data.tables.keys()]).toEqual(['next/river'])
    expect([...data.extraFolders]).toEqual(['empty'])
    expect(data.items.value).toEqual([next])
    expect(data.loadError.value).toBeNull()
  })

  it('stores refresh errors without clearing existing tables first', async () => {
    const initial = entry('initial', 'forest')
    const data = useEncounterTableLibraryData({
      initialEntries: [initial],
      autoRefreshOnMounted: false,
      fetchTables: vi.fn(async () => { throw new Error('Nope') }),
      fetchFolders: vi.fn(async () => ({ folders: [] })),
    })

    await data.refresh()

    expect(data.loadError.value).toBe('Nope')
    expect(data.tables.get(encounterTableLibraryKey(initial))).toEqual(initial)
  })
})
