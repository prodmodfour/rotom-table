import { describe, expect, it } from 'vitest'
import {
  addPokemonToTrainerTeam,
  boxPokemonForTrainer,
  buildTrainerPokemonBrowserEntries,
  filterTrainerPokemonBrowserEntries,
  isExamplePokemonFolder,
  isTrainerPokemonBrowserCandidate,
  moveTrainerPokemonLink,
  normalizePokemonSlugList,
  resolveTrainerPokemonLinks,
  trainerTeamHasOpenSlot,
  unlinkPokemonFromTrainer,
} from '~/utils/trainerPokemonLinks'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const makePokemon = (
  slug: string,
  nickname: string,
  species: string,
  level: number,
  folder = '',
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({ slug, nickname, species, level, folder, ...overrides })

const spriteFor = (species: string): string => `/sprites/${species}.png`

const pokemon = [
  makePokemon('bolt', 'Bolt', 'Pikachu', 12, 'party'),
  makePokemon('ember', 'Ember', 'Charmander', 8, 'box'),
  makePokemon('moss', 'Moss', 'Bulbasaur', 5),
]

const pokemonBySlug = new Map(pokemon.map((sheet) => [sheet.slug, sheet]))

const makeTrainer = (): TrainerSheet => ({
  slug: 'trainer',
  name: 'Trainer',
  level: 1,
  currentTeam: ['bolt'],
  boxedPokemon: ['ember'],
})

describe('trainerPokemonLinks', () => {
  it('normalizes Pokémon slug lists without blanks or duplicates', () => {
    expect(normalizePokemonSlugList([' bolt ', '', 'bolt', 'ember', null])).toEqual(['bolt', 'ember'])
  })

  it('resolves linked slugs into display rows and keeps missing links visible', () => {
    const rows = resolveTrainerPokemonLinks({
      slugs: ['bolt', 'missing'],
      pokemonBySlug,
      spriteUrlForSpecies: spriteFor,
    })

    expect(rows).toMatchObject([
      {
        slug: 'bolt',
        displayName: 'Bolt',
        species: 'Pikachu',
        level: 12,
        spriteUrl: '/sprites/Pikachu.png',
      },
      {
        slug: 'missing',
        displayName: 'missing',
        species: null,
        level: null,
        spriteUrl: null,
      },
    ])
  })

  it('identifies browser-eligible Pokémon and excludes examples by default', () => {
    const example = makePokemon('example', 'Example', 'Pikachu', 20, 'examples')
    const nestedExample = makePokemon('nested-example', 'Nested Example', 'Pichu', 20, 'examples/generated')
    const player = makePokemon('player', 'Player Mon', 'Eevee', 10, 'players/ash', { player: true })
    const npc = makePokemon('npc', 'NPC Mon', 'Meowth', 10, 'npcs')

    expect(isExamplePokemonFolder('examples')).toBe(true)
    expect(isExamplePokemonFolder('examples/generated')).toBe(true)
    expect(isExamplePokemonFolder('players/examples')).toBe(false)
    expect(isTrainerPokemonBrowserCandidate(example)).toBe(false)
    expect(isTrainerPokemonBrowserCandidate(nestedExample)).toBe(false)
    expect(isTrainerPokemonBrowserCandidate(player, { playerOnly: true })).toBe(true)
    expect(isTrainerPokemonBrowserCandidate(npc, { playerOnly: true })).toBe(false)
  })

  it('builds and filters browser entries with team/box status', () => {
    const entries = buildTrainerPokemonBrowserEntries({
      pokemonSheets: pokemon,
      currentTeam: ['bolt'],
      boxedPokemon: ['ember', 'bolt'],
      spriteUrlForSpecies: spriteFor,
    })

    expect(entries.map((entry) => [entry.slug, entry.linkedAs])).toEqual([
      ['bolt', 'team'],
      ['ember', 'box'],
      ['moss', null],
    ])
    expect(filterTrainerPokemonBrowserEntries(entries, 'lv 8').map((entry) => entry.slug)).toEqual(['ember'])
    expect(filterTrainerPokemonBrowserEntries(entries, 'bulba').map((entry) => entry.slug)).toEqual(['moss'])
  })

  it('filters browser entries for player trainers and hides examples', () => {
    const entries = buildTrainerPokemonBrowserEntries({
      pokemonSheets: [
        makePokemon('player-bolt', 'Player Bolt', 'Pikachu', 12, 'players/ash', { player: true }),
        makePokemon('npc-ember', 'NPC Ember', 'Charmander', 8, 'npcs'),
        makePokemon('example-moss', 'Example Moss', 'Bulbasaur', 20, 'examples', { player: true }),
      ],
      currentTeam: ['player-bolt'],
      boxedPokemon: ['npc-ember'],
      spriteUrlForSpecies: spriteFor,
      playerOnly: true,
    })

    expect(entries.map((entry) => [entry.slug, entry.linkedAs])).toEqual([
      ['player-bolt', 'team'],
    ])
  })

  it('moves Pokémon between team and box while enforcing the team limit', () => {
    const trainer = makeTrainer()

    expect(addPokemonToTrainerTeam(trainer, 'ember')).toBe(true)
    expect(trainer.currentTeam).toEqual(['bolt', 'ember'])
    expect(trainer.boxedPokemon).toEqual([])

    trainer.boxedPokemon = ['bolt']
    expect(addPokemonToTrainerTeam(trainer, 'bolt')).toBe(true)
    expect(trainer.currentTeam).toEqual(['bolt', 'ember'])
    expect(trainer.boxedPokemon).toEqual([])

    trainer.currentTeam = ['a', 'b', 'c', 'd', 'e', 'f']
    trainer.boxedPokemon = ['moss']
    expect(trainerTeamHasOpenSlot(trainer)).toBe(false)
    expect(addPokemonToTrainerTeam(trainer, 'moss')).toBe(false)
    expect(trainer.currentTeam).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(trainer.boxedPokemon).toEqual(['moss'])
  })

  it('boxes and unlinks Pokémon from both rosters', () => {
    const trainer = makeTrainer()

    expect(boxPokemonForTrainer(trainer, 'bolt')).toBe(true)
    expect(trainer.currentTeam).toEqual([])
    expect(trainer.boxedPokemon).toEqual(['ember', 'bolt'])

    expect(unlinkPokemonFromTrainer(trainer, 'ember')).toBe(true)
    expect(trainer.currentTeam).toEqual([])
    expect(trainer.boxedPokemon).toEqual(['bolt'])
  })

  it('moves dragged Pokémon links between rosters and reorders them', () => {
    const trainer = makeTrainer()
    trainer.currentTeam = ['bolt', 'moss']
    trainer.boxedPokemon = ['ember', 'aqua']

    expect(moveTrainerPokemonLink(trainer, 'ember', 'team', 1)).toBe(true)
    expect(trainer.currentTeam).toEqual(['bolt', 'ember', 'moss'])
    expect(trainer.boxedPokemon).toEqual(['aqua'])

    expect(moveTrainerPokemonLink(trainer, 'bolt', 'team', 2)).toBe(true)
    expect(trainer.currentTeam).toEqual(['ember', 'bolt', 'moss'])

    expect(moveTrainerPokemonLink(trainer, 'moss', 'box', 0)).toBe(true)
    expect(trainer.currentTeam).toEqual(['ember', 'bolt'])
    expect(trainer.boxedPokemon).toEqual(['moss', 'aqua'])

    trainer.currentTeam = ['a', 'b', 'c', 'd', 'e', 'f']
    trainer.boxedPokemon = ['ember']
    expect(moveTrainerPokemonLink(trainer, 'ember', 'team')).toBe(false)
    expect(trainer.currentTeam).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(trainer.boxedPokemon).toEqual(['ember'])
  })
})
