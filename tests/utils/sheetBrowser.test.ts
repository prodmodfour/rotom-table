import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  buildSheetBrowserFolderSet,
  buildSheetBrowserFolderTiles,
  buildSheetBrowserItems,
  filterSheetBrowserItems,
  sheetBrowserSelectionForItem,
} from '~/utils/sheetBrowser'

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'pikachu',
  nickname: 'Sparky',
  species: 'Pikachu',
  level: 12,
  folder: '',
  ...overrides,
} as CharacterSheet)

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'misty',
  name: 'Misty',
  level: 8,
  folder: '',
  classes: [{ name: 'Ace Trainer' }],
  portraitUrl: '/portrait.png',
  ...overrides,
} as TrainerSheet)

describe('sheet browser helpers', () => {
  it('builds Pokémon and trainer browser items', () => {
    const items = buildSheetBrowserItems({
      pokemonSheets: [pokemon({ folder: 'party' })],
      trainerSheets: [trainer({ folder: 'npcs' })],
      spriteUrlForSpecies: (species) => `/sprites/${species}.png`,
    })

    expect(items).toMatchObject([
      {
        kind: 'pokemon',
        slug: 'pikachu',
        folder: 'party',
        spriteUrl: '/sprites/Pikachu.png',
        displayName: 'Sparky',
        meta: 'Pikachu · Lv 12',
      },
      {
        kind: 'trainer',
        slug: 'misty',
        folder: 'npcs',
        spriteUrl: '/portrait.png',
        displayName: 'Misty',
        meta: 'Trainer · Lv 8 · Ace Trainer',
      },
    ])
  })

  it('derives folder sets and direct child folder tiles', () => {
    const items = buildSheetBrowserItems({
      pokemonSheets: [pokemon({ folder: 'league/a' })],
      trainerSheets: [trainer({ folder: 'league/b' })],
      spriteUrlForSpecies: () => null,
    })

    expect([...buildSheetBrowserFolderSet(items)].sort()).toEqual(['league/a', 'league/b'])
    expect(buildSheetBrowserFolderTiles(items, '', '')).toEqual([
      { path: 'league', label: 'league', count: 2 },
    ])
    expect(buildSheetBrowserFolderTiles(items, 'league', '')).toEqual([
      { path: 'league/a', label: 'a', count: 1 },
      { path: 'league/b', label: 'b', count: 1 },
    ])
  })

  it('filters direct folders normally and subtree matches while searching', () => {
    const items = buildSheetBrowserItems({
      pokemonSheets: [
        pokemon({ slug: 'root', nickname: 'Rootmon', folder: '' }),
        pokemon({ slug: 'deep', nickname: 'Deepmon', folder: 'league/a' }),
      ],
      trainerSheets: [trainer({ slug: 'misty', name: 'Misty', folder: 'league' })],
      spriteUrlForSpecies: () => null,
    })

    expect(filterSheetBrowserItems(items, 'league', '').map((item) => item.slug)).toEqual(['misty'])
    expect(filterSheetBrowserItems(items, 'league', 'deep').map((item) => item.slug)).toEqual(['deep'])
    expect(filterSheetBrowserItems(items, '', 'ace trainer').map((item) => item.slug)).toEqual(['misty'])
  })

  it('orders trainer sheets before Pokémon sheets while preserving name sort within each kind', () => {
    const items = buildSheetBrowserItems({
      pokemonSheets: [
        pokemon({ slug: 'a-pokemon', nickname: 'A Pokémon', folder: '' }),
        pokemon({ slug: 'z-pokemon', nickname: 'Z Pokémon', folder: '' }),
      ],
      trainerSheets: [
        trainer({ slug: 'z-trainer', name: 'Z Trainer', folder: '' }),
        trainer({ slug: 'b-trainer', name: 'B Trainer', folder: '' }),
      ],
      spriteUrlForSpecies: () => null,
    })

    expect(filterSheetBrowserItems(items, '', '').map((item) => item.slug)).toEqual([
      'b-trainer',
      'z-trainer',
      'a-pokemon',
      'z-pokemon',
    ])
  })

  it('returns selection payloads without exposing component branching', () => {
    const [pokemonItem, trainerItem] = buildSheetBrowserItems({
      pokemonSheets: [pokemon()],
      trainerSheets: [trainer()],
      spriteUrlForSpecies: () => null,
    })

    expect(sheetBrowserSelectionForItem(pokemonItem)).toEqual({ kind: 'pokemon', sheet: pokemonItem.sheet })
    expect(sheetBrowserSelectionForItem(trainerItem)).toEqual({ kind: 'trainer', sheet: trainerItem.sheet })
  })
})
