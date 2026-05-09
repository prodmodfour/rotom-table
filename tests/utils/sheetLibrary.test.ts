import { describe, expect, it } from 'vitest'
import {
  applyFolderRenames,
  applySheetLibraryOverrides,
  buildSheetFolderSet,
  buildSheetLibraryItems,
  displaySheetLibraryName,
  isInsideDeletedSheetFolder,
  matchesSheetLibraryQuery,
  resolveSheetLibraryFolder,
  sheetLibraryKey,
} from '~/utils/sheetLibrary'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'bolt',
  species: 'Pikachu',
  nickname: 'Bolt',
  folder: 'team/alpha',
  player: true,
  ...overrides,
} as CharacterSheet)

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'lenora',
  name: 'Lenora',
  folder: 'npcs/gm',
  player: false,
  classes: [{ name: 'Ace Trainer' }],
  skillBackground: { name: 'Scholar' },
  ...overrides,
} as TrainerSheet)

describe('sheetLibrary helpers', () => {
  it('builds Pokémon and trainer library items', () => {
    const items = buildSheetLibraryItems({
      pokemonSheets: [pokemon({ types: undefined })],
      trainerSheets: [trainer()],
      speciesTypesFor: (species) => species === 'Pikachu' ? ['Electric'] : undefined,
      spriteUrlFor: (species) => `/sprites/${species}.png`,
    })

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      kind: 'pokemon',
      slug: 'bolt',
      folder: 'team/alpha',
      types: ['Electric'],
      spriteUrl: '/sprites/Pikachu.png',
      sortKey: 'bolt',
    })
    expect(items[1]).toMatchObject({ kind: 'trainer', slug: 'lenora', folder: 'npcs/gm', sortKey: 'lenora' })
  })

  it('resolves keys, display names, folder overrides, and folder renames', () => {
    const item = buildSheetLibraryItems({
      pokemonSheets: [pokemon()],
      trainerSheets: [],
      speciesTypesFor: () => [],
      spriteUrlFor: () => null,
    })[0]

    expect(sheetLibraryKey('pokemon', 'bolt')).toBe('pokemon:bolt')
    expect(displaySheetLibraryName(item)).toBe('Bolt')
    expect(applyFolderRenames('team/alpha/deep', [{ from: 'team/alpha', to: 'team/beta' }])).toBe('team/beta/deep')
    expect(resolveSheetLibraryFolder(item, { 'pokemon:bolt': 'staging' }, [{ from: 'staging', to: 'archive' }])).toBe('archive')
  })

  it('applies player/deleted/name/folder overrides without mutating base items', () => {
    const baseItems = buildSheetLibraryItems({
      pokemonSheets: [pokemon(), pokemon({ slug: 'hidden', nickname: 'Hidden', player: false })],
      trainerSheets: [trainer()],
      speciesTypesFor: () => [],
      spriteUrlFor: () => null,
    })

    const items = applySheetLibraryOverrides(baseItems, {
      playerOnly: true,
      sheetOverrides: { 'pokemon:bolt': 'team/alpha/live' },
      folderRenames: [{ from: 'team/alpha', to: 'team/beta' }],
      nameOverrides: { 'pokemon:bolt': 'Sparky' },
      deletedSheets: new Set(),
      deletedFolders: new Set(['team/beta/live/archive']),
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ folder: 'team/beta/live', sortKey: 'sparky' })
    expect(displaySheetLibraryName(items[0])).toBe('Sparky')
    expect(displaySheetLibraryName(baseItems[0])).toBe('Bolt')
  })

  it('filters deleted sheets and folders', () => {
    const baseItems = buildSheetLibraryItems({
      pokemonSheets: [pokemon(), pokemon({ slug: 'deleted', folder: 'team/old' })],
      trainerSheets: [],
      speciesTypesFor: () => [],
      spriteUrlFor: () => null,
    })

    expect(isInsideDeletedSheetFolder('team/old/deep', new Set(['team/old']))).toBe(true)
    expect(applySheetLibraryOverrides(baseItems, {
      playerOnly: false,
      sheetOverrides: {},
      folderRenames: [],
      nameOverrides: {},
      deletedSheets: new Set(['pokemon:deleted']),
      deletedFolders: new Set(),
    }).map((item) => item.slug)).toEqual(['bolt'])
  })

  it('builds folder sets from visible items plus GM-only extras', () => {
    const items = buildSheetLibraryItems({
      pokemonSheets: [pokemon()],
      trainerSheets: [trainer()],
      speciesTypesFor: () => [],
      spriteUrlFor: () => null,
    })

    expect([...buildSheetFolderSet({
      items,
      extraFolders: ['team/alpha/empty', 'team/old/empty'],
      includeExtraFolders: true,
      folderRenames: [{ from: 'team/alpha', to: 'team/beta' }],
      deletedFolders: new Set(['team/old']),
    })].sort()).toEqual(['npcs/gm', 'team/alpha', 'team/beta/empty'])

    expect([...buildSheetFolderSet({
      items,
      extraFolders: ['team/alpha/empty'],
      includeExtraFolders: false,
      folderRenames: [],
      deletedFolders: new Set(),
    })].sort()).toEqual(['npcs/gm', 'team/alpha'])
  })

  it('matches Pokémon and trainer search fields', () => {
    const items = buildSheetLibraryItems({
      pokemonSheets: [pokemon({ nature: 'Jolly' })],
      trainerSheets: [trainer({ playedBy: 'Ash' })],
      speciesTypesFor: () => ['Electric'],
      spriteUrlFor: () => null,
    })

    expect(matchesSheetLibraryQuery(items[0], 'electric')).toBe(true)
    expect(matchesSheetLibraryQuery(items[0], 'jolly')).toBe(true)
    expect(matchesSheetLibraryQuery(items[1], 'ace trainer')).toBe(true)
    expect(matchesSheetLibraryQuery(items[1], 'ash')).toBe(true)
    expect(matchesSheetLibraryQuery(items[1], 'missing')).toBe(false)
  })
})
