import { describe, expect, it } from 'vitest'
import {
  formatEncounterLevelRange,
  normalizeEncounterLevelRange,
  normalizeEncounterTableRollEntry,
  serializeEncounterTableRollEntry,
} from '#shared/encounterTables'

describe('shared encounter table helpers', () => {
  it('normalizes legacy tuple entries with fallback levels', () => {
    expect(normalizeEncounterTableRollEntry([50, 'Pidgey'], { min_level: 4, max_level: 8 })).toEqual({
      ceiling: 50,
      species: 'Pidgey',
      min_level: 4,
      max_level: 8,
    })
  })

  it('normalizes object and tuple entries with per-row levels', () => {
    expect(normalizeEncounterTableRollEntry([100, 'Oddish', 3, 7], { min_level: 1, max_level: 5 })).toEqual({
      ceiling: 100,
      species: 'Oddish',
      min_level: 3,
      max_level: 7,
    })
    expect(normalizeEncounterTableRollEntry({ ceiling: 25, species: ' Zubat ', min_level: 8, max_level: 6 }, { min_level: 1, max_level: 5 })).toEqual({
      ceiling: 25,
      species: 'Zubat',
      min_level: 6,
      max_level: 8,
    })
  })

  it('serializes entries and formats level ranges', () => {
    expect(normalizeEncounterLevelRange(12, 10)).toEqual({ min_level: 10, max_level: 12 })
    expect(formatEncounterLevelRange({ min_level: 5, max_level: 5 })).toBe('Lv 5')
    expect(formatEncounterLevelRange({ min_level: 5, max_level: 8 })).toBe('Lv 5–8')
    expect(serializeEncounterTableRollEntry({ ceiling: 250, species: 'Pidgey', min_level: 0, max_level: 101 })).toEqual({
      ceiling: 100,
      species: 'Pidgey',
      min_level: 1,
      max_level: 100,
    })
  })
})
