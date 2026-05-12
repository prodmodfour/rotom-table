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
}

export interface EncounterGenerateRequestBody {
  region: string
  table: string
  count: number
  outRoot: string
  preview: boolean
}

export interface EncounterGenerationSelection {
  region: string
  tableKey: string
}

export const DEFAULT_ENCOUNTER_COUNT = 3
export const DEFAULT_ENCOUNTER_OUT_ROOT = 'data/sheets/wild'
export const MIN_ENCOUNTER_COUNT = 1
export const MAX_ENCOUNTER_COUNT = 30

export const clampEncounterGenerateCount = (value: number): number => {
  if (!Number.isFinite(value)) return MIN_ENCOUNTER_COUNT
  return Math.max(MIN_ENCOUNTER_COUNT, Math.min(MAX_ENCOUNTER_COUNT, Math.floor(value)))
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
    count: number
    outRoot: string
    preview: boolean
  },
): EncounterGenerateRequestBody => ({
  region: options.region,
  table: options.tableKey,
  count: clampEncounterGenerateCount(options.count),
  outRoot: options.outRoot,
  preview: options.preview,
})

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
