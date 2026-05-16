import { describe, expect, it } from 'vitest'
import {
  countEncounterRegionTables,
  encounterRegionsForEntries,
  encounterTableEntryId,
  describeEntries,
  filterEncounterTablesByRegion,
  findEncounterTableInEntries,
  firstEncounterTable,
  formatRegionLabel,
  normalizeEncounterSearch,
} from '~/utils/encounterTables'
import type { EncounterTableEntry } from '~/types/encounterTable'

const entries: EncounterTableEntry[] = [
  {
    region: 'thickerby_vale',
    key: 'forest_path',
    table: { name: 'Forest Path', min_level: 5, max_level: 10, entries: [[50, 'Pikachu'], [100, 'Oddish']] },
  },
  {
    region: 'thickerby_vale',
    key: 'river',
    table: { name: 'River', min_level: 4, max_level: 8, entries: [[100, 'Magikarp']] },
  },
  {
    region: 'iron_islands',
    key: 'cave',
    table: { name: 'Dark Cave', min_level: 12, max_level: 16, entries: [[100, 'Zubat']] },
  },
]

const regions = ['iron_islands', 'thickerby_vale']

describe('encounter table browser helpers', () => {
  it('normalizes search text and selects entries', () => {
    expect(normalizeEncounterSearch('  Forest Path  ')).toBe('forest path')
    expect(formatRegionLabel('')).toBe('Home')
    expect(formatRegionLabel('iron_islands/deep-cave')).toBe('Iron Islands Deep Cave')
    expect(encounterRegionsForEntries(entries)).toEqual(['iron_islands', 'thickerby_vale'])
    expect(encounterTableEntryId(entries[0])).toBe('thickerby_vale/forest_path')
    expect(firstEncounterTable(entries)).toBe(entries[0])
    expect(firstEncounterTable([])).toBeNull()
    expect(findEncounterTableInEntries(entries, 'thickerby_vale', 'river')).toBe(entries[1])
    expect(findEncounterTableInEntries(entries, null, 'river')).toBeNull()
    expect(findEncounterTableInEntries(entries, 'missing', 'river')).toBeNull()
  })

  it('describes entries with per-row level ranges', () => {
    expect(describeEntries({
      name: 'Mixed',
      min_level: 2,
      max_level: 6,
      entries: [
        [25, 'Pidgey'],
        { ceiling: 100, species: 'Oddish', min_level: 8, max_level: 10 },
      ],
    })).toEqual([
      { range: '01–25', percent: 25, species: 'Pidgey', minLevel: 2, maxLevel: 6, levelRange: 'Lv 2–6' },
      { range: '26–100', percent: 75, species: 'Oddish', minLevel: 8, maxLevel: 10, levelRange: 'Lv 8–10' },
    ])
  })

  it('groups all entries by region when no query is provided', () => {
    const groups = filterEncounterTablesByRegion({ entries, regions, query: '' })
    expect(groups.map((group) => [group.region, group.tables.map((entry) => entry.key)])).toEqual([
      ['iron_islands', ['cave']],
      ['thickerby_vale', ['forest_path', 'river']],
    ])
    expect(countEncounterRegionTables(groups)).toBe(3)
  })

  it('matches formatted region labels, table names, keys, and species', () => {
    expect(filterEncounterTablesByRegion({ entries, regions, query: 'Iron Islands' }).map((group) => group.region)).toEqual(['iron_islands'])
    expect(filterEncounterTablesByRegion({ entries, regions, query: 'forest' })[0].tables.map((entry) => entry.key)).toEqual(['forest_path'])
    expect(filterEncounterTablesByRegion({ entries, regions, query: 'river' })[0].tables.map((entry) => entry.key)).toEqual(['river'])
    expect(filterEncounterTablesByRegion({ entries, regions, query: 'zubat' })[0].tables.map((entry) => entry.key)).toEqual(['cave'])
    expect(filterEncounterTablesByRegion({ entries, regions, query: 'missing' })).toEqual([])
  })
})
