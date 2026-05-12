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
   * Cumulative roll table. Each entry is ``[ceiling, species]`` where
   * ``ceiling`` is the upper bound of a 1–100 roll that selects this species.
   * Entries should be sorted ascending and the last ceiling should be 100.
   */
  entries: Array<[number, string]>
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
