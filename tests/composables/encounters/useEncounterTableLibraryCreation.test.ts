import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useEncounterTableLibraryCreation } from '~/composables/encounters/useEncounterTableLibraryCreation'
import type { EncounterTableEntry } from '~/types/encounterTable'

const entry: EncounterTableEntry = {
  region: 'vale',
  key: 'forest',
  table: { name: 'Forest', min_level: 1, max_level: 5, entries: [[100, 'Pidgey']] },
}

describe('useEncounterTableLibraryCreation', () => {
  it('creates in the current folder and reports the new table', async () => {
    const onCreated = vi.fn()
    const createTable = vi.fn(async () => ({ ok: true as const, entry }))
    const creation = useEncounterTableLibraryCreation({
      canCreate: ref(true),
      currentPath: ref('vale'),
      createTable,
      onCreated,
    })

    await expect(creation.createNewTable()).resolves.toBe(entry)
    expect(createTable).toHaveBeenCalledWith('vale')
    expect(onCreated).toHaveBeenCalledWith(entry)
    expect(creation.createError.value).toBeNull()
    expect(creation.creating.value).toBe(false)
  })

  it('guards disabled creation and normalizes errors', async () => {
    const disabled = useEncounterTableLibraryCreation({
      canCreate: ref(false),
      currentPath: ref(''),
      createTable: vi.fn(),
    })
    await expect(disabled.createNewTable()).resolves.toBeNull()

    const failing = useEncounterTableLibraryCreation({
      canCreate: ref(true),
      currentPath: ref(''),
      createTable: vi.fn(async () => { throw new Error('Nope') }),
    })
    await expect(failing.createNewTable()).resolves.toBeNull()
    expect(failing.createError.value).toBe('Nope')
  })
})
