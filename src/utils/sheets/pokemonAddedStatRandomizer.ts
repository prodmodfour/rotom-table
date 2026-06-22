import type { CharacterSheet, StatKey } from '~/types/characterSheet'
import { computePokemonLevelUpStatPointBudget } from '~/utils/statPointBudgets'
import { POKEMON_STAT_KEYS, resolveStats } from '~/utils/sheets/pokemonDerived'

export type PokemonAddedStatAllocation = Record<StatKey, number>

export interface RandomizePokemonAddedStatsOptions {
  readonly random?: () => number
}

export interface RandomizePokemonAddedStatsResult {
  readonly budget: number
  readonly allocation: PokemonAddedStatAllocation
}

const DEFAULT_RANDOMIZED_STAT_KEY: StatKey = 'hp'

const emptyAllocation = (): PokemonAddedStatAllocation => ({
  hp: 0,
  atk: 0,
  def: 0,
  satk: 0,
  sdef: 0,
  spd: 0,
})

const boundedRandomIndex = (random: () => number, length: number): number => {
  const raw = random()
  const normalized = Number.isFinite(raw) ? raw : 0
  return Math.max(0, Math.min(length - 1, Math.floor(normalized * length)))
}

const wouldPreserveBaseRelations = (
  baseByKey: Readonly<Record<StatKey, number>>,
  allocation: Readonly<PokemonAddedStatAllocation>,
  incrementedKey: StatKey,
): boolean => {
  const totalAfterIncrement = (key: StatKey): number => (
    baseByKey[key] + allocation[key] + (key === incrementedKey ? 1 : 0)
  )

  return POKEMON_STAT_KEYS.every((higherKey) => (
    POKEMON_STAT_KEYS.every((lowerKey) => (
      higherKey === lowerKey ||
      baseByKey[higherKey] <= baseByKey[lowerKey] ||
      totalAfterIncrement(higherKey) > totalAfterIncrement(lowerKey)
    ))
  ))
}

const incrementableStatKeys = (
  baseByKey: Readonly<Record<StatKey, number>>,
  allocation: Readonly<PokemonAddedStatAllocation>,
): StatKey[] => POKEMON_STAT_KEYS.filter((key) => wouldPreserveBaseRelations(baseByKey, allocation, key))

const applyAddedStatAllocation = (
  sheet: CharacterSheet,
  allocation: Readonly<PokemonAddedStatAllocation>,
): void => {
  sheet.stats ??= {}

  for (const key of POKEMON_STAT_KEYS) {
    const row = sheet.stats[key] ?? {}
    row.added = allocation[key]
    sheet.stats[key] = row
  }
}

/**
 * Overwrite a Pokémon sheet's Added Stat Points with a random full-budget
 * allocation. Candidate points are only placed when doing so preserves PTU
 * Base Relations as implemented by the sheet stats validator.
 */
export const randomizePokemonAddedStats = (
  sheet: CharacterSheet,
  options: RandomizePokemonAddedStatsOptions = {},
): RandomizePokemonAddedStatsResult => {
  const random = options.random ?? Math.random
  const budget = computePokemonLevelUpStatPointBudget(sheet.level)
  const allocation = emptyAllocation()
  const baseByKey = Object.fromEntries(
    resolveStats(sheet).map((row) => [row.key, row.base]),
  ) as Record<StatKey, number>

  for (let point = 0; point < budget; point += 1) {
    const candidates = incrementableStatKeys(baseByKey, allocation)
    const selectedKey = candidates.length > 0
      ? candidates[boundedRandomIndex(random, candidates.length)] ?? DEFAULT_RANDOMIZED_STAT_KEY
      : DEFAULT_RANDOMIZED_STAT_KEY
    allocation[selectedKey] += 1
  }

  applyAddedStatAllocation(sheet, allocation)

  return { budget, allocation }
}
