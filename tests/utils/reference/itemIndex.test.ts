import { describe, expect, it } from 'vitest'
import {
  buildItemCategoryCounts,
  buildItemSectionCounts,
  filterItemsForIndex,
  itemMatchesSearch,
  normalizeReferenceSearch,
} from '~/utils/reference/itemIndex'
import type { PtuItem } from '~/types/ptuReference'

const item = (overrides: Partial<PtuItem> & Pick<PtuItem, 'name'>): PtuItem => ({
  name: overrides.name,
  categories: overrides.categories ?? [],
  effects: overrides.effects ?? [],
  costs: overrides.costs ?? [],
  sections: overrides.sections ?? [],
  aliases: overrides.aliases ?? [],
  notes: overrides.notes ?? [],
  source: overrides.source ?? 'test.md',
})

const sampleItems: PtuItem[] = [
  item({
    name: 'Potion',
    categories: ['Medicine'],
    sections: ['Medicine'],
    costs: ['$200'],
    effects: ['Heals hit points.'],
    aliases: ['Basic Potion'],
  }),
  item({
    name: 'Great Ball',
    categories: ['Poké Balls'],
    sections: ['Capture'],
    costs: ['$600'],
    effects: ['Improves capture rolls.'],
  }),
  item({
    name: 'Leftovers',
    categories: ['Held Item'],
    sections: ['Held Items'],
    costs: ['Rare'],
    effects: ['Restores HP each turn.'],
    notes: ['Food-like item'],
  }),
  item({
    name: 'Antidote',
    categories: ['Medicine'],
    sections: ['Medicine'],
    costs: ['$100'],
    effects: ['Cures Poison.'],
  }),
]

describe('item index helpers', () => {
  it('normalizes search text', () => {
    expect(normalizeReferenceSearch('  Poké Ball  ')).toBe('poké ball')
  })

  it('counts categories by frequency then name', () => {
    expect(buildItemCategoryCounts(sampleItems)).toEqual([
      { category: 'Medicine', count: 2 },
      { category: 'Held Item', count: 1 },
      { category: 'Poké Balls', count: 1 },
    ])
  })

  it('counts sections alphabetically', () => {
    expect(buildItemSectionCounts(sampleItems)).toEqual([
      { section: 'Capture', count: 1 },
      { section: 'Held Items', count: 1 },
      { section: 'Medicine', count: 2 },
    ])
  })

  it('matches search haystacks across item fields', () => {
    expect(itemMatchesSearch(sampleItems[0]!, 'basic')).toBe(true)
    expect(itemMatchesSearch(sampleItems[1]!, 'capture')).toBe(true)
    expect(itemMatchesSearch(sampleItems[2]!, 'food-like')).toBe(true)
    expect(itemMatchesSearch(sampleItems[3]!, 'missing')).toBe(false)
  })

  it('filters by category, section, and search term', () => {
    expect(filterItemsForIndex(sampleItems, { category: 'Medicine' }).map((i) => i.name)).toEqual([
      'Potion',
      'Antidote',
    ])
    expect(filterItemsForIndex(sampleItems, { section: 'Capture' }).map((i) => i.name)).toEqual([
      'Great Ball',
    ])
    expect(filterItemsForIndex(sampleItems, { searchTerm: 'hp' }).map((i) => i.name)).toEqual([
      'Leftovers',
    ])
    expect(filterItemsForIndex(sampleItems, {
      category: 'Medicine',
      section: 'Medicine',
      searchTerm: 'poison',
    }).map((i) => i.name)).toEqual(['Antidote'])
  })
})
