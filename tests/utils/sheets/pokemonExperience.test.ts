import { describe, expect, it } from 'vitest'
import {
  calculatePokemonExperienceToNextLevel,
  calculatePokemonLevelFromExperience,
  POKEMON_EXPERIENCE_CHART,
} from '~/utils/sheets/pokemonExperience'

describe('pokemon experience helpers', () => {
  it('encodes the PTU Pokémon experience chart in level order', () => {
    expect(POKEMON_EXPERIENCE_CHART).toHaveLength(100)
    expect(POKEMON_EXPERIENCE_CHART[0]).toEqual({ level: 1, expNeeded: 0 })
    expect(POKEMON_EXPERIENCE_CHART[10]).toEqual({ level: 11, expNeeded: 110 })
    expect(POKEMON_EXPERIENCE_CHART[99]).toEqual({ level: 100, expNeeded: 20555 })
  })

  it('calculates Pokémon level from total experience thresholds', () => {
    expect(calculatePokemonLevelFromExperience(undefined)).toBeUndefined()
    expect(calculatePokemonLevelFromExperience(Number.NaN)).toBeUndefined()
    expect(calculatePokemonLevelFromExperience(-5)).toBe(1)
    expect(calculatePokemonLevelFromExperience(0)).toBe(1)
    expect(calculatePokemonLevelFromExperience(9)).toBe(1)
    expect(calculatePokemonLevelFromExperience(10)).toBe(2)
    expect(calculatePokemonLevelFromExperience(60)).toBe(7)
    expect(calculatePokemonLevelFromExperience(215)).toBe(14)
    expect(calculatePokemonLevelFromExperience(20555)).toBe(100)
    expect(calculatePokemonLevelFromExperience(21000)).toBe(100)
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
