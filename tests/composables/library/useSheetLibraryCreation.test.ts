import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useSheetLibraryCreation } from '~/composables/library/useSheetLibraryCreation'

const createdPokemon = { ok: true, kind: 'pokemon', slug: 'new-pokemon' } as const

describe('useSheetLibraryCreation', () => {
  it('toggles and closes the new-sheet menu only when creation is allowed', () => {
    const canCreate = ref(false)
    const creator = useSheetLibraryCreation({
      canCreate,
      currentPath: '',
      createSheet: vi.fn(),
      navigateToSheet: vi.fn(),
    })

    expect(creator.toggleSheetMenu()).toBe(false)
    expect(creator.sheetMenuOpen.value).toBe(false)

    canCreate.value = true
    expect(creator.toggleSheetMenu()).toBe(true)
    expect(creator.sheetMenuOpen.value).toBe(true)

    creator.closeSheetMenu()
    expect(creator.sheetMenuOpen.value).toBe(false)
  })

  it('creates a sheet in the current folder and navigates to the editor', async () => {
    const createSheet = vi.fn(async (kind: 'pokemon' | 'trainer', folder: string) => {
      expect(kind).toBe('pokemon')
      expect(folder).toBe('guild/team')
      return createdPokemon
    })
    const navigateToSheet = vi.fn()
    const creator = useSheetLibraryCreation({
      canCreate: true,
      currentPath: ref('guild/team'),
      createSheet,
      navigateToSheet,
    })
    creator.sheetMenuOpen.value = true

    await expect(creator.createSheet('pokemon')).resolves.toEqual(createdPokemon)

    expect(createSheet).toHaveBeenCalledTimes(1)
    expect(navigateToSheet).toHaveBeenCalledWith('pokemon', 'new-pokemon')
    expect(creator.sheetMenuOpen.value).toBe(false)
    expect(creator.creatingSheet.value).toBe(true)
    expect(creator.sheetCreateError.value).toBeNull()
  })

  it('does not create when blocked or already busy', async () => {
    const canCreate = ref(false)
    const createSheet = vi.fn()
    const creator = useSheetLibraryCreation({
      canCreate,
      currentPath: '',
      createSheet,
      navigateToSheet: vi.fn(),
    })

    await expect(creator.createSheet('trainer')).resolves.toBeNull()
    expect(createSheet).not.toHaveBeenCalled()

    canCreate.value = true
    creator.creatingSheet.value = true
    await expect(creator.createSheet('trainer')).resolves.toBeNull()
    expect(createSheet).not.toHaveBeenCalled()
  })

  it('normalizes creation errors and clears busy state', async () => {
    const creator = useSheetLibraryCreation({
      canCreate: true,
      currentPath: '',
      createSheet: vi.fn(async () => {
        throw { data: { statusMessage: 'Cannot create sheet.' } }
      }),
      navigateToSheet: vi.fn(),
    })
    creator.sheetMenuOpen.value = true

    await expect(creator.createSheet('pokemon')).resolves.toBeNull()

    expect(creator.sheetMenuOpen.value).toBe(false)
    expect(creator.creatingSheet.value).toBe(false)
    expect(creator.sheetCreateError.value).toBe('Cannot create sheet.')
  })
})
