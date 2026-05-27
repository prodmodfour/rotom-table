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
  buildLinkedCharacterManagementView,
  buildPlayerProfileManagementDetail,
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
      label: 'Pokémon sheet · pikachu',
      kindLabel: 'Pokémon',
      sheetSlug: 'pikachu',
      href: '/sheets/pikachu',
    })
    expect(buildLinkedCharacterManagementView({ sheetKind: 'trainer', sheetSlug: 'ash' })).toEqual({
      key: 'trainer:ash',
      label: 'Trainer sheet · ash',
      kindLabel: 'Trainer',
      sheetSlug: 'ash',
      href: '/sheets/trainers/ash',
    })
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
          label: 'Pokémon sheet · pikachu',
          kindLabel: 'Pokémon',
          sheetSlug: 'pikachu',
          href: '/sheets/pikachu',
        },
        {
          key: 'trainer:ash',
          label: 'Trainer sheet · ash',
          kindLabel: 'Trainer',
          sheetSlug: 'ash',
          href: '/sheets/trainers/ash',
        },
      ],
    })
  })
})
