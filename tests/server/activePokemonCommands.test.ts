import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import {
  ACTIVE_POKEMON_COMMAND_TAG,
  activelyCommandingTrainerPlacementId,
  recordActivelyCommandedPokemon,
} from '~~/server/domain/moveAutomation/activePokemonCommands'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'active-command-test',
  name: 'Active command test',
  revision: 1,
  dimensions: { x: 10, y: 4, z: 10 },
  groundLevelY: 0,
  voxels: [],
  hazards: [],
  placements: [
    {
      id: 'trainer', sheetKind: 'trainer', sheetSlug: 'trainer', sideId: 'heroes',
      position: { x: 1, y: 0, z: 1 }, initiative: 10,
    },
    {
      id: 'pokemon-a', sheetKind: 'pokemon', sheetSlug: 'pokemon-a', sideId: 'heroes',
      position: { x: 2, y: 0, z: 1 }, initiative: 20,
    },
    {
      id: 'pokemon-b', sheetKind: 'pokemon', sheetSlug: 'pokemon-b', sideId: 'heroes',
      position: { x: 3, y: 0, z: 1 }, initiative: 15,
    },
  ],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  initiative: { activeId: 'pokemon-a', round: 2 },
  activeScene: { name: 'Scene', startedAt: 1 },
  encounterState: {
    ...createEmptyEncounterState(),
    history: {
      ...createEmptyEncounterState().history,
      currentRound: 2,
      currentTurn: { round: 2, turn: 1, placementId: 'pokemon-a' },
      actedThisRoundPlacementIds: ['pokemon-a'],
      actedThisTurnPlacementIds: ['pokemon-a'],
    },
  },
})

describe('active Pokémon command state', () => {
  it('never infers active command from placement, initiative, side, or acting history', () => {
    const map = mapFixture()
    expect(activelyCommandingTrainerPlacementId({
      map, pokemonPlacementId: 'pokemon-a',
    })).toBeNull()
  })

  it('records one exact server-owned trainer slot and deterministically replaces it', () => {
    const first = recordActivelyCommandedPokemon({
      map: mapFixture(),
      trainerPlacementId: 'trainer',
      pokemonPlacementId: 'pokemon-a',
      operationId: 'test.command.first',
    })
    expect(activelyCommandingTrainerPlacementId({
      map: first, pokemonPlacementId: 'pokemon-a',
    })).toBe('trainer')

    const second = recordActivelyCommandedPokemon({
      map: first,
      trainerPlacementId: 'trainer',
      pokemonPlacementId: 'pokemon-b',
      operationId: 'test.command.second',
    })
    expect(activelyCommandingTrainerPlacementId({
      map: second, pokemonPlacementId: 'pokemon-a',
    })).toBeNull()
    expect(activelyCommandingTrainerPlacementId({
      map: second, pokemonPlacementId: 'pokemon-b',
    })).toBe('trainer')
    expect(second.encounterState?.effects.filter(effect => (
      effect.tags.includes(ACTIVE_POKEMON_COMMAND_TAG)
    ))).toHaveLength(1)
  })
})
