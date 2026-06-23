import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { usePokedexAdminPanel } from '~/composables/pokedex/usePokedexAdminPanel'
import type { PokedexEntryDetail } from '~/utils/pokedex/entryIndex'

const makeEntry = (overrides: Partial<PokedexEntryDetail> = {}): PokedexEntryDetail => ({
  id: '25-pikachu',
  species: 'Pikachu',
  slug: 'pikachu',
  nationalDexNumber: 25,
  spriteUrl: '/sprites/pikachu.gif',
  profileSpriteUrl: '/api/profile-sprites/pokemon/pikachu',
  ...overrides,
})

describe('usePokedexAdminPanel', () => {
  it('only opens for GMs', () => {
    const isGm = ref(false)
    const panel = usePokedexAdminPanel({
      afterMutation: vi.fn(),
      isGm,
      restoreFromBooks: vi.fn(),
      selectedEntry: ref(makeEntry()),
    })

    panel.open()
    expect(panel.isOpen.value).toBe(false)

    isGm.value = true
    panel.open()
    expect(panel.isOpen.value).toBe(true)
  })

  it('restores the selected entry through the provided mutation callbacks', async () => {
    const entry = makeEntry()
    const restored = makeEntry({ types: ['Electric'] })
    const afterMutation = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const onRestoredEntry = vi.fn()
    const restoreFromBooks = vi.fn(() => Promise.resolve({
      ok: true as const,
      path: 'data/reference/pokedex.json',
      entry: restored,
    }))
    const panel = usePokedexAdminPanel({
      afterMutation,
      isGm: ref(true),
      onRestoredEntry,
      restoreFromBooks,
      selectedEntry: ref<PokedexEntryDetail | null>(entry),
    })

    await panel.restoreSelectedEntryFromBooks()

    expect(restoreFromBooks).toHaveBeenCalledWith('pikachu')
    expect(afterMutation).toHaveBeenCalledWith('pikachu', restored)
    expect(onRestoredEntry).toHaveBeenCalledWith(restored)
    expect(panel.statusMessage.value).toBe('Restored Pikachu from PTU markdown books.')
  })
})
