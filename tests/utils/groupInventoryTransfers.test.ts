import { describe, expect, it } from 'vitest'
import type { GroupInventory } from '~/types/groupInventory'
import {
  InventoryTransferError,
  decrementOrRemoveInventorySourceRow,
  findGroupInventoryRowById,
  mergeInventoryEntryIntoSection,
  normalizeInventoryItemNameIdentity,
  transferInventoryItem,
  transferMoneyBetweenDocuments,
  type InventoryTransferInventory,
} from '~/utils/groupInventoryTransfers'

const emptyInventory = (): InventoryTransferInventory => ({
  keyItems: [],
  pokemonItems: [],
  medicalKit: [],
  pokeBalls: [],
  foodStuff: [],
  equipment: [],
})

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const expectTransferError = (action: () => unknown, code: InventoryTransferError['code']) => {
  expect(action).toThrow(InventoryTransferError)
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(InventoryTransferError)
    expect((error as InventoryTransferError).code).toBe(code)
  }
}

describe('group inventory transfer helpers', () => {
  it('finds group inventory rows by section and stable row id without returning a mutable source entry', () => {
    const inventory = {
      ...emptyInventory(),
      keyItems: [
        { id: 'row-town-map', name: 'Town Map', qty: 1 },
        { id: 'row-lift-key', name: 'Lift Key', qty: 1 },
      ],
    } as GroupInventory

    const found = findGroupInventoryRowById({ inventory }, 'keyItems', ' row-lift-key ')

    expect(found).toEqual({
      section: 'keyItems',
      rowId: 'row-lift-key',
      index: 1,
      entry: { id: 'row-lift-key', name: 'Lift Key', qty: 1 },
    })
    expect(found?.entry).not.toBe(inventory.keyItems[1])
    expect(findGroupInventoryRowById(inventory, 'keyItems', 'missing-row')).toBeNull()
  })

  it('partially decrements stackable source rows and merges targets by normalized item name without mutating inputs', () => {
    const sourceInventory: InventoryTransferInventory = {
      ...emptyInventory(),
      pokemonItems: [
        { id: 'group-potion-row', name: '  Potion  ', qty: 5, cost: ' $200 ', description: ' Heals 20 Hit Points ' },
      ],
    }
    const targetInventory: InventoryTransferInventory = {
      ...emptyInventory(),
      pokemonItems: [
        { name: 'pótîon', qty: 2, description: 'Existing trainer notes' },
      ],
    }
    const sourceBefore = cloneJson(sourceInventory)
    const targetBefore = cloneJson(targetInventory)

    const result = transferInventoryItem({
      sourceInventory,
      targetInventory,
      section: 'pokemonItems',
      sourceRowId: 'group-potion-row',
      quantity: 3,
    })

    expect(result.removedSourceRow).toBe(false)
    expect(result.transferredEntry).toEqual({
      name: 'Potion',
      qty: 3,
      cost: '$200',
      description: 'Heals 20 Hit Points',
    })
    expect(result.sourceInventory.pokemonItems).toEqual([
      { id: 'group-potion-row', name: 'Potion', qty: 2, cost: '$200', description: 'Heals 20 Hit Points' },
    ])
    expect(result.targetInventory.pokemonItems).toEqual([
      { name: 'pótîon', qty: 5, description: 'Existing trainer notes' },
    ])
    expect(sourceInventory).toEqual(sourceBefore)
    expect(targetInventory).toEqual(targetBefore)
  })

  it('removes source rows on exact-quantity stackable transfers and can generate group row ids for new target rows', () => {
    const result = transferInventoryItem({
      sourceInventory: {
        ...emptyInventory(),
        medicalKit: [{ name: 'Antidote', qty: 2, cost: '$200' }],
      },
      targetInventory: emptyInventory(),
      section: 'medicalKit',
      sourceRowIndex: 0,
      quantity: '2',
      createTargetRowId: ({ section, index }) => `target-${section}-${index}`,
    })

    expect(result.removedSourceRow).toBe(true)
    expect(result.sourceInventory.medicalKit).toEqual([])
    expect(result.targetInventory.medicalKit).toEqual([
      { id: 'target-medicalKit-0', name: 'Antidote', qty: 2, cost: '$200' },
    ])
  })

  it('moves equipment as whole-row transfers without stack merging or source row ids leaking to the target', () => {
    const result = transferInventoryItem({
      sourceInventory: {
        ...emptyInventory(),
        equipment: [{ id: 'group-goggles', name: 'Safety Goggles', slot: ' Head ', cost: 500, qty: 9 }],
      },
      targetInventory: {
        ...emptyInventory(),
        equipment: [{ name: 'Safety Goggles', slot: 'Accessory' }],
      },
      section: 'equipment',
      sourceRowId: 'group-goggles',
      quantity: 1,
    })

    expect(result.sourceInventory.equipment).toEqual([])
    expect(result.transferredEntry).toEqual({ name: 'Safety Goggles', slot: 'Head', cost: 500 })
    expect(result.targetInventory.equipment).toEqual([
      { name: 'Safety Goggles', slot: 'Accessory' },
      { name: 'Safety Goggles', slot: 'Head', cost: 500 },
    ])
  })

  it('rejects invalid transfer quantities before changing inventory snapshots', () => {
    const rows = [{ id: 'row-1', name: 'Potion', qty: 2 }]

    expectTransferError(() => decrementOrRemoveInventorySourceRow({
      section: 'pokemonItems',
      rows,
      rowIndex: 0,
      quantity: 0,
    }), 'invalid-quantity')
    expectTransferError(() => decrementOrRemoveInventorySourceRow({
      section: 'pokemonItems',
      rows,
      rowIndex: 0,
      quantity: 1.5,
    }), 'invalid-quantity')
    expectTransferError(() => transferInventoryItem({
      sourceInventory: { ...emptyInventory(), pokemonItems: rows },
      targetInventory: emptyInventory(),
      section: 'pokemonItems',
      sourceRowId: 'row-1',
      quantity: -1,
    }), 'invalid-quantity')
    expectTransferError(() => transferInventoryItem({
      sourceInventory: { ...emptyInventory(), equipment: [{ id: 'gear-1', name: 'Bike' }] },
      targetInventory: emptyInventory(),
      section: 'equipment',
      sourceRowId: 'gear-1',
      quantity: 2,
    }), 'equipment-partial-transfer')
  })

  it('rejects missing rows and insufficient source quantities clearly', () => {
    const sourceInventory: InventoryTransferInventory = {
      ...emptyInventory(),
      foodStuff: [{ id: 'cookie-row', name: 'Lava Cookie', qty: 1 }],
    }

    expectTransferError(() => transferInventoryItem({
      sourceInventory,
      targetInventory: emptyInventory(),
      section: 'foodStuff',
      sourceRowId: 'missing-row',
      quantity: 1,
    }), 'missing-row')
    expectTransferError(() => transferInventoryItem({
      sourceInventory,
      targetInventory: emptyInventory(),
      section: 'foodStuff',
      sourceRowId: 'cookie-row',
      quantity: 2,
    }), 'insufficient-quantity')
  })

  it('normalizes item identities consistently for stack merging', () => {
    expect(normalizeInventoryItemNameIdentity('  Poké   Ball  ')).toBe('poke ball')
    expect(normalizeInventoryItemNameIdentity('Poke Ball')).toBe('poke ball')

    const mergedRows = mergeInventoryEntryIntoSection({
      section: 'pokeBalls',
      rows: [{ name: 'Poké Ball', qty: 1, mod: '+0' }],
      entry: { name: ' poke   ball ', qty: 4, mod: '+0' },
    })

    expect(mergedRows).toEqual([
      { name: 'Poké Ball', qty: 5, mod: '+0' },
    ])
  })

  it('moves money between documents without mutating either document', () => {
    const sourceDocument = { slug: 'main', money: 500, marker: 'source' }
    const targetDocument = { slug: 'ash', money: 75, marker: 'target' }

    const result = transferMoneyBetweenDocuments({ sourceDocument, targetDocument, amount: 125 })

    expect(result).toEqual({
      amount: 125,
      sourceDocument: { slug: 'main', money: 375, marker: 'source' },
      targetDocument: { slug: 'ash', money: 200, marker: 'target' },
    })
    expect(sourceDocument.money).toBe(500)
    expect(targetDocument.money).toBe(75)
    expectTransferError(() => transferMoneyBetweenDocuments({ sourceDocument, targetDocument, amount: 999 }), 'insufficient-money')
  })
})
