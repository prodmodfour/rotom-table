import { describe, expect, it, vi } from 'vitest'
import { listSheetsUseCase } from '../../server/useCases/listSheets'
import type { StoredSheetDocument } from '../../server/storage/sheetRepository'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'
import type { SheetKind } from '../../shared/sheets'
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

  it('uses SQLite document folders in sheet listings', () => {
    const storedTrainer: StoredSheetDocument<Record<string, unknown>> = {
      kind: 'trainer',
      slug: 'new-trainer-1',
      document: { name: 'New Trainer', level: 1, folder: 'npcs/gym-leaders', player: true },
      revision: 2,
      updatedAt: 20,
    }
    const storedPokemon: StoredSheetDocument<Record<string, unknown>> = {
      kind: 'pokemon',
      slug: 'pika',
      document: { nickname: 'Pika', species: 'Pikachu', level: 5, folder: 'players/Hassan', player: true },
      revision: 3,
      updatedAt: 30,
    }
    const sheetRepository = {
      list: vi.fn((kind?: SheetKind) => (kind === 'trainer' ? [storedTrainer] : [storedPokemon])),
    }

    expect(listSheetsUseCase({ role: 'gm' }, { sheetRepository })).toEqual({
      pokemonSheets: [pokemon({ revision: 3 })],
      trainerSheets: [trainer({ folder: 'npcs/gym-leaders', revision: 2 })],
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

  it('redacts Pokémon GM fields from player sheet listings', () => {
    const listPokemonSheets = vi.fn(() => [pokemon({ gm: { notes: 'secret roster note' } })])
    const listTrainerSheets = vi.fn(() => [])

    expect(listSheetsUseCase({ role: 'player' }, { listPokemonSheets, listTrainerSheets })).toEqual({
      pokemonSheets: [pokemon()],
      trainerSheets: [],
    })
    expect(listSheetsUseCase({ role: 'gm' }, { listPokemonSheets, listTrainerSheets })).toEqual({
      pokemonSheets: [pokemon({ gm: { notes: 'secret roster note' } })],
      trainerSheets: [],
    })
  })

  it('includes sheets linked to the selected player profile for players', () => {
    const listPokemonSheets = vi.fn(() => [
      pokemon({ player: false }),
      pokemon({ slug: 'hidden-mon', player: false }),
      pokemon({ slug: 'team-mon', player: false }),
      pokemon({ slug: 'other-team-mon', player: false }),
    ])
    const listTrainerSheets = vi.fn(() => [
      trainer({ player: false, currentTeam: ['team-mon'] }),
      trainer({ slug: 'hidden-trainer', player: false, currentTeam: ['other-team-mon'] }),
    ])

    expect(listSheetsUseCase({
      role: 'player',
      playerProfile: playerProfile([
        { sheetKind: 'pokemon', sheetSlug: 'hidden-mon' },
        { sheetKind: 'trainer', sheetSlug: 'new-trainer-1' },
      ]),
    }, { listPokemonSheets, listTrainerSheets })).toEqual({
      pokemonSheets: [
        pokemon({ slug: 'hidden-mon', player: false }),
        pokemon({ slug: 'team-mon', player: false }),
      ],
      trainerSheets: [trainer({ player: false, currentTeam: ['team-mon'] })],
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
