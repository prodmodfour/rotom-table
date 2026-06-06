import { describe, expect, it } from 'vitest'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  parsePlayerProfileDisplayName,
  parsePlayerProfileId,
  type PlayerProfile,
} from '#shared/playerProfiles'
import {
  PLAYER_PROFILE_MANAGEMENT_EMPTY_TEXT,
  PLAYER_PROFILE_MANAGEMENT_NO_LINKS_TEXT,
  PLAYER_PROFILE_MANAGEMENT_NO_SELECTION_TEXT,
  buildLinkableCharacterSheetOptions,
  buildLinkedCharacterManagementView,
  buildPlayerProfileManagementDetail,
  filterAvailableLinkableCharacterOptions,
  filterNonExampleLinkableCharacterOptions,
  isExampleSheetFolder,
  playerProfileLinkedCharacterCountLabel,
  playerProfileLinkedCharacterLabel,
} from '~/utils/playerProfileManagement'

const ashProfile: PlayerProfile = {
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: parsePlayerProfileId('profile_ash00000'),
  displayName: parsePlayerProfileDisplayName('Ash'),
  linkedCharacters: [
    { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
    { sheetKind: 'trainer', sheetSlug: 'ash' },
  ],
}

describe('player profile management helpers', () => {
  it('exposes clear empty-state copy for the GM shell', () => {
    expect(PLAYER_PROFILE_MANAGEMENT_EMPTY_TEXT).toContain('No player profiles')
    expect(PLAYER_PROFILE_MANAGEMENT_NO_SELECTION_TEXT).toContain('Select a player profile')
    expect(PLAYER_PROFILE_MANAGEMENT_NO_LINKS_TEXT).toContain('No linked characters')
  })

  it('formats linked-character counts', () => {
    expect(playerProfileLinkedCharacterCountLabel(0)).toBe('0 linked characters')
    expect(playerProfileLinkedCharacterCountLabel(1)).toBe('1 linked character')
    expect(playerProfileLinkedCharacterCountLabel(2)).toBe('2 linked characters')
  })

  it('formats linked-character labels and sheet links', () => {
    expect(playerProfileLinkedCharacterLabel({ sheetKind: 'pokemon', sheetSlug: 'pikachu' })).toBe(
      'Pokémon sheet · pikachu',
    )
    expect(playerProfileLinkedCharacterLabel({ sheetKind: 'trainer', sheetSlug: 'ash' })).toBe(
      'Trainer sheet · ash',
    )

    expect(buildLinkedCharacterManagementView({ sheetKind: 'pokemon', sheetSlug: 'pikachu' })).toEqual({
      key: 'pokemon:pikachu',
      ref: { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      label: 'Pokémon sheet · pikachu',
      kindLabel: 'Pokémon',
      sheetSlug: 'pikachu',
      href: '/sheets/pikachu',
    })
    expect(buildLinkedCharacterManagementView({ sheetKind: 'trainer', sheetSlug: 'ash' })).toEqual({
      key: 'trainer:ash',
      ref: { sheetKind: 'trainer', sheetSlug: 'ash' },
      label: 'Trainer sheet · ash',
      kindLabel: 'Trainer',
      sheetSlug: 'ash',
      href: '/sheets/trainers/ash',
    })
  })

  it('builds understandable link options from current Pokémon and trainer libraries', () => {
    const options = buildLinkableCharacterSheetOptions({
      pokemonSheets: [
        { slug: 'pikachu', nickname: 'Sparky', species: 'Pikachu', folder: 'party' },
      ],
      trainerSheets: [
        { slug: 'brock', name: 'Brock', folder: 'leaders' },
      ],
    })

    expect(options).toEqual([
      {
        key: 'trainer:brock',
        ref: { sheetKind: 'trainer', sheetSlug: 'brock' },
        label: 'Brock · Trainer sheet',
        detailsLabel: 'brock · leaders',
        displayName: 'Brock',
        kindLabel: 'Trainer',
        sheetSlug: 'brock',
        folder: 'leaders',
        href: '/sheets/trainers/brock',
      },
      {
        key: 'pokemon:pikachu',
        ref: { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
        label: 'Sparky · Pokémon sheet',
        detailsLabel: 'pikachu · Pikachu · party',
        displayName: 'Sparky',
        kindLabel: 'Pokémon',
        sheetSlug: 'pikachu',
        folder: 'party',
        href: '/sheets/pikachu',
      },
    ])

    expect(filterAvailableLinkableCharacterOptions(options, [
      { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
    ]).map((option) => option.key)).toEqual(['trainer:brock'])
  })

  it('identifies and filters example folders from link picker options', () => {
    expect(isExampleSheetFolder('examples')).toBe(true)
    expect(isExampleSheetFolder('Examples/generated')).toBe(true)
    expect(isExampleSheetFolder('players/examples')).toBe(false)
    expect(isExampleSheetFolder('')).toBe(false)
    expect(isExampleSheetFolder(undefined)).toBe(false)

    const options = buildLinkableCharacterSheetOptions({
      pokemonSheets: [
        { slug: 'example-pikachu', nickname: 'Example Pikachu', species: 'Pikachu', folder: 'examples' },
        { slug: 'nested-example', nickname: 'Nested Example', species: 'Pichu', folder: 'examples/generated' },
        { slug: 'player-eevee', nickname: 'Player Eevee', species: 'Eevee', folder: 'players/examples' },
      ],
      trainerSheets: [
        { slug: 'example-trainer', name: 'Example Trainer', folder: 'examples/trainers' },
        { slug: 'misty', name: 'Misty', folder: 'leaders' },
      ],
    })

    expect(filterNonExampleLinkableCharacterOptions(options).map((option) => option.key)).toEqual([
      'trainer:misty',
      'pokemon:player-eevee',
    ])
  })

  it('builds a detail view model for the selected profile', () => {
    expect(buildPlayerProfileManagementDetail(null)).toBeNull()
    expect(buildPlayerProfileManagementDetail(ashProfile)).toEqual({
      id: 'profile_ash00000',
      displayName: 'Ash',
      linkedCharacterCountLabel: '2 linked characters',
      linkedCharacters: [
        {
          key: 'pokemon:pikachu',
          ref: { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
          label: 'Pokémon sheet · pikachu',
          kindLabel: 'Pokémon',
          sheetSlug: 'pikachu',
          href: '/sheets/pikachu',
        },
        {
          key: 'trainer:ash',
          ref: { sheetKind: 'trainer', sheetSlug: 'ash' },
          label: 'Trainer sheet · ash',
          kindLabel: 'Trainer',
          sheetSlug: 'ash',
          href: '/sheets/trainers/ash',
        },
      ],
    })
  })
})
