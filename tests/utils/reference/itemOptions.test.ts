import { describe, expect, it } from 'vitest'
import {
  ptuItemIsHeldItem,
  sortPtuItemsForHeldItemSelect,
} from '~/utils/reference/itemOptions'
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

describe('item option helpers', () => {
  it('detects held items by category or section', () => {
    expect(ptuItemIsHeldItem(item({ name: 'Quick Claw', categories: ['Held Item'] }))).toBe(true)
    expect(ptuItemIsHeldItem(item({ name: 'Leftovers', sections: ['Held Items'] }))).toBe(true)
    expect(ptuItemIsHeldItem(item({ name: 'Potion', categories: ['Medicine'] }))).toBe(false)
  })

  it('orders held item select options with held items first, then by name', () => {
    const source = [
      item({ name: 'Potion', categories: ['Medicine'] }),
      item({ name: 'Quick Claw', categories: ['Held Item'] }),
      item({ name: 'Antidote', categories: ['Medicine'] }),
      item({ name: 'Bright Powder', sections: ['Held Items'] }),
    ]

    expect(sortPtuItemsForHeldItemSelect(source).map((entry) => entry.name)).toEqual([
      'Bright Powder',
      'Quick Claw',
      'Antidote',
      'Potion',
    ])
  })
})
