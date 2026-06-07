export const ENCOUNTER_NOTHING_SPECIES = 'Nothing'
export const DEFAULT_ENCOUNTER_NOTHING_WEIGHT = 60

export interface EncounterTableRollEntryObject {
  /** Relative chance weight for this row. Preferred for newly edited tables. */
  weight?: number
  /** Legacy cumulative 1–100 ceiling, still accepted for older tables. */
  ceiling?: number
  species: string
  min_level?: number
  max_level?: number
}

/** Legacy tuple form. The numeric first value is a cumulative 1–100 ceiling. */
export type EncounterTableRollEntryTuple =
  | [number, string]
  | [number, string, number, number]

export type EncounterTableRollEntry = EncounterTableRollEntryTuple | EncounterTableRollEntryObject

export interface EncounterTableLevelRange {
  min_level: number
  max_level: number
}

export interface NormalizedEncounterTableRollEntry extends EncounterTableLevelRange {
  weight: number
  species: string
}

export interface EncounterTableRollEntryNormalizationContext {
  /** Previous cumulative legacy ceiling, used to derive a legacy row's weight. */
  previousCeiling?: number
}

const DEFAULT_LEVEL_RANGE: EncounterTableLevelRange = { min_level: 1, max_level: 1 }

export const isEncounterNothingSpecies = (species: unknown): boolean =>
  String(species ?? '').trim().toLowerCase() === ENCOUNTER_NOTHING_SPECIES.toLowerCase()

const normalizeEncounterSpecies = (species: unknown): string => {
  const normalized = String(species ?? '').trim()
  return isEncounterNothingSpecies(normalized) ? ENCOUNTER_NOTHING_SPECIES : normalized
}

export const defaultNothingEncounterRollEntry = (): EncounterTableRollEntryObject => ({
  weight: DEFAULT_ENCOUNTER_NOTHING_WEIGHT,
  species: ENCOUNTER_NOTHING_SPECIES,
})

const coerceInteger = (value: unknown, fallback: number): number => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? Math.round(numberValue) : fallback
}

export const clampEncounterLevel = (value: unknown, fallback = 1): number =>
  Math.max(1, Math.min(100, coerceInteger(value, fallback)))

export const clampEncounterCeiling = (value: unknown, fallback = 100): number =>
  Math.max(1, Math.min(100, coerceInteger(value, fallback)))

export const clampEncounterWeight = (value: unknown, fallback = 1): number =>
  Math.max(1, coerceInteger(value, fallback))

export const normalizeEncounterLevelRange = (
  minLevel: unknown,
  maxLevel: unknown,
  fallback: EncounterTableLevelRange = DEFAULT_LEVEL_RANGE,
): EncounterTableLevelRange => {
  const min_level = clampEncounterLevel(minLevel, fallback.min_level)
  const max_level = clampEncounterLevel(maxLevel, fallback.max_level)
  return min_level <= max_level
    ? { min_level, max_level }
    : { min_level: max_level, max_level: min_level }
}

const isEncounterRollEntryObject = (
  entry: EncounterTableRollEntry,
): entry is EncounterTableRollEntryObject => !Array.isArray(entry)

const encounterRollEntrySpecies = (entry: EncounterTableRollEntry): unknown =>
  isEncounterRollEntryObject(entry) ? entry.species : entry[1]

export const isEncounterNothingRollEntry = (entry: EncounterTableRollEntry): boolean =>
  isEncounterNothingSpecies(encounterRollEntrySpecies(entry))

export const isNormalizedEncounterNothingEntry = (
  entry: Pick<NormalizedEncounterTableRollEntry, 'species'>,
): boolean => isEncounterNothingSpecies(entry.species)

export const withDefaultNothingEncounterEntry = (
  entries: ReadonlyArray<EncounterTableRollEntry>,
): EncounterTableRollEntry[] => (
  entries.some(isEncounterNothingRollEntry)
    ? [...entries]
    : [...entries, defaultNothingEncounterRollEntry()]
)

const hasOwnDefinedProperty = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined && record[key] !== null

const hasEncounterWeight = (entry: EncounterTableRollEntryObject): boolean =>
  hasOwnDefinedProperty(entry as unknown as Record<string, unknown>, 'weight')

const legacyCeilingForEntry = (entry: EncounterTableRollEntry): number | null => {
  if (isEncounterRollEntryObject(entry)) {
    return hasEncounterWeight(entry) ? null : clampEncounterCeiling(entry.ceiling)
  }
  return clampEncounterCeiling(entry[0])
}

const weightForEntry = (
  entry: EncounterTableRollEntry,
  previousCeiling: number,
): number => {
  if (isEncounterRollEntryObject(entry) && hasEncounterWeight(entry)) {
    return clampEncounterWeight(entry.weight)
  }

  const ceiling = legacyCeilingForEntry(entry) ?? previousCeiling + 1
  return clampEncounterWeight(ceiling - previousCeiling)
}

export const normalizeEncounterTableRollEntry = (
  entry: EncounterTableRollEntry,
  fallback: EncounterTableLevelRange,
  context: EncounterTableRollEntryNormalizationContext = {},
): NormalizedEncounterTableRollEntry => {
  if (isEncounterRollEntryObject(entry)) {
    const levels = normalizeEncounterLevelRange(entry.min_level, entry.max_level, fallback)
    return {
      weight: weightForEntry(entry, context.previousCeiling ?? 0),
      species: normalizeEncounterSpecies(entry.species),
      ...levels,
    }
  }

  const levels = normalizeEncounterLevelRange(entry[2], entry[3], fallback)
  return {
    weight: weightForEntry(entry, context.previousCeiling ?? 0),
    species: normalizeEncounterSpecies(entry[1]),
    ...levels,
  }
}

export const withDefaultNothingNormalizedEncounterEntry = (
  entries: ReadonlyArray<NormalizedEncounterTableRollEntry>,
  fallback: EncounterTableLevelRange = DEFAULT_LEVEL_RANGE,
): NormalizedEncounterTableRollEntry[] => (
  entries.some(isNormalizedEncounterNothingEntry)
    ? [...entries]
    : [...entries, normalizeEncounterTableRollEntry(defaultNothingEncounterRollEntry(), fallback)]
)

export const normalizeEncounterTableRollEntries = (
  entries: ReadonlyArray<EncounterTableRollEntry>,
  fallback: EncounterTableLevelRange,
): NormalizedEncounterTableRollEntry[] => {
  let previousCeiling = 0
  return entries.map((entry) => {
    const normalized = normalizeEncounterTableRollEntry(entry, fallback, { previousCeiling })
    previousCeiling = legacyCeilingForEntry(entry) ?? previousCeiling + normalized.weight
    return normalized
  })
}

export const normalizeEncounterTableRollEntriesWithDefaultNothing = (
  entries: ReadonlyArray<EncounterTableRollEntry>,
  fallback: EncounterTableLevelRange,
): NormalizedEncounterTableRollEntry[] =>
  normalizeEncounterTableRollEntries(withDefaultNothingEncounterEntry(entries), fallback)

export const serializeEncounterTableRollEntry = (
  entry: NormalizedEncounterTableRollEntry,
): EncounterTableRollEntryObject => {
  const species = normalizeEncounterSpecies(entry.species)
  if (isEncounterNothingSpecies(species)) {
    return {
      weight: clampEncounterWeight(entry.weight),
      species: ENCOUNTER_NOTHING_SPECIES,
    }
  }

  return {
    weight: clampEncounterWeight(entry.weight),
    species,
    min_level: clampEncounterLevel(entry.min_level),
    max_level: clampEncounterLevel(entry.max_level),
  }
}

export const totalEncounterWeight = (
  entries: ReadonlyArray<Pick<NormalizedEncounterTableRollEntry, 'weight'>>,
): number => entries.reduce((sum, entry) => sum + clampEncounterWeight(entry.weight), 0)

export const randomEncounterInt = (min: number, max: number, random: () => number = Math.random): number =>
  Math.floor(random() * (max - min + 1)) + min

export interface WeightedEncounterEntrySelection {
  entry: NormalizedEncounterTableRollEntry | null
  roll: number
  totalWeight: number
}

export const selectWeightedEncounterEntry = (
  entries: ReadonlyArray<NormalizedEncounterTableRollEntry>,
  random: () => number = Math.random,
): WeightedEncounterEntrySelection => {
  const totalWeight = totalEncounterWeight(entries)
  if (entries.length === 0 || totalWeight < 1) {
    return { entry: null, roll: 1, totalWeight }
  }

  const roll = randomEncounterInt(1, totalWeight, random)
  let cumulativeWeight = 0
  for (const entry of entries) {
    cumulativeWeight += clampEncounterWeight(entry.weight)
    if (roll <= cumulativeWeight) return { entry, roll, totalWeight }
  }

  return { entry: entries[entries.length - 1] ?? null, roll, totalWeight }
}

export const encounterChancePercent = (weight: number, totalWeight: number): number =>
  totalWeight > 0 ? (weight / totalWeight) * 100 : 0

const trimFixedNumber = (value: string): string =>
  value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')

export const formatEncounterChancePercent = (weight: number, totalWeight: number): string => {
  const percent = encounterChancePercent(weight, totalWeight)
  if (!Number.isFinite(percent)) return '0%'
  if (Number.isInteger(percent)) return `${percent}%`
  return `${trimFixedNumber(percent >= 10 ? percent.toFixed(1) : percent.toFixed(2))}%`
}

export const formatEncounterLevelRange = (range: EncounterTableLevelRange): string =>
  range.min_level === range.max_level
    ? `Lv ${range.min_level}`
    : `Lv ${range.min_level}–${range.max_level}`

export const formatEncounterEntryLevelRange = (
  entry: Pick<NormalizedEncounterTableRollEntry, 'species' | 'min_level' | 'max_level'>,
): string => isNormalizedEncounterNothingEntry(entry) ? '—' : formatEncounterLevelRange(entry)
