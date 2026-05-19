import rulesJson from '~~/data/reference/rules.json'
import type { PtuLevelOffsetFormula, PtuRule, PtuStatPointFormulaKey } from '~/types/ptuReference'

const STAT_POINT_RULE_NAME = 'Stat Point Advancement'

const statPointRule = (rulesJson as Record<string, PtuRule>)[STAT_POINT_RULE_NAME]

interface FormulaFallback {
  offset: number
  min?: number
  minLevel?: number
  maxLevel?: number
}

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const wholeLevel = (level: number | null | undefined): number => {
  const raw = finiteNumber(level) ?? 1
  return Math.floor(raw)
}

const formulaFor = (key: PtuStatPointFormulaKey): PtuLevelOffsetFormula | undefined =>
  statPointRule?.statPointFormulas?.[key]

const computeLevelOffsetBudget = (
  level: number | null | undefined,
  key: PtuStatPointFormulaKey,
  fallback: FormulaFallback,
): number => {
  const formula = formulaFor(key)
  const offset = finiteNumber(formula?.offset) ?? fallback.offset
  const min = finiteNumber(formula?.min) ?? fallback.min ?? 0
  const minLevel = finiteNumber(formula?.minLevel) ?? fallback.minLevel ?? 1
  const maxLevel = finiteNumber(formula?.maxLevel) ?? fallback.maxLevel

  const boundedLevel = maxLevel == null
    ? Math.max(minLevel, wholeLevel(level))
    : Math.min(maxLevel, Math.max(minLevel, wholeLevel(level)))

  return Math.max(min, boundedLevel + offset)
}

/** PTU Pokémon added/level-up Stat Points: Level + 10. */
export const computePokemonLevelUpStatPointBudget = (level: number | null | undefined): number =>
  computeLevelOffsetBudget(level, 'pokemonAdded', { offset: 10, min: 0, minLevel: 1, maxLevel: 100 })

/**
 * PTU Trainer discretionary Stat Points tracked in the Trainer sheet's Lvl-Up
 * column: 10 character-creation points at Level 1, plus 1 more each Level.
 */
export const computeTrainerLevelUpStatPointBudget = (level: number | null | undefined): number =>
  computeLevelOffsetBudget(level, 'trainerLevelUp', { offset: 9, min: 0, minLevel: 1, maxLevel: 50 })

/** PTU Trainer baseline Total Stats from the progression chart: Level + 9. */
export const computeTrainerTotalStatPointBudgetAtLevel = (level: number | null | undefined): number =>
  computeLevelOffsetBudget(level, 'trainerTotalAtLevel', { offset: 9, min: 0, minLevel: 1, maxLevel: 50 })
