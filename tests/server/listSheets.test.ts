import { describe, expect, it, vi } from 'vitest'
import { listSheetsUseCase } from '../../server/useCases/listSheets'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'
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

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_ash00000' as PlayerProfileId,
  displayName: 'Ash' as PlayerProfileDisplayName,
  linkedCharacters,
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

  it('includes sheets linked to the selected player profile for players', () => {
    const listPokemonSheets = vi.fn(() => [pokemon({ player: false }), pokemon({ slug: 'hidden-mon', player: false })])
    const listTrainerSheets = vi.fn(() => [trainer({ player: false }), trainer({ slug: 'hidden-trainer', player: false })])

    expect(listSheetsUseCase({
      role: 'player',
      playerProfile: playerProfile([
        { sheetKind: 'pokemon', sheetSlug: 'hidden-mon' },
        { sheetKind: 'trainer', sheetSlug: 'new-trainer-1' },
      ]),
    }, { listPokemonSheets, listTrainerSheets })).toEqual({
      pokemonSheets: [pokemon({ slug: 'hidden-mon', player: false })],
      trainerSheets: [trainer({ player: false })],
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
