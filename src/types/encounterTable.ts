import type { EncounterTableRollEntry } from '#shared/encounterTables'
export type { EncounterTableRollEntry, NormalizedEncounterTableRollEntry } from '#shared/encounterTables'

/**
 * Shape of an encounter table JSON in ``encounter_tables/<region>/<table>.json``.
 *
 * Mirrors the schema consumed by ``scripts/roll.py`` so the same files can be
 * rolled by either the CLI or the in-browser Generate page.
 */
export interface EncounterTable {
  /** Display name for the table, e.g. ``"Thickerby Vale Forest"``. */
  name: string
  /** Inclusive minimum level for rolled encounters. */
  min_level: number
  /** Inclusive maximum level for rolled encounters. */
  max_level: number
  /**
   * Weighted roll table. Edited entries are objects with a relative ``weight``
   * plus optional per-Pokémon ``min_level`` / ``max_level``.
   * Legacy cumulative ``ceiling`` entries and ``[ceiling, species]`` tuples are
   * still accepted and converted to weights while loading.
   */
  entries: EncounterTableRollEntry[]
}

/** A single rolled encounter (species + level). */
export interface RolledEncounter {
  species: string
  level: number
  /** The weighted roll value that selected this species. */
  roll: number
}

/** A loaded table augmented with its region/key for routing. */
export interface EncounterTableEntry {
  /** Region directory name, e.g. ``"thickerby_vale"``. */
  region: string
  /** Table file stem, e.g. ``"forest"``. */
  key: string
  /** The deserialised JSON contents. */
  table: EncounterTable
}
