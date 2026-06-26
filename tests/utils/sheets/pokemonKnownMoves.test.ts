import { describe, expect, it } from 'vitest'
import {
  coercePokemonAppliedMoveSource,
  pokemonAppliedMoveSourceLabel,
  pokemonKnownLevelUpMoveFieldValue,
  pokemonKnownMoveFieldValue,
  resolveUnlockedPokemonLevelUpMoves,
} from '~/utils/sheets/pokemonKnownMoves'
import type { PokedexRecord } from '~/types/pokemon'

const species = (levelUpMoves: PokedexRecord['level_up_moves']): Pick<PokedexRecord, 'level_up_moves'> => ({
  level_up_moves: levelUpMoves,
})

describe('pokemon known move helpers', () => {
  it('resolves unique level-up moves unlocked by the current sheet level', () => {
    const unlocked = resolveUnlockedPokemonLevelUpMoves(
      { level: 10 },
      species([
        { level: 1, name: 'Growl', type: 'Normal' },
        { level: 5, name: 'Tackle', type: 'Normal' },
        { level: 10, name: 'Quick Attack', type: 'Normal' },
        { level: 12, name: 'Spark', type: 'Electric' },
        { level: 10, name: 'Tackle', type: 'Normal' },
      ]),
    )

    expect(unlocked.map((move) => move.name)).toEqual(['Growl', 'Tackle', 'Quick Attack'])
  })

  it('looks up reference-backed known move details with level-up type fallback', () => {
    expect(pokemonKnownMoveFieldValue({ name: 'Tackle' }, 'type')).toBe('Normal')
    expect(pokemonKnownMoveFieldValue({ name: 'Unknown Move' }, 'type')).toBe('')
    expect(pokemonKnownLevelUpMoveFieldValue({ name: 'Unknown Move', type: 'Shadow' }, 'type')).toBe('Shadow')
  })

  it('normalizes applied TM and Tutor source labels', () => {
    expect(coercePokemonAppliedMoveSource('Tutor')).toBe('tutor')
    expect(coercePokemonAppliedMoveSource('tutoring')).toBe('tutor')
    expect(coercePokemonAppliedMoveSource('TM/HM')).toBe('tm')
    expect(pokemonAppliedMoveSourceLabel('tutor')).toBe('Tutor')
    expect(pokemonAppliedMoveSourceLabel('tm')).toBe('TM/HM')
  })
})
