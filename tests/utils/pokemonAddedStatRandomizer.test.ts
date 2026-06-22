import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import { randomizePokemonAddedStats } from '~/utils/sheets/pokemonAddedStatRandomizer'
import { POKEMON_STAT_KEYS, resolveStats, validateBaseRelations } from '~/utils/sheets/pokemonDerived'
import { computePokemonLevelUpStatPointBudget } from '~/utils/statPointBudgets'

const seededRandom = (seed: number): (() => number) => {
  let current = seed >>> 0
  return () => {
    current = (current * 1664525 + 1013904223) >>> 0
    return current / 0x100000000
  }
}

const makePikachuSheet = (level: number): CharacterSheet => ({
  slug: 'spark',
  nickname: 'Spark',
  species: 'Pikachu',
  level,
  nature: 'Hardy',
  stats: {
    hp: { added: 99, stage: 2 },
    atk: { added: 99, stage: -1 },
    def: { added: 99, stage: 0 },
    satk: { added: 99, stage: 1 },
    sdef: { added: 99, stage: 0 },
    spd: { added: 99, stage: 3 },
  },
})

describe('randomizePokemonAddedStats', () => {
  it('spends the full Pokémon Added Stat Point budget', () => {
    const sheet = makePikachuSheet(20)
    const result = randomizePokemonAddedStats(sheet, { random: seededRandom(12) })
    const expectedBudget = computePokemonLevelUpStatPointBudget(20)

    expect(result.budget).toBe(expectedBudget)
    expect(POKEMON_STAT_KEYS.reduce((sum, key) => sum + result.allocation[key], 0)).toBe(expectedBudget)
    expect(POKEMON_STAT_KEYS.reduce((sum, key) => sum + (sheet.stats?.[key]?.added ?? 0), 0)).toBe(expectedBudget)
  })

  it('preserves combat stages while overwriting only Added Stat Points', () => {
    const sheet = makePikachuSheet(15)

    randomizePokemonAddedStats(sheet, { random: seededRandom(34) })

    expect(sheet.stats?.hp?.stage).toBe(2)
    expect(sheet.stats?.atk?.stage).toBe(-1)
    expect(sheet.stats?.spd?.stage).toBe(3)
  })

  it('keeps randomized allocations valid under Base Relations', () => {
    const sheet = makePikachuSheet(100)

    randomizePokemonAddedStats(sheet, { random: seededRandom(56) })

    expect(validateBaseRelations(resolveStats(sheet))).toEqual([])
  })
})
