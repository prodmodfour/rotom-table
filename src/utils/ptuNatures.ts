import type { StatKey } from '~/types/characterSheet'

/**
 * PTU Pokémon Nature Chart (Core, Pokémon chapter p.198-199 / Useful Charts).
 *
 * A Nature raises one Base Stat and lowers another. HP changes by 1; every
 * other Stat changes by 2, with the adjusted species Base Stat never dropping
 * below 1. Neutral natures list the same stat for both columns and therefore
 * cancel out.
 */
export interface PtuNatureEntry {
  value: number
  name: string
  plus: StatKey
  minus: StatKey
}

export const PTU_NATURES: PtuNatureEntry[] = [
  { value: 1,  name: 'Cuddly',     plus: 'hp',   minus: 'atk' },
  { value: 2,  name: 'Distracted', plus: 'hp',   minus: 'def' },
  { value: 3,  name: 'Proud',      plus: 'hp',   minus: 'satk' },
  { value: 4,  name: 'Decisive',   plus: 'hp',   minus: 'sdef' },
  { value: 5,  name: 'Patient',    plus: 'hp',   minus: 'spd' },
  { value: 6,  name: 'Desperate',  plus: 'atk',  minus: 'hp' },
  { value: 7,  name: 'Lonely',     plus: 'atk',  minus: 'def' },
  { value: 8,  name: 'Adamant',    plus: 'atk',  minus: 'satk' },
  { value: 9,  name: 'Naughty',    plus: 'atk',  minus: 'sdef' },
  { value: 10, name: 'Brave',      plus: 'atk',  minus: 'spd' },
  { value: 11, name: 'Stark',      plus: 'def',  minus: 'hp' },
  { value: 12, name: 'Bold',       plus: 'def',  minus: 'atk' },
  { value: 13, name: 'Impish',     plus: 'def',  minus: 'satk' },
  { value: 14, name: 'Lax',        plus: 'def',  minus: 'sdef' },
  { value: 15, name: 'Relaxed',    plus: 'def',  minus: 'spd' },
  { value: 16, name: 'Curious',    plus: 'satk', minus: 'hp' },
  { value: 17, name: 'Modest',     plus: 'satk', minus: 'atk' },
  { value: 18, name: 'Mild',       plus: 'satk', minus: 'def' },
  { value: 19, name: 'Rash',       plus: 'satk', minus: 'sdef' },
  { value: 20, name: 'Quiet',      plus: 'satk', minus: 'spd' },
  { value: 21, name: 'Dreamy',     plus: 'sdef', minus: 'hp' },
  { value: 22, name: 'Calm',       plus: 'sdef', minus: 'atk' },
  { value: 23, name: 'Gentle',     plus: 'sdef', minus: 'def' },
  { value: 24, name: 'Careful',    plus: 'sdef', minus: 'satk' },
  { value: 25, name: 'Sassy',      plus: 'sdef', minus: 'spd' },
  { value: 26, name: 'Skittish',   plus: 'spd',  minus: 'hp' },
  { value: 27, name: 'Timid',      plus: 'spd',  minus: 'atk' },
  { value: 28, name: 'Hasty',      plus: 'spd',  minus: 'def' },
  { value: 29, name: 'Jolly',      plus: 'spd',  minus: 'satk' },
  { value: 30, name: 'Naive',      plus: 'spd',  minus: 'sdef' },
  { value: 31, name: 'Composed',   plus: 'hp',   minus: 'hp' },
  { value: 32, name: 'Hardy',      plus: 'atk',  minus: 'atk' },
  { value: 33, name: 'Docile',     plus: 'def',  minus: 'def' },
  { value: 34, name: 'Bashful',    plus: 'satk', minus: 'satk' },
  { value: 35, name: 'Quirky',     plus: 'sdef', minus: 'sdef' },
  { value: 36, name: 'Serious',    plus: 'spd',  minus: 'spd' },
]

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
