import { describe, expect, it } from 'vitest'
import {
  calculatePokemonExperienceToNextLevel,
  calculatePokemonLevelFromExperience,
  POKEMON_EXPERIENCE_CHART,
  pokemonExperienceNeededForLevel,
  resolvePokemonExperienceForLevel,
  resolvePokemonExperienceProgress,
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

  it('looks up the total experience threshold for a level', () => {
    expect(pokemonExperienceNeededForLevel(undefined)).toBeUndefined()
    expect(pokemonExperienceNeededForLevel(0)).toBe(0)
    expect(pokemonExperienceNeededForLevel(7)).toBe(60)
    expect(pokemonExperienceNeededForLevel(100)).toBe(20555)
    expect(pokemonExperienceNeededForLevel(999)).toBe(20555)
  })

  it('resolves the normalized level and matching total experience threshold', () => {
    expect(resolvePokemonExperienceForLevel(undefined)).toBeUndefined()
    expect(resolvePokemonExperienceForLevel(7)).toEqual({ level: 7, totalExp: 60 })
    expect(resolvePokemonExperienceForLevel(7.9)).toEqual({ level: 7, totalExp: 60 })
    expect(resolvePokemonExperienceForLevel(999)).toEqual({ level: 100, totalExp: 20555 })
  })

  it('resolves current-level XP progress toward the next level', () => {
    expect(resolvePokemonExperienceProgress(1, 0)).toMatchObject({
      level: 1,
      nextLevel: 2,
      totalExp: 0,
      currentLevelExp: 0,
      currentExp: 0,
      neededExp: 10,
      remainingExp: 10,
      percent: 0,
      hasTrackedTotalExp: true,
      isMaxLevel: false,
    })

    expect(resolvePokemonExperienceProgress(14, 215)).toMatchObject({
      level: 14,
      nextLevel: 15,
      totalExp: 215,
      currentLevelExp: 190,
      currentExp: 25,
      neededExp: 30,
      remainingExp: 5,
      hasTrackedTotalExp: true,
    })
  })

  it('treats a manually set current level as zero XP into that level', () => {
    expect(resolvePokemonExperienceProgress(7, undefined)).toMatchObject({
      level: 7,
      nextLevel: 8,
      totalExp: 60,
      currentLevelExp: 60,
      currentExp: 0,
      neededExp: 10,
      remainingExp: 10,
      percent: 0,
      hasTrackedTotalExp: false,
    })
  })

  it('marks level 100 experience progress as capped', () => {
    expect(resolvePokemonExperienceProgress(100, 20555)).toMatchObject({
      level: 100,
      nextLevel: null,
      currentExp: 0,
      neededExp: 0,
      remainingExp: 0,
      percent: 100,
      isMaxLevel: true,
    })
  })
})
