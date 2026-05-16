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
   * Cumulative roll table. Legacy entries are ``[ceiling, species]`` tuples.
   * Edited entries may be objects with per-Pokémon ``min_level`` / ``max_level``.
   * ``ceiling`` is the upper bound of a 1–100 roll that selects this species.
   * Entries should be sorted ascending and the last ceiling should be 100.
   */
  entries: EncounterTableRollEntry[]
}

/** A single rolled encounter (species + level). */
export interface RolledEncounter {
  species: string
  level: number
  /** The 1–100 roll that selected this species. */
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
