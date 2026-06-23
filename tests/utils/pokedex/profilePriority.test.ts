import { describe, expect, it } from 'vitest'
import {
  parsePlayerProfileId,
  PLAYER_PROFILE_SCHEMA_VERSION,
  sanitizePlayerProfileDisplayName,
  type PlayerProfile,
} from '#shared/playerProfiles'
import {
  prioritizePokedexEntries,
  profileLinkedPokemonPokedexSlugs,
} from '~/utils/pokedex/profilePriority'
import type { PokedexEntrySummary } from '~/utils/pokedex/entryIndex'

const profile: PlayerProfile = {
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: parsePlayerProfileId('profile_ash00000'),
  displayName: sanitizePlayerProfileDisplayName('Ash'),
  linkedCharacters: [
    { sheetKind: 'trainer', sheetSlug: 'ash' },
  ],
}

const entry = (slug: string): PokedexEntrySummary => ({
  id: slug,
  species: slug,
  slug,
  nationalDexNumber: null,
  types: [],
})

describe('Pokédex profile priority helpers', () => {
  it('resolves Pokédex slugs from Pokémon linked through profile trainer rosters', () => {
    const slugs = profileLinkedPokemonPokedexSlugs({
      profile,
      linkedTrainerSheets: [
        { slug: 'ash', currentTeam: ['sparky', 'missing'], boxedPokemon: ['bulba', 'sparky'] },
        { slug: 'misty', currentTeam: ['staryu'] },
      ],
      pokemonBySlug: new Map([
        ['sparky', { species: 'Pikachu' }],
        ['bulba', { species: 'Bulbasaur' }],
        ['staryu', { species: 'Staryu' }],
      ]),
    })

    expect([...slugs]).toEqual(['pikachu', 'bulbasaur'])
  })

  it('moves profile Pokémon to the top while preserving existing Pokédex order within groups', () => {
    const entries = [
      entry('bulbasaur'),
      entry('charmander'),
      entry('pikachu'),
      entry('squirtle'),
    ]

    expect(prioritizePokedexEntries(entries, new Set(['pikachu', 'bulbasaur'])).map((item) => item.slug)).toEqual([
      'bulbasaur',
      'pikachu',
      'charmander',
      'squirtle',
    ])
  })

  it('keeps the original entry array when no priority slugs match', () => {
    const entries = [entry('bulbasaur'), entry('charmander')]

    expect(prioritizePokedexEntries(entries, new Set(['pikachu']))).toBe(entries)
    expect(prioritizePokedexEntries(entries, new Set())).toBe(entries)
  })
})
