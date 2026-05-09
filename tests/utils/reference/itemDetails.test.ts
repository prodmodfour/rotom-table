import { describe, expect, it } from 'vitest'
import { relatedItemsByPrimaryCategory } from '~/utils/reference/itemDetails'
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

const potion = item({ name: 'Potion', categories: ['Medicine'] })
const antidote = item({ name: 'Antidote', categories: ['Medicine'] })
const berry = item({ name: 'Lum Berry', categories: ['Held Item', 'Medicine'] })
const pokeball = item({ name: 'Poké Ball', categories: ['Poké Balls'] })
const superPotion = item({ name: 'Super Potion', categories: ['Medicine'] })

describe('item detail helpers', () => {
  it('finds related items by the current item primary category', () => {
    expect(relatedItemsByPrimaryCategory(potion, [potion, antidote, berry, pokeball, superPotion]).map((i) => i.name)).toEqual([
      'Antidote',
      'Lum Berry',
      'Super Potion',
    ])
  })

  it('does not match the current item by name', () => {
    const duplicatePotion = item({ name: 'Potion', categories: ['Medicine'] })
    expect(relatedItemsByPrimaryCategory(potion, [duplicatePotion, antidote]).map((i) => i.name)).toEqual([
      'Antidote',
    ])
  })

  it('respects the related item limit', () => {
    expect(relatedItemsByPrimaryCategory(potion, [antidote, berry, superPotion], { limit: 2 }).map((i) => i.name)).toEqual([
      'Antidote',
      'Lum Berry',
    ])
  })

  it('returns no related items for missing items or items without categories', () => {
    expect(relatedItemsByPrimaryCategory(null, [potion])).toEqual([])
    expect(relatedItemsByPrimaryCategory(item({ name: 'Mystery', categories: [] }), [potion])).toEqual([])
  })
})
