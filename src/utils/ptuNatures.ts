import type { StatKey } from '~/types/characterSheet'
import { PTU_NATURE_CHART, type PtuNatureChartEntry } from '#shared/ruleset/natures'

/**
 * PTU Pokémon Nature Chart. The authoritative table lives in
 * `shared/ruleset/natures.ts` so sheet derivation and guided onboarding share
 * one source; this module keeps the sheet-facing helper API.
 */
export interface PtuNatureEntry {
  value: number
  name: string
  plus: StatKey
  minus: StatKey
}

export const PTU_NATURES: PtuNatureEntry[] = PTU_NATURE_CHART.map(
  (nature: PtuNatureChartEntry): PtuNatureEntry => ({
    value: nature.value,
    name: nature.name,
    plus: nature.plus,
    minus: nature.minus,
  }),
)

export const PTU_NATURE_OPTIONS = PTU_NATURES.map((nature) => nature.name)

const STAT_KEYS: readonly StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']
const STAT_NATURE_STEP: Record<StatKey, number> = {
  hp: 1,
  atk: 2,
  def: 2,
  satk: 2,
  sdef: 2,
  spd: 2,
}

const natureByName = new Map(
  PTU_NATURES.map((nature) => [nature.name.toLocaleLowerCase(), nature]),
)

export const isStatKey = (value: unknown): value is StatKey => (
  typeof value === 'string' && STAT_KEYS.includes(value as StatKey)
)

export const resolveNature = (nature: string | null | undefined): PtuNatureEntry | null => {
  const key = nature?.trim().toLocaleLowerCase()
  return key ? natureByName.get(key) ?? null : null
}

export const resolveNatureMod = (
  nature: string | null | undefined,
): { plus: StatKey; minus: StatKey } | null => {
  const entry = resolveNature(nature)
  return entry ? { plus: entry.plus, minus: entry.minus } : null
}

export const rawNatureDeltaForStat = (
  key: StatKey,
  plus: unknown,
  minus: unknown,
): number => {
  const step = STAT_NATURE_STEP[key]
  return (plus === key ? step : 0) - (minus === key ? step : 0)
}

export const adjustedNatureModForStat = (
  speciesValue: number,
  key: StatKey,
  plus: unknown,
  minus: unknown,
): number => {
  if (speciesValue <= 0) return 0
  const rawDelta = rawNatureDeltaForStat(key, plus, minus)
  if (rawDelta === 0) return 0
  const adjustedSpeciesValue = Math.max(1, speciesValue + rawDelta)
  return adjustedSpeciesValue - speciesValue
}
