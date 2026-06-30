import { describe, expect, it } from 'vitest'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  ShopCheckoutCalculationError,
  applyShopCheckoutDeliveryToGroupInventory,
  applyShopCheckoutDeliveryToTrainerSheet,
  calculateShopCheckout,
  subtractShopCheckoutMoney,
} from '~/utils/shopCheckout'

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const expectCheckoutError = (action: () => unknown, code: ShopCheckoutCalculationError['code']) => {
  expect(action).toThrow(ShopCheckoutCalculationError)
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(ShopCheckoutCalculationError)
    expect((error as ShopCheckoutCalculationError).code).toBe(code)
  }
}

const shopDocument = (entries: ShopEntry[]): ShopTableDocument => ({
  slug: 'viridian-mart',
  revision: 5,
  updatedAt: 1234,
  name: 'Viridian Mart',
  playerVisible: true,
  open: true,
  allowedPaymentSources: ['trainer', 'groupInventory'],
  allowedDeliveryTargets: ['trainer', 'groupInventory'],
  entries,
})

const groupInventoryDocument = (overrides: Partial<GroupInventoryDocument> = {}): GroupInventoryDocument => ({
  slug: 'main',
  revision: 2,
  updatedAt: 2222,
  money: 0,
  inventory: {
    keyItems: [],
    pokemonItems: [],
    medicalKit: [],
    pokeBalls: [],
    foodStuff: [],
    equipment: [],
  },
  ...overrides,
})

const trainerSheet = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  revision: 3,
  name: 'Ash',
  level: 1,
  money: 0,
  inventory: {
    keyItems: [],
    pokemonItems: [],
    medicalKit: [],
    pokeBalls: [],
    foodStuff: [],
    equipment: [],
  },
  ...overrides,
})

describe('shop checkout calculation helpers', () => {
  it('calculates multi-line totals while leaving unlimited stock unchanged and decrementing finite stock', () => {
    const shop = shopDocument([
      { id: 'potion-row', itemName: 'Potion', section: 'medicalKit', price: 200, stock: null },
      { id: 'ball-row', itemName: 'Poké Ball', section: 'pokeBalls', price: 100, stock: 10 },
    ])
    const shopBefore = cloneJson(shop)

    const result = calculateShopCheckout({
      shop,
      lines: [
        { entryId: 'potion-row', quantity: 2 },
        { entryId: 'ball-row', quantity: 3 },
      ],
    })

    expect(result.totalPrice).toBe(700)
    expect(result.lines).toEqual([
      {
        entryId: 'potion-row',
        itemName: 'Potion',
        section: 'medicalKit',
        quantity: 2,
        unitPrice: 200,
        lineTotal: 400,
        stock: null,
      },
      {
        entryId: 'ball-row',
        itemName: 'Poké Ball',
        section: 'pokeBalls',
        quantity: 3,
        unitPrice: 100,
        lineTotal: 300,
        stock: 7,
      },
    ])
    expect(result.shop.entries.map((entry) => entry.stock)).toEqual([null, 7])
    expect(shop).toEqual(shopBefore)
  })

  it('rejects invalid quantities and missing shop entries', () => {
    const shop = shopDocument([
      { id: 'potion-row', itemName: 'Potion', section: 'medicalKit', price: 200, stock: 5 },
    ])

    expectCheckoutError(() => calculateShopCheckout({
      shop,
      lines: [{ entryId: 'potion-row', quantity: 0 }],
    }), 'invalid-line-quantity')
    expectCheckoutError(() => calculateShopCheckout({
      shop,
      lines: [{ entryId: 'potion-row', quantity: 1.5 }],
    }), 'invalid-line-quantity')
    expectCheckoutError(() => calculateShopCheckout({
      shop,
      lines: [{ entryId: 'missing-row', quantity: 1 }],
    }), 'missing-entry')
  })

  it('rejects insufficient finite stock and max-per-purchase violations', () => {
    const shop = shopDocument([
      { id: 'potion-row', itemName: 'Potion', section: 'medicalKit', price: 200, stock: 2 },
      { id: 'rare-row', itemName: 'Rare Candy', section: 'pokemonItems', price: 4800, stock: 10, maxPerPurchase: 1 },
    ])

    expectCheckoutError(() => calculateShopCheckout({
      shop,
      lines: [{ entryId: 'potion-row', quantity: 3 }],
    }), 'insufficient-stock')
    expectCheckoutError(() => calculateShopCheckout({
      shop,
      lines: [{ entryId: 'rare-row', quantity: 2 }],
    }), 'max-per-purchase-exceeded')
  })

  it('subtracts group and trainer payments without mutating inputs and rejects insufficient money', () => {
    const groupPaymentSource = groupInventoryDocument({ money: 1_000 })
    const trainerPaymentSource = trainerSheet({ money: 350 })
    const groupBefore = cloneJson(groupPaymentSource)
    const trainerBefore = cloneJson(trainerPaymentSource)

    expect(subtractShopCheckoutMoney(groupPaymentSource, 250).money).toBe(750)
    expect(subtractShopCheckoutMoney(trainerPaymentSource, 125).money).toBe(225)
    expectCheckoutError(() => subtractShopCheckoutMoney(trainerPaymentSource, 999), 'insufficient-money')
    expect(groupPaymentSource).toEqual(groupBefore)
    expect(trainerPaymentSource).toEqual(trainerBefore)
  })

  it('delivers stackable purchases to trainer inventory by merging matching item rows', () => {
    const shop = shopDocument([
      {
        id: 'potion-row',
        itemName: 'Potion',
        section: 'medicalKit',
        price: 200,
        stock: null,
        playerDescription: 'Heals 20 HP.',
      },
    ])
    const calculation = calculateShopCheckout({
      shop,
      lines: [{ entryId: 'potion-row', quantity: 3 }],
    })
    const trainer = trainerSheet({
      inventory: {
        keyItems: [],
        pokemonItems: [],
        medicalKit: [{ name: 'pótîon', qty: 2, description: 'Existing notes' }],
        pokeBalls: [],
        foodStuff: [],
        equipment: [],
      },
    })
    const trainerBefore = cloneJson(trainer)

    const deliveredTrainer = applyShopCheckoutDeliveryToTrainerSheet({
      trainerSheet: trainer,
      purchasedEntries: calculation.purchasedEntries,
    })

    expect(deliveredTrainer.inventory?.medicalKit).toEqual([
      { name: 'pótîon', qty: 5, description: 'Existing notes' },
    ])
    expect(trainer).toEqual(trainerBefore)
  })

  it('delivers group inventory rows with generated ids and equipment as whole-row purchases', () => {
    const shop = shopDocument([
      {
        id: 'antidote-row',
        itemName: 'Antidote',
        section: 'medicalKit',
        price: 150,
        stock: 5,
        playerDescription: 'Cures poison.',
      },
      { id: 'bike-row', itemName: 'Bike', section: 'equipment', price: 1_000_000, stock: 3 },
    ])
    const calculation = calculateShopCheckout({
      shop,
      lines: [
        { entryId: 'antidote-row', quantity: 2 },
        { entryId: 'bike-row', quantity: 2 },
      ],
    })
    const groupInventory = groupInventoryDocument()
    const groupBefore = cloneJson(groupInventory)

    const deliveredGroup = applyShopCheckoutDeliveryToGroupInventory({
      groupInventory,
      purchasedEntries: calculation.purchasedEntries,
      createTargetRowId: ({ section, index }) => `group-${section}-${index}`,
    })

    expect(deliveredGroup.inventory.medicalKit).toEqual([
      { id: 'group-medicalKit-0', name: 'Antidote', qty: 2, cost: 150, description: 'Cures poison.' },
    ])
    expect(deliveredGroup.inventory.equipment).toEqual([
      { id: 'group-equipment-0', name: 'Bike', cost: 1_000_000 },
      { id: 'group-equipment-1', name: 'Bike', cost: 1_000_000 },
    ])
    expect(groupInventory).toEqual(groupBefore)
  })
})
