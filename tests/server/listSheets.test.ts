import { describe, expect, it, vi } from 'vitest'
import { listSheetsUseCase } from '../../server/useCases/listSheets'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TrainerSheet } from '../../src/types/trainerSheet'

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'pika',
  nickname: 'Pika',
  species: 'Pikachu',
  level: 5,
  folder: 'players/Hassan',
  player: true,
  ...overrides,
})

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'new-trainer-1',
  name: 'New Trainer',
  level: 1,
  folder: 'players/Hassan',
  player: true,
  ...overrides,
})

describe('list sheets use case', () => {
  it('lists all persisted sheets for GMs', () => {
    const listPokemonSheets = vi.fn(() => [pokemon(), pokemon({ slug: 'hidden-mon', player: false })])
    const listTrainerSheets = vi.fn(() => [trainer({ player: false })])

    expect(listSheetsUseCase({ role: 'gm' }, { listPokemonSheets, listTrainerSheets })).toEqual({
      pokemonSheets: [pokemon(), pokemon({ slug: 'hidden-mon', player: false })],
      trainerSheets: [trainer({ player: false })],
    })
  })

  it('filters persisted sheets to player-accessible entries for players', () => {
    const listPokemonSheets = vi.fn(() => [pokemon(), pokemon({ slug: 'hidden-mon', player: false })])
    const listTrainerSheets = vi.fn(() => [trainer(), trainer({ slug: 'hidden-trainer', player: false })])

    expect(listSheetsUseCase({ role: 'player' }, { listPokemonSheets, listTrainerSheets })).toEqual({
      pokemonSheets: [pokemon()],
      trainerSheets: [trainer()],
    })
  })

  it('includes live-session granted sheets for players', () => {
    const listPokemonSheets = vi.fn(() => [pokemon({ player: false }), pokemon({ slug: 'hidden-mon', player: false })])
    const listTrainerSheets = vi.fn(() => [trainer({ player: false })])

    expect(listSheetsUseCase({
      role: 'player',
      canAccessPlayerSheet: (kind, slug) => kind === 'pokemon' && slug === 'pika',
    }, { listPokemonSheets, listTrainerSheets })).toEqual({
      pokemonSheets: [pokemon({ player: false })],
      trainerSheets: [],
    })
  })
})
