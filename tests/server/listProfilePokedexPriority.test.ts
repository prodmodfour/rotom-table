import { describe, expect, it, vi } from 'vitest'
import {
  parsePlayerProfileId,
  PLAYER_PROFILE_SCHEMA_VERSION,
  sanitizePlayerProfileDisplayName,
  type PlayerProfile,
} from '#shared/playerProfiles'
import { listProfilePokedexPriorityUseCase } from '~~/server/useCases/listProfilePokedexPriority'

const profile: PlayerProfile = {
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: parsePlayerProfileId('profile_ash00000'),
  displayName: sanitizePlayerProfileDisplayName('Ash'),
  linkedCharacters: [
    { sheetKind: 'trainer', sheetSlug: 'ash' },
  ],
}

describe('listProfilePokedexPriorityUseCase', () => {
  it('lists Pokédex slugs for Pokémon linked to the selected profile trainers', () => {
    const listSheets = vi.fn(() => ({
      trainerSheets: [
        { slug: 'ash', name: 'Ash', level: 1, currentTeam: ['sparky'], boxedPokemon: ['bulba'] },
        { slug: 'misty', name: 'Misty', level: 1, currentTeam: ['staryu'] },
      ],
      pokemonSheets: [
        { slug: 'sparky', nickname: 'Sparky', species: 'Pikachu', level: 5 },
        { slug: 'bulba', nickname: 'Bulba', species: 'Bulbasaur', level: 5 },
        { slug: 'staryu', nickname: 'Staryu', species: 'Staryu', level: 5 },
      ],
    }))

    expect(listProfilePokedexPriorityUseCase({ role: 'player', profile }, { listSheets })).toEqual({
      slugs: ['pikachu', 'bulbasaur'],
    })
    expect(listSheets).toHaveBeenCalledWith({ role: 'player', playerProfile: profile })
  })
})
