import { describe, expect, it } from 'vitest'
import { itemSpriteUrl } from '~/utils/itemSprites'

describe('item sprite lookup', () => {
  it('uses concrete type booster sprites instead of a generic Type Boosters sprite', () => {
    expect(itemSpriteUrl('Type Boosters')).toBeNull()
    expect(itemSpriteUrl('Fire Type Booster')).toBe('/item-sprites/hold-item/charcoal.png')
    expect(itemSpriteUrl('Water Type Booster')).toBe('/item-sprites/hold-item/mystic-water.png')
    expect(itemSpriteUrl('Fairy Type Booster')).toBe('/item-sprites/plate/pixie.png')
  })
})
