import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useSheetLibraryData } from '~/composables/library/useSheetLibraryData'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { sheetLibraryKey } from '~/utils/sheetLibrary'

const makePokemonSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'ember',
  nickname: 'Ember',
  species: 'Charmander',
  level: 5,
  folder: 'party',
  ...overrides,
})

const makeTrainerSheet = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'oak',
  name: 'Professor Oak',
  level: 10,
  folder: 'npcs',
  ...overrides,
})

describe('useSheetLibraryData', () => {
  it('builds sheet items and seeds existing sheet folders through an injected fetcher', async () => {
    const fetchFolders = vi.fn(async () => ({ folders: ['empty-folder', 'npcs/archive'] }))
    const data = useSheetLibraryData({
      isGm: ref(true),
      isPlayer: ref(false),
      canLoadFolders: ref(true),
      autoLoadFoldersOnMounted: false,
      fetchFolders,
      pokemonSheets: [makePokemonSheet()],
      trainerSheets: [makeTrainerSheet()],
      speciesTypesFor: () => ['Fire'],
      spriteUrlFor: () => '/sprites/charmander.png',
    })

    expect(data.items.value).toHaveLength(2)
    expect(data.items.value.find((item) => item.kind === 'pokemon')).toMatchObject({
      slug: 'ember',
      types: ['Fire'],
      spriteUrl: '/sprites/charmander.png',
    })

    await data.loadFolders()

    expect(fetchFolders).toHaveBeenCalledTimes(1)
    expect([...data.extraFolders].sort()).toEqual(['empty-folder', 'npcs/archive'])
    expect([...data.allFolders.value].sort()).toEqual(['empty-folder', 'npcs', 'npcs/archive', 'party'])
    expect(data.folderLoadError.value).toBeNull()
    expect(data.loadingFolders.value).toBe(false)
  })

  it('honours player-only filtering from the reactive auth state', () => {
    const isPlayer = ref(true)
    const data = useSheetLibraryData({
      isGm: ref(false),
      isPlayer,
      autoLoadFoldersOnMounted: false,
      pokemonSheets: [
        makePokemonSheet({ slug: 'player-mon', player: true }),
        makePokemonSheet({ slug: 'gm-mon', player: false }),
      ],
      trainerSheets: [makeTrainerSheet({ slug: 'gm-trainer', player: false })],
      speciesTypesFor: () => [],
      spriteUrlFor: () => null,
    })

    expect(data.items.value.map((item) => item.slug)).toEqual(['player-mon'])

    isPlayer.value = false
    expect(data.items.value.map((item) => item.slug).sort()).toEqual(['gm-mon', 'gm-trainer', 'player-mon'])
  })

  it('exposes local move, rename, and delete state for optimistic library updates', () => {
    const data = useSheetLibraryData({
      isGm: ref(true),
      isPlayer: ref(false),
      autoLoadFoldersOnMounted: false,
      pokemonSheets: [makePokemonSheet()],
      trainerSheets: [],
      speciesTypesFor: () => [],
      spriteUrlFor: () => null,
    })

    const key = sheetLibraryKey('pokemon', 'ember')
    data.sheetOverrides[key] = 'staging'
    data.folderRenames.value = [{ from: 'staging', to: 'renamed/staging' }]
    data.nameOverrides[key] = 'Cinder'

    expect(data.items.value[0]).toMatchObject({
      folder: 'renamed/staging',
      sheet: { nickname: 'Cinder' },
      sortKey: 'cinder',
    })

    data.deletedFolders.add('renamed')
    expect(data.items.value).toEqual([])

    data.deletedFolders.clear()
    data.deletedSheets.add(key)
    expect(data.items.value).toEqual([])
  })

  it('skips folder loading when disabled and normalizes load errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchFolders = vi.fn(async () => {
      throw { data: { statusMessage: 'Could not load folders.' } }
    })
    const canLoadFolders = ref(false)
    const data = useSheetLibraryData({
      isGm: ref(true),
      isPlayer: ref(false),
      canLoadFolders,
      autoLoadFoldersOnMounted: false,
      fetchFolders,
      pokemonSheets: [],
      trainerSheets: [],
      speciesTypesFor: () => [],
      spriteUrlFor: () => null,
    })

    await data.loadFolders()
    expect(fetchFolders).not.toHaveBeenCalled()

    canLoadFolders.value = true
    await data.loadFolders()

    expect(data.folderLoadError.value).toBe('Could not load folders.')
    expect(data.loadingFolders.value).toBe(false)
    expect(warn).toHaveBeenCalledWith('[sheets] failed to load existing folders', expect.anything())
    warn.mockRestore()
  })
})
