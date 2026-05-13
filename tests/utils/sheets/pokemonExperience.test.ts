import { describe, expect, it } from 'vitest'
import {
  calculatePokemonExperienceToNextLevel,
  POKEMON_EXPERIENCE_CHART,
} from '~/utils/sheets/pokemonExperience'

describe('pokemon experience helpers', () => {
  it('encodes the PTU Pokémon experience chart in level order', () => {
    expect(POKEMON_EXPERIENCE_CHART).toHaveLength(100)
    expect(POKEMON_EXPERIENCE_CHART[0]).toEqual({ level: 1, expNeeded: 0 })
    expect(POKEMON_EXPERIENCE_CHART[10]).toEqual({ level: 11, expNeeded: 110 })
    expect(POKEMON_EXPERIENCE_CHART[99]).toEqual({ level: 100, expNeeded: 20555 })
  })

  it('calculates remaining XP from total experience using the next chart threshold', () => {
    expect(calculatePokemonExperienceToNextLevel(0)).toBe(10)
    expect(calculatePokemonExperienceToNextLevel(60)).toBe(10)
    expect(calculatePokemonExperienceToNextLevel(110)).toBe(25)
    expect(calculatePokemonExperienceToNextLevel(215)).toBe(5)
    expect(calculatePokemonExperienceToNextLevel(540)).toBe(60)
  })

  it('handles missing or capped experience totals', () => {
    expect(calculatePokemonExperienceToNextLevel(undefined)).toBeUndefined()
    expect(calculatePokemonExperienceToNextLevel(Number.NaN)).toBeUndefined()
    expect(calculatePokemonExperienceToNextLevel(20555)).toBe(0)
    expect(calculatePokemonExperienceToNextLevel(21000)).toBe(0)
  })
})
