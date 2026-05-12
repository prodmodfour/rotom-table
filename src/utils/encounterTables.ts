/**
 * Browser-side helpers for the encounter-table system.
 *
 * Tables live as JSON in ``encounter_tables/<region>/<table>.json`` and are
 * picked up at build time via ``import.meta.glob``. The shape mirrors what
 * ``scripts/roll.py`` consumes so the CLI and the web UI agree on the data.
 */
import type {
  EncounterTable,
  EncounterTableEntry,
  RolledEncounter,
} from '~/types/encounterTable'

// Vite glob: keys look like ``"../../encounter_tables/thickerby_vale/forest.json"``.
const tableModules = import.meta.glob<{ default: EncounterTable }>(
  '../../encounter_tables/**/*.json',
  { eager: true },
)

const PREFIX = '../../encounter_tables/'

/** Parse a glob key into its region directory and table stem. */
const parseKey = (key: string): { region: string; key: string } | null => {
  if (!key.startsWith(PREFIX)) return null
  const rest = key.slice(PREFIX.length).replace(/\.json$/i, '')
  const slash = rest.indexOf('/')
  if (slash === -1) return null
  return {
    region: rest.slice(0, slash),
    key:    rest.slice(slash + 1),
  }
}

export const encounterTables: EncounterTableEntry[] = Object.entries(tableModules)
  .map(([key, mod]) => {
    const parsed = parseKey(key)
    if (!parsed) return null
    return { ...parsed, table: mod.default }
  })
  .filter((entry): entry is EncounterTableEntry => Boolean(entry))
  .sort((a, b) => {
    const regionCmp = a.region.localeCompare(b.region)
    if (regionCmp !== 0) return regionCmp
    return a.key.localeCompare(b.key)
  })

/** Sorted list of unique region directory names. */
export const encounterRegions: string[] = Array.from(
  new Set(encounterTables.map((entry) => entry.region)),
).sort()

/** ``"thickerby_vale"`` → ``"Thickerby Vale"`` for display. */
export const formatRegionLabel = (region: string): string =>
  region
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')

/** ``"forest"`` → ``"Forest"``. */
export const formatTableLabel = (key: string): string =>
  key
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')

/** Lookup an entry by region + table stem. */
export const findEncounterTable = (
  region: string,
  key: string,
): EncounterTableEntry | null =>
  encounterTables.find((entry) => entry.region === region && entry.key === key) ?? null

/** All tables in a single region, sorted by key. */
export const tablesInRegion = (region: string): EncounterTableEntry[] =>
  encounterTables.filter((entry) => entry.region === region)

/* ------------------------------------------------------------------ */
/* Rolling                                                            */
/* ------------------------------------------------------------------ */

const randInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min

/**
 * Roll once on an encounter table. Returns the rolled species + level along
 * with the underlying 1–100 roll so the UI can show "you rolled a 73".
 */
export const rollEncounter = (table: EncounterTable): RolledEncounter => {
  const r = randInt(1, 100)
  const level = randInt(table.min_level, table.max_level)
  for (const [ceiling, species] of table.entries) {
    if (r <= ceiling) {
      return { species, level, roll: r }
    }
  }
  // Fallback if entries don't actually cover up to 100. Should not happen
  // for well-formed tables, but guard anyway.
  const last = table.entries[table.entries.length - 1]
  return { species: last?.[1] ?? 'Magikarp', level, roll: r }
}

/** Convenience: roll N times. */
export const rollEncounters = (
  table: EncounterTable,
  count: number,
): RolledEncounter[] => Array.from({ length: count }, () => rollEncounter(table))

/* ------------------------------------------------------------------ */
/* Display helpers                                                    */
/* ------------------------------------------------------------------ */

/** Compute the displayed range/percentage for each entry, e.g. "01-25 (25%)". */
export interface DisplayedEncounterRow {
  range: string
  percent: number
  species: string
}

export const describeEntries = (
  table: EncounterTable,
): DisplayedEncounterRow[] => {
  const rows: DisplayedEncounterRow[] = []
  let prev = 0
  for (const [ceiling, species] of table.entries) {
    const lo = prev + 1
    const range = lo === ceiling ? `${pad(ceiling)}` : `${pad(lo)}–${pad(ceiling)}`
    rows.push({ range, percent: ceiling - prev, species })
    prev = ceiling
  }
  return rows
}

const pad = (n: number): string => String(n).padStart(2, '0')

/* ------------------------------------------------------------------ */
/* Browser filtering/selection helpers                                */
/* ------------------------------------------------------------------ */

export interface EncounterRegionGroup {
  region: string
  tables: EncounterTableEntry[]
}

export const normalizeEncounterSearch = (value: string): string => value.trim().toLowerCase()

export const findEncounterTableInEntries = (
  entries: ReadonlyArray<EncounterTableEntry>,
  region: string | null | undefined,
  key: string | null | undefined,
): EncounterTableEntry | null => {
  if (!region || !key) return null
  return entries.find((entry) => entry.region === region && entry.key === key) ?? null
}

export const firstEncounterTable = (
  entries: ReadonlyArray<EncounterTableEntry>,
): EncounterTableEntry | null => entries[0] ?? null

export const filterEncounterTablesByRegion = (
  options: {
    entries: ReadonlyArray<EncounterTableEntry>
    regions: ReadonlyArray<string>
    query: string
  },
): EncounterRegionGroup[] => {
  const query = normalizeEncounterSearch(options.query)
  return options.regions
    .map((region) => {
      const allTables = options.entries.filter((entry) => entry.region === region)
      const regionMatches = !query
        || normalizeEncounterSearch(region).includes(query)
        || normalizeEncounterSearch(formatRegionLabel(region)).includes(query)
      const visibleTables = regionMatches
        ? allTables
        : allTables.filter((entry) => {
            const haystacks = [
              entry.key,
              entry.table.name,
              ...entry.table.entries.map(([, species]) => species),
            ]
            return haystacks.some((value) => normalizeEncounterSearch(value).includes(query))
          })
      return { region, tables: visibleTables }
    })
    .filter(({ tables }) => tables.length > 0)
}

export const countEncounterRegionTables = (
  groups: ReadonlyArray<EncounterRegionGroup>,
): number => groups.reduce((sum, group) => sum + group.tables.length, 0)
