import { describe, expect, it } from 'vitest'
import { useEncounterTableBrowser } from '~/composables/encounters/useEncounterTableBrowser'
import type { EncounterTableEntry } from '~/types/encounterTable'

const entries: EncounterTableEntry[] = [
  {
    region: 'alpha_region',
    key: 'forest',
    table: { name: 'Alpha Forest', min_level: 2, max_level: 5, entries: [[50, 'Pikachu'], [100, 'Oddish']] },
  },
  {
    region: 'alpha_region',
    key: 'cave',
    table: { name: 'Alpha Cave', min_level: 4, max_level: 8, entries: [[100, 'Zubat']] },
  },
  {
    region: 'beta_region',
    key: 'lake',
    table: { name: 'Beta Lake', min_level: 6, max_level: 10, entries: [[100, 'Magikarp']] },
  },
]

const regions = ['alpha_region', 'beta_region']

describe('useEncounterTableBrowser', () => {
  it('initializes selection and displayed rows from the first table', () => {
    const browser = useEncounterTableBrowser({ entries, regions })

    expect(browser.totalCount).toBe(3)
    expect(browser.filteredCount.value).toBe(3)
    expect(browser.selectedRegion.value).toBe('alpha_region')
    expect(browser.selectedKey.value).toBe('forest')
    expect(browser.selectedEntry.value?.table.name).toBe('Alpha Forest')
    expect(browser.selectedRows.value.map((row) => row.species)).toEqual(['Pikachu', 'Oddish'])
  })

  it('filters tables by table/species/region search', () => {
    const browser = useEncounterTableBrowser({ entries, regions })

    browser.searchTerm.value = 'zubat'
    expect(browser.filteredByRegion.value).toEqual([
      { region: 'alpha_region', tables: [entries[1]] },
    ])
    expect(browser.filteredCount.value).toBe(1)

    browser.searchTerm.value = 'beta region'
    expect(browser.filteredByRegion.value).toEqual([
      { region: 'beta_region', tables: [entries[2]] },
    ])
  })

  it('updates selected entry through a focused action', () => {
    const browser = useEncounterTableBrowser({ entries, regions })

    browser.selectEntry('beta_region', 'lake')

    expect(browser.selectedRegion.value).toBe('beta_region')
    expect(browser.selectedKey.value).toBe('lake')
    expect(browser.selectedEntry.value).toBe(entries[2])
    expect(browser.selectedRows.value).toEqual([{
      range: '01–100',
      weight: 100,
      percent: 100,
      chancePercentLabel: '100%',
      species: 'Magikarp',
      minLevel: 6,
      maxLevel: 10,
      levelRange: 'Lv 6–10',
    }])
  })

  it('handles an empty table collection', () => {
    const browser = useEncounterTableBrowser({ entries: [], regions: [] })

    expect(browser.totalCount).toBe(0)
    expect(browser.filteredByRegion.value).toEqual([])
    expect(browser.selectedRegion.value).toBeNull()
    expect(browser.selectedKey.value).toBeNull()
    expect(browser.selectedEntry.value).toBeNull()
    expect(browser.selectedRows.value).toEqual([])
  })
})
