import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { usePokedexEntryEditing } from '~/composables/pokedex/usePokedexEntryEditing'
import type { PokedexEntryDetail } from '~/utils/pokedex/entryIndex'

const makeEntry = (overrides: Partial<PokedexEntryDetail> = {}): PokedexEntryDetail => ({
  id: '25-pikachu',
  species: 'Pikachu',
  slug: 'pikachu',
  nationalDexNumber: 25,
  spriteUrl: '/sprites/pikachu.gif',
  profileSpriteUrl: '/api/profile-sprites/pokemon/pikachu',
  types: ['Electric'],
  ...overrides,
})

describe('usePokedexEntryEditing', () => {
  it('only enters edit mode for GMs and omits runtime fields', () => {
    const isGm = ref(false)
    const selectedEntry = ref<PokedexEntryDetail | null>(makeEntry())
    const editor = usePokedexEntryEditing({
      afterMutation: vi.fn(),
      isGm,
      saveEntry: vi.fn(),
      selectedEntry,
    })

    editor.enterEditMode()
    expect(editor.isEditMode.value).toBe(false)

    isGm.value = true
    editor.enterEditMode()
    expect(editor.isEditMode.value).toBe(true)
    expect(JSON.parse(editor.draftJson.value)).toEqual({ species: 'Pikachu', types: ['Electric'] })
  })

  it('saves valid JSON drafts through the provided mutation callbacks', async () => {
    const entry = makeEntry()
    const updated = makeEntry({ types: ['Electric', 'Steel'] })
    const afterMutation = vi.fn<() => Promise<void>>(() => Promise.resolve())
    const saveEntry = vi.fn(() => Promise.resolve({ ok: true as const, path: 'data/reference/pokedex.json', entry: updated }))
    const editor = usePokedexEntryEditing({
      afterMutation,
      isGm: ref(true),
      saveEntry,
      selectedEntry: ref<PokedexEntryDetail | null>(entry),
    })

    editor.enterEditMode()
    editor.draftJson.value = JSON.stringify({ species: 'Pikachu', types: ['Electric', 'Steel'] })
    await editor.saveEditedEntry()

    expect(saveEntry).toHaveBeenCalledWith('pikachu', { species: 'Pikachu', types: ['Electric', 'Steel'] })
    expect(afterMutation).toHaveBeenCalledWith('pikachu', updated)
    expect(editor.statusMessage.value).toBe('Saved Pikachu.')
  })

  it('closes edit mode when the selected entry changes', async () => {
    const selectedEntry = ref<PokedexEntryDetail | null>(makeEntry())
    const editor = usePokedexEntryEditing({
      afterMutation: vi.fn(),
      isGm: ref(true),
      saveEntry: vi.fn(),
      selectedEntry,
    })

    editor.enterEditMode()
    selectedEntry.value = makeEntry({ id: '1-bulbasaur', species: 'Bulbasaur', slug: 'bulbasaur' })
    await nextTick()

    expect(editor.isEditMode.value).toBe(false)
  })
})
