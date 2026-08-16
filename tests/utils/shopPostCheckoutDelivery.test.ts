import { describe, expect, it } from 'vitest'
import type { ShopCheckoutPurchasedEntry } from '../../src/utils/shopCheckout'
import { mergeShopCheckoutEntriesIntoInventoryWithSources } from '../../src/utils/shopCheckout'
import type { ShopEntry } from '../../src/types/shop'

const purchase = (entry: ShopEntry, quantity: number): ShopCheckoutPurchasedEntry => ({
  entry,
  quantity,
  unitPrice: entry.price,
  lineTotal: entry.price * quantity,
  remainingStock: null,
})

describe('shop checkout exact delivery sources', () => {
  it('traces a merged stack to its existing stable row without searching by name later', () => {
    const delivery = mergeShopCheckoutEntriesIntoInventoryWithSources({
      inventory: {
        medicalKit: [{ id: 'existing-potion', name: 'Potion', qty: 3, cost: 200 }],
      },
      purchasedEntries: [purchase({
        id: 'shop-potion', itemName: 'Potion', section: 'medicalKit', price: 200, stock: null,
      }, 2)],
      createTargetRowId: () => 'unused-new-row',
    })
    expect(delivery.inventory.medicalKit).toEqual([{ id: 'existing-potion', name: 'Potion', qty: 5, cost: 200 }])
    expect(delivery.sources).toEqual([{
      entryId: 'shop-potion', itemName: 'Potion', section: 'medicalKit', quantity: 2,
      rowId: 'existing-potion', rowIndex: 0,
    }])
  })

  it('traces every whole-item purchase to a distinct generated equipment row', () => {
    let counter = 0
    const delivery = mergeShopCheckoutEntriesIntoInventoryWithSources({
      inventory: { equipment: [{ id: 'old-armor', name: 'Light Armor', cost: 4_000 }] },
      purchasedEntries: [purchase({
        id: 'shop-armor', itemName: 'Light Armor', section: 'equipment', price: 4_000, stock: null,
      }, 2)],
      createTargetRowId: () => `new-armor-${++counter}`,
    })
    expect(delivery.inventory.equipment.map(row => row.id)).toEqual(['old-armor', 'new-armor-1', 'new-armor-2'])
    expect(delivery.sources.map(source => ({ rowId: source.rowId, rowIndex: source.rowIndex, quantity: source.quantity })))
      .toEqual([
        { rowId: 'new-armor-1', rowIndex: 1, quantity: 1 },
        { rowId: 'new-armor-2', rowIndex: 2, quantity: 1 },
      ])
  })

  it('fails closed when a checkout delivery does not receive stable row identity', () => {
    expect(() => mergeShopCheckoutEntriesIntoInventoryWithSources({
      inventory: {},
      purchasedEntries: [purchase({
        id: 'shop-potion', itemName: 'Potion', section: 'medicalKit', price: 200, stock: null,
      }, 1)],
    })).toThrow('stable exact destination row identity')
  })
})
