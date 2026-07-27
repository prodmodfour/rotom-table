import { createHash } from 'node:crypto'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { TabletopMap } from '~/types/map'

export const ACTIVE_POKEMON_COMMAND_TAG = 'encounter-active-pokemon-command' as const

const commandEffectId = (trainerPlacementId: string): string => (
  `encounter.active-command.${createHash('sha256')
    .update(trainerPlacementId, 'utf8').digest('hex').slice(0, 24)}`
)

const sourceOperationId = (operationId: string): string => (
  `command.${createHash('sha256').update(operationId, 'utf8').digest('hex').slice(0, 24)}`
)

const activeEffect = (
  state: EncounterState,
  pokemonPlacementId: string,
) => state.effects.find(effect => (
  effect.kind === 'capability'
  && effect.tags.includes(ACTIVE_POKEMON_COMMAND_TAG)
  && effect.affected.placementIds.length === 1
  && effect.affected.placementIds[0] === pokemonPlacementId
  && effect.source.placementId !== null
  && effect.suppression.sources.length === 0
  && (effect.duration.remaining === null || effect.duration.remaining > 0)
)) ?? null

/**
 * Return the exact trainer placement that currently Commands this Pokémon.
 * Presence, initiative, having acted, team membership, and wielding are never
 * accepted as substitutes for this explicit server-owned battle-state marker.
 */
export const activelyCommandingTrainerPlacementId = (input: {
  readonly map: Pick<TabletopMap, 'placements' | 'encounterState'>
  readonly pokemonPlacementId: string
}): string | null => {
  const pokemon = input.map.placements.find(placement => (
    placement.id === input.pokemonPlacementId && placement.sheetKind === 'pokemon'
  ))
  if (!pokemon) return null
  const state = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const effect = activeEffect(state, input.pokemonPlacementId)
  const trainerId = effect?.source.placementId ?? null
  return trainerId && input.map.placements.some(placement => (
    placement.id === trainerId && placement.sheetKind === 'trainer'
  )) ? trainerId : null
}

/**
 * Select one explicitly Commanded Pokémon for a trainer. Ordinary send-out is
 * authoritative evidence for that selection; a later selection replaces the
 * trainer's prior slot. Merely spawning or taking a turn does not create it.
 */
export const recordActivelyCommandedPokemon = (input: {
  readonly map: TabletopMap
  readonly trainerPlacementId: string
  readonly pokemonPlacementId: string
  readonly operationId: string
}): TabletopMap => {
  const trainer = input.map.placements.find(placement => (
    placement.id === input.trainerPlacementId && placement.sheetKind === 'trainer'
  ))
  const pokemon = input.map.placements.find(placement => (
    placement.id === input.pokemonPlacementId && placement.sheetKind === 'pokemon'
  ))
  if (!trainer || !pokemon || trainer.id === pokemon.id) {
    throw new Error('An active Pokémon command requires one present trainer and one present Pokémon placement.')
  }
  const state = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const currentRound = state.history.currentTurn?.round ?? state.history.currentRound ?? input.map.initiative?.round ?? 1
  const currentTurn = state.history.currentTurn?.turn ?? 0
  const effect = parseEncounterEffect({
    id: commandEffectId(trainer.id),
    kind: 'capability',
    source: {
      operationId: sourceOperationId(input.operationId),
      moveId: 'encounter.command-pokemon',
      placementId: trainer.id,
    },
    affected: {
      placementIds: [pokemon.id],
      sideIds: [],
      cells: [{ ...pokemon.position }],
    },
    createdRound: Math.max(1, currentRound),
    createdTurn: Math.max(0, currentTurn),
    duration: { kind: 'scene', remaining: null },
    stacks: 1,
    charges: null,
    stackPolicy: { kind: 'replace', maxStacks: null },
    chargePolicy: { kind: 'none', amount: null },
    tags: [ACTIVE_POKEMON_COMMAND_TAG],
    payload: { capabilityId: 'encounter.pokemon.actively-commanded', action: 'grant' },
    dispel: { policy: 'matching-tags', tags: [ACTIVE_POKEMON_COMMAND_TAG] },
    transferPolicy: 'expire',
    suppression: { sources: [] },
  }, 'activePokemonCommand.effect')
  return {
    ...input.map,
    encounterState: parseEncounterState({
      ...state,
      effects: [
        ...state.effects.filter(candidate => !(
          candidate.tags.includes(ACTIVE_POKEMON_COMMAND_TAG)
          && (candidate.source.placementId === trainer.id
            || candidate.affected.placementIds.includes(pokemon.id))
        )),
        effect,
      ],
    }),
  }
}
