import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENCOUNTER_NOTHING_WEIGHT,
  ENCOUNTER_NOTHING_SPECIES,
  formatEncounterChancePercent,
  formatEncounterEntryLevelRange,
  formatEncounterLevelRange,
  normalizeEncounterLevelRange,
  normalizeEncounterTableRollEntries,
  normalizeEncounterTableRollEntriesWithDefaultNothing,
  normalizeEncounterTableRollEntry,
  orderEncounterTableRollEntriesByWeight,
  serializeEncounterTableRollEntry,
  totalEncounterWeight,
} from '#shared/encounterTables'

describe('shared encounter table helpers', () => {
  it('normalizes legacy tuple entries with fallback levels', () => {
    expect(normalizeEncounterTableRollEntry([50, 'Pidgey'], { min_level: 4, max_level: 8 })).toEqual({
      weight: 50,
      species: 'Pidgey',
      min_level: 4,
      max_level: 8,
    })
  })

  it('normalizes object and tuple entries with per-row levels', () => {
    expect(normalizeEncounterTableRollEntry([100, 'Oddish', 3, 7], { min_level: 1, max_level: 5 }, { previousCeiling: 25 })).toEqual({
      weight: 75,
      species: 'Oddish',
      min_level: 3,
      max_level: 7,
    })
    expect(normalizeEncounterTableRollEntry({ weight: 4, species: ' Zubat ', min_level: 8, max_level: 6 }, { min_level: 1, max_level: 5 })).toEqual({
      weight: 4,
      species: 'Zubat',
      min_level: 6,
      max_level: 8,
    })
  })

  it('derives weights from legacy cumulative ceilings across a whole table', () => {
    const entries = normalizeEncounterTableRollEntries([
      [25, 'Pidgey'],
      { ceiling: 100, species: 'Oddish', min_level: 8, max_level: 10 },
    ], { min_level: 2, max_level: 6 })

    expect(entries.map(({ species, weight }) => ({ species, weight }))).toEqual([
      { species: 'Pidgey', weight: 25 },
      { species: 'Oddish', weight: 75 },
    ])
    expect(totalEncounterWeight(entries)).toBe(100)
  })

  it('adds a default Nothing row when table-level entries omit it', () => {
    const entries = normalizeEncounterTableRollEntriesWithDefaultNothing([
      { weight: 40, species: 'Pidgey', min_level: 2, max_level: 4 },
    ], { min_level: 2, max_level: 4 })

    expect(entries.map(({ species, weight }) => ({ species, weight }))).toEqual([
      { species: 'Pidgey', weight: 40 },
      { species: ENCOUNTER_NOTHING_SPECIES, weight: DEFAULT_ENCOUNTER_NOTHING_WEIGHT },
    ])
    expect(formatEncounterEntryLevelRange(entries[1])).toBe('—')
    expect(serializeEncounterTableRollEntry(entries[1])).toEqual({
      weight: DEFAULT_ENCOUNTER_NOTHING_WEIGHT,
      species: ENCOUNTER_NOTHING_SPECIES,
    })
  })

  it('orders normalized entries by descending weight while pinning Nothing last', () => {
    const ordered = orderEncounterTableRollEntriesByWeight([
      { species: ENCOUNTER_NOTHING_SPECIES, weight: 60, min_level: 1, max_level: 1 },
      { species: 'Pidgey', weight: 5, min_level: 1, max_level: 1 },
      { species: 'Oddish', weight: 25, min_level: 1, max_level: 1 },
    ])

    expect(ordered.map(({ species, weight }) => ({ species, weight }))).toEqual([
      { species: 'Oddish', weight: 25 },
      { species: 'Pidgey', weight: 5 },
      { species: ENCOUNTER_NOTHING_SPECIES, weight: 60 },
    ])
  })

  it('serializes weighted entries and formats level ranges/chances', () => {
    expect(normalizeEncounterLevelRange(12, 10)).toEqual({ min_level: 10, max_level: 12 })
    expect(formatEncounterLevelRange({ min_level: 5, max_level: 5 })).toBe('Lv 5')
    expect(formatEncounterLevelRange({ min_level: 5, max_level: 8 })).toBe('Lv 5–8')
    expect(formatEncounterChancePercent(1, 3)).toBe('33.3%')
    expect(serializeEncounterTableRollEntry({ weight: 250, species: 'Pidgey', min_level: 0, max_level: 101 })).toEqual({
      weight: 250,
      species: 'Pidgey',
      min_level: 1,
      max_level: 100,
    })
  })
})
