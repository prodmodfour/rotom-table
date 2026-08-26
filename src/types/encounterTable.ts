import type { EncounterTableRollEntry } from '#shared/encounterTables'
export type { EncounterTableRollEntry, NormalizedEncounterTableRollEntry } from '#shared/encounterTables'

/**
 * Compatibility shape used while the native GM table document is resolved
 * into the established deterministic generation engine. Campaign authority is
 * loaded from SQLite; documentary encounter-table files are never read or
 * bundled at runtime.
 */
export interface EncounterTable {
  name: string
  min_level: number
  max_level: number
  entries: EncounterTableRollEntry[]
}
