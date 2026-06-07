import { randomEncounterInt } from '#shared/encounterTables'
import type { EncounterTableEntry, RolledEncounter } from '~/types/encounterTable'

export interface EncounterGenerateFile {
  name: string
  error?: string
  content?: string
}

export interface EncounterGenerateResult {
  ok: true
  dir: string
  relDir: string
  rolled: RolledEncounter[]
  files: EncounterGenerateFile[]
  failures: number
  preview: boolean
  /** Actual count selected for this generation. Older servers omit this. */
  count?: number
}

export interface EncounterGenerateRequestBody {
  region: string
  table: string
  /** Legacy exact count accepted by the server for older clients. */
  count?: number
  countMin?: number
  countMax?: number
  outRoot: string
  preview: boolean
}

export interface EncounterGenerateCountRange {
  min: number
  max: number
}

export interface EncounterGenerationSelection {
  region: string
  tableKey: string
}

export const DEFAULT_ENCOUNTER_COUNT = 3
export const DEFAULT_ENCOUNTER_OUT_ROOT = 'data/sheets/wild'
export const MIN_ENCOUNTER_COUNT = 1
export const MAX_ENCOUNTER_COUNT = 30
export const DEFAULT_ENCOUNTER_COUNT_RANGE: EncounterGenerateCountRange = {
  min: DEFAULT_ENCOUNTER_COUNT,
  max: DEFAULT_ENCOUNTER_COUNT,
}

export const clampEncounterGenerateCount = (value: unknown): number => {
  const count = Number(value)
  if (!Number.isFinite(count)) return MIN_ENCOUNTER_COUNT
  return Math.max(MIN_ENCOUNTER_COUNT, Math.min(MAX_ENCOUNTER_COUNT, Math.floor(count)))
}

export const exactEncounterGenerateCountRange = (value: unknown): EncounterGenerateCountRange => {
  const count = clampEncounterGenerateCount(value)
  return { min: count, max: count }
}

export const normalizeEncounterGenerateCountRange = (
  minValue: unknown,
  maxValue: unknown,
): EncounterGenerateCountRange => {
  const min = clampEncounterGenerateCount(minValue)
  const max = clampEncounterGenerateCount(maxValue)
  return min <= max ? { min, max } : { min: max, max: min }
}

export const randomEncounterGenerateCount = (
  range: EncounterGenerateCountRange,
  random: () => number = Math.random,
): number => {
  const normalized = normalizeEncounterGenerateCountRange(range.min, range.max)
  if (normalized.min === normalized.max) return normalized.min
  return randomEncounterInt(normalized.min, normalized.max, random)
}

const queryString = (value: unknown, fallback: string): string => String(value ?? fallback)

export const initialEncounterGenerationSelection = (
  query: { region?: unknown; table?: unknown },
  fallbackEntry: EncounterTableEntry | null | undefined,
): EncounterGenerationSelection => ({
  region: queryString(query.region, fallbackEntry?.region ?? ''),
  tableKey: queryString(query.table, fallbackEntry?.key ?? ''),
})

export const coerceTableKeyForRegion = (
  currentKey: string,
  tables: ReadonlyArray<EncounterTableEntry>,
): string => {
  if (tables.some((entry) => entry.key === currentKey)) return currentKey
  return tables[0]?.key ?? ''
}

export const buildEncounterGenerateRequestBody = (
  options: {
    region: string
    tableKey: string
    countMin: number
    countMax: number
    outRoot: string
    preview: boolean
  },
): EncounterGenerateRequestBody => {
  const countRange = normalizeEncounterGenerateCountRange(options.countMin, options.countMax)
  return {
    region: options.region,
    table: options.tableKey,
    countMin: countRange.min,
    countMax: countRange.max,
    outRoot: options.outRoot,
    preview: options.preview,
  }
}

export const toggleOpenGenerateFile = (
  openFiles: ReadonlySet<string>,
  name: string,
): Set<string> => {
  const next = new Set(openFiles)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  return next
}

export const errorMessageForEncounterGenerate = (err: unknown): string => {
  const status = (err as { statusMessage?: string; data?: { statusMessage?: string }; message?: string } | null)?.statusMessage
    ?? (err as { data?: { statusMessage?: string } } | null)?.data?.statusMessage
    ?? (err as { message?: string } | null)?.message
  return status ?? 'Unknown error'
}
