import { describe, expect, it } from 'vitest'
import {
  isPlayerCharacterAttackOfOpportunityPair,
  isPlayerCharacterToken,
  playerCharacterSheetKeysForProfiles,
} from '~/utils/playerCharacterTokens'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  parsePlayerProfileDisplayName,
  parsePlayerProfileId,
  type PlayerProfile,
} from '#shared/playerProfiles'

const profile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: parsePlayerProfileId('profile_ash00000'),
  displayName: parsePlayerProfileDisplayName('Ash'),
  linkedCharacters,
})

const lookup = (playerCharacterSheetKeys: ReadonlySet<string>) => ({
  playerCharacterSheetKeys,
  pokemonBySlug: new Map([
    ['selected-profile-pokemon', { playerProfileAccessible: true }],
    ['legacy-session-pokemon', { sessionPlayerAccessible: true }],
    ['public-only-pokemon', { player: true }],
  ]),
  trainerBySlug: new Map([
    ['npc-trainer', {}],
  ]),
})

describe('player character token helpers', () => {
  it('derives player character sheet keys from linked player profiles', () => {
    expect([...playerCharacterSheetKeysForProfiles([
      profile([
        { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
        { sheetKind: 'trainer', sheetSlug: 'misty' },
      ]),
    ])]).toEqual(['pokemon:pikachu', 'trainer:misty'])
  })

  it('recognizes profile-linked and player-specific runtime access markers', () => {
    const keys = playerCharacterSheetKeysForProfiles([
      profile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]),
    ])
    const tokenLookup = lookup(keys)

    expect(isPlayerCharacterToken({ sheetKind: 'pokemon', sheetSlug: 'pikachu' }, tokenLookup)).toBe(true)
    expect(isPlayerCharacterToken({ sheetKind: 'pokemon', sheetSlug: 'selected-profile-pokemon' }, tokenLookup)).toBe(true)
    expect(isPlayerCharacterToken({ sheetKind: 'pokemon', sheetSlug: 'legacy-session-pokemon' }, tokenLookup)).toBe(true)
    expect(isPlayerCharacterToken({ sheetKind: 'pokemon', sheetSlug: 'public-only-pokemon' }, tokenLookup)).toBe(false)
    expect(isPlayerCharacterToken({ sheetKind: 'trainer', sheetSlug: 'npc-trainer' }, tokenLookup)).toBe(false)
  })

  it('identifies only mutual player-character AoO pairs', () => {
    const tokenLookup = lookup(playerCharacterSheetKeysForProfiles([
      profile([
        { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
        { sheetKind: 'trainer', sheetSlug: 'misty' },
      ]),
    ]))

    expect(isPlayerCharacterAttackOfOpportunityPair({
      ...tokenLookup,
      attacker: { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      provoker: { sheetKind: 'trainer', sheetSlug: 'misty' },
    })).toBe(true)

    expect(isPlayerCharacterAttackOfOpportunityPair({
      ...tokenLookup,
      attacker: { sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      provoker: { sheetKind: 'trainer', sheetSlug: 'npc-trainer' },
    })).toBe(false)
  })
})
