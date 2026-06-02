import { describe, expect, it } from 'vitest'
import { buildPlayerTrainerPortal } from '~/utils/playerTrainerPortal'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'pika',
  nickname: 'Pika',
  species: 'Pikachu',
  level: 5,
  ...overrides,
})

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 3,
  ...overrides,
})

describe('player trainer portal model', () => {
  it('shows linked trainers with their team and boxed Pokémon sheets', () => {
    const model = buildPlayerTrainerPortal({
      linkedCharacters: [
        { sheetKind: 'trainer', sheetSlug: 'ash' },
        { sheetKind: 'pokemon', sheetSlug: 'eevee' },
      ],
      trainerSheets: [
        trainer({ currentTeam: ['pika'], boxedPokemon: ['bulba', 'pika'] }),
        trainer({ slug: 'misty', name: 'Misty', currentTeam: ['staryu'] }),
      ],
      pokemonSheets: [
        pokemon(),
        pokemon({ slug: 'bulba', nickname: 'Bulba', species: 'Bulbasaur' }),
        pokemon({ slug: 'eevee', nickname: 'Eevee', species: 'Eevee' }),
        pokemon({ slug: 'staryu', nickname: 'Staryu', species: 'Staryu' }),
      ],
      spriteUrlForSpecies: (species) => `/sprites/${species}.png`,
    })

    expect(model.trainers).toHaveLength(1)
    expect(model.trainers[0]?.slug).toBe('ash')
    expect(model.trainers[0]?.team.map((entry) => entry.slug)).toEqual(['pika'])
    expect(model.trainers[0]?.box.map((entry) => entry.slug)).toEqual(['bulba'])
    expect(model.trainers[0]?.team[0]).toMatchObject({
      displayName: 'Pika',
      species: 'Pikachu',
      path: '/sheets/pika',
      spriteUrl: '/sprites/Pikachu.png',
    })
    expect(model.otherPokemon.map((entry) => entry.slug)).toEqual(['eevee'])
  })

  it('falls back to profile access markers before the full profile has loaded', () => {
    const model = buildPlayerTrainerPortal({
      trainerSheets: [trainer({ playerProfileAccessible: true, currentTeam: ['missing'] })],
      pokemonSheets: [pokemon({ slug: 'eevee', nickname: 'Eevee', species: 'Eevee', playerProfileAccessible: true })],
      spriteUrlForSpecies: () => null,
    })

    expect(model.trainers.map((entry) => entry.slug)).toEqual(['ash'])
    expect(model.trainers[0]?.team[0]).toMatchObject({
      slug: 'missing',
      sheet: null,
      displayName: 'missing',
      path: null,
    })
    expect(model.otherPokemon.map((entry) => entry.slug)).toEqual(['eevee'])
  })
})
