export interface EncounterTableRollEntryObject {
  ceiling: number
  species: string
  min_level?: number
  max_level?: number
}

export type EncounterTableRollEntryTuple =
  | [number, string]
  | [number, string, number, number]

export type EncounterTableRollEntry = EncounterTableRollEntryTuple | EncounterTableRollEntryObject

export interface EncounterTableLevelRange {
  min_level: number
  max_level: number
}

export interface NormalizedEncounterTableRollEntry extends EncounterTableLevelRange {
  ceiling: number
  species: string
}

const DEFAULT_LEVEL_RANGE: EncounterTableLevelRange = { min_level: 1, max_level: 1 }

const coerceInteger = (value: unknown, fallback: number): number => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? Math.round(numberValue) : fallback
}

export const clampEncounterLevel = (value: unknown, fallback = 1): number =>
  Math.max(1, Math.min(100, coerceInteger(value, fallback)))

export const clampEncounterCeiling = (value: unknown, fallback = 100): number =>
  Math.max(1, Math.min(100, coerceInteger(value, fallback)))

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

export const normalizeEncounterTableRollEntry = (
  entry: EncounterTableRollEntry,
  fallback: EncounterTableLevelRange,
): NormalizedEncounterTableRollEntry => {
  if (isEncounterRollEntryObject(entry)) {
    const levels = normalizeEncounterLevelRange(entry.min_level, entry.max_level, fallback)
    return {
      ceiling: clampEncounterCeiling(entry.ceiling),
      species: String(entry.species ?? '').trim(),
      ...levels,
    }
  }

  const levels = normalizeEncounterLevelRange(entry[2], entry[3], fallback)
  return {
    ceiling: clampEncounterCeiling(entry[0]),
    species: String(entry[1] ?? '').trim(),
    ...levels,
  }
}

export const serializeEncounterTableRollEntry = (
  entry: NormalizedEncounterTableRollEntry,
): EncounterTableRollEntryObject => ({
  ceiling: clampEncounterCeiling(entry.ceiling),
  species: String(entry.species ?? '').trim(),
  min_level: clampEncounterLevel(entry.min_level),
  max_level: clampEncounterLevel(entry.max_level),
})

export const formatEncounterLevelRange = (range: EncounterTableLevelRange): string =>
  range.min_level === range.max_level
    ? `Lv ${range.min_level}`
    : `Lv ${range.min_level}–${range.max_level}`
