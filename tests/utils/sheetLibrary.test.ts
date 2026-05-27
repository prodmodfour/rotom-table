import { computed, reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  applyFolderRenames,
  applySheetLibraryOverrides,
  buildSheetFolderSet,
  buildSheetLibraryItems,
  countFilteredSheetLibraryItems,
  displaySheetLibraryName,
  filterVisibleSheetLibraryItems,
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
  portraitUrl: '/trainer-sprites/lenora.png',
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
    expect(items[1]).toMatchObject({
      kind: 'trainer',
      slug: 'lenora',
      folder: 'npcs/gm',
      spriteUrl: '/trainer-sprites/lenora.png',
      sortKey: 'lenora',
    })
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
      pokemonSheets: [
        pokemon(),
        pokemon({ slug: 'hidden', nickname: 'Hidden', player: false }),
        pokemon({
          slug: 'session-granted',
          nickname: 'Session Granted',
          player: false,
          sessionPlayerAccessible: true,
        } as Partial<CharacterSheet>),
      ],
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

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ folder: 'team/beta/live', sortKey: 'sparky' })
    expect(items[1]).toMatchObject({ slug: 'session-granted', sortKey: 'session granted' })
    expect(displaySheetLibraryName(items[0])).toBe('Sparky')
    expect(displaySheetLibraryName(baseItems[0])).toBe('Bolt')
  })

  it('tracks newly added folder overrides in Vue computed state', () => {
    const baseItems = buildSheetLibraryItems({
      pokemonSheets: [pokemon()],
      trainerSheets: [],
      speciesTypesFor: () => [],
      spriteUrlFor: () => null,
    })
    const sheetOverrides = reactive<Record<string, string | undefined>>({})
    const visibleItems = computed(() => applySheetLibraryOverrides(baseItems, {
      playerOnly: false,
      sheetOverrides,
      folderRenames: [],
      nameOverrides: {},
      deletedSheets: new Set(),
      deletedFolders: new Set(),
    }))

    expect(visibleItems.value[0].folder).toBe('team/alpha')

    sheetOverrides[sheetLibraryKey('pokemon', 'bolt')] = ''

    expect(visibleItems.value[0].folder).toBe('')
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

  it('filters visible sheets by current folder, subtree search, and sort keys', () => {
    const items = buildSheetLibraryItems({
      pokemonSheets: [
        pokemon({ slug: 'root-b', nickname: 'B Root', folder: '' }),
        pokemon({ slug: 'root-a', nickname: 'A Root', folder: '' }),
        pokemon({ slug: 'child', nickname: 'Wild Child', folder: 'team/alpha' }),
      ],
      trainerSheets: [trainer({ slug: 'deep', name: 'Deep Trainer', folder: 'team/alpha/deep' })],
      speciesTypesFor: () => ['Electric'],
      spriteUrlFor: () => null,
    })

    expect(filterVisibleSheetLibraryItems({ items, currentPath: '', searchTerm: '' }).map((item) => item.slug)).toEqual([
      'root-a',
      'root-b',
    ])
    expect(filterVisibleSheetLibraryItems({ items, currentPath: 'team', searchTerm: 'trainer' }).map((item) => item.slug)).toEqual([
      'deep',
    ])
    expect(filterVisibleSheetLibraryItems({ items, currentPath: 'team/alpha', searchTerm: '' }).map((item) => item.slug)).toEqual([
      'child',
    ])
  })

  it('counts filtered sheets across the full item collection', () => {
    const items = buildSheetLibraryItems({
      pokemonSheets: [pokemon({ nature: 'Jolly' })],
      trainerSheets: [trainer({ playedBy: 'Ash' })],
      speciesTypesFor: () => ['Electric'],
      spriteUrlFor: () => null,
    })

    expect(countFilteredSheetLibraryItems(items, '')).toBe(2)
    expect(countFilteredSheetLibraryItems(items, 'ash')).toBe(1)
    expect(countFilteredSheetLibraryItems(items, 'electric')).toBe(1)
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
