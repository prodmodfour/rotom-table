import { describe, expect, it } from 'vitest'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  GROUP_INVENTORY_ROW_ID_PREFIX,
  GROUP_INVENTORY_SECTION_KEYS,
  createDefaultGroupInventoryDocument,
  normalizeGroupInventoryDocument,
} from '~/types/groupInventory'
import { TRAINER_INVENTORY_SECTIONS } from '~/utils/sheets/trainerInventorySections'

const emptyInventory = () => Object.fromEntries(
  TRAINER_INVENTORY_SECTIONS.map((section) => [section.key, []]),
)

const rowIdGenerator = (prefix = 'row') => {
  let nextId = 0
  return () => {
    nextId += 1
    return `${prefix}-${nextId}`
  }
}

describe('groupInventory', () => {
  it('creates a default main document with every inventory section', () => {
    const document = createDefaultGroupInventoryDocument({ now: 1234 })

    expect(document).toEqual({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 0,
      updatedAt: 1234,
      money: 0,
      inventory: emptyInventory(),
    })
    expect(GROUP_INVENTORY_SECTION_KEYS).toEqual(TRAINER_INVENTORY_SECTIONS.map((section) => section.key))
  })

  it('normalizes empty input into the default main document shape', () => {
    const document = normalizeGroupInventoryDocument(undefined, { now: 4567 })

    expect(document).toEqual({
      slug: GROUP_INVENTORY_MAIN_SLUG,
      revision: 0,
      updatedAt: 4567,
      money: 0,
      inventory: emptyInventory(),
    })
  })

  it('normalizes legacy and partial section objects while stripping unsafe fields', () => {
    const document = normalizeGroupInventoryDocument(
      {
        slug: 'main',
        revision: 7,
        updatedAt: 999,
        money: '2500.9',
        notes: '  Shared party cache  ',
        uiState: { expanded: true },
        inventory: {
          keyItems: {
            amber: {
              id: ' amber-row ',
              name: '  Old Amber  ',
              qty: '2',
              cost: ' $5000 ',
              description: '  Fossil specimen  ',
              editing: true,
            },
            bike: {
              name: ' Bicycle ',
              qty: 'not a number',
              customClientOnly: 'remove me',
            },
          },
          equipment: {
            id: ' goggles-row ',
            name: ' Safety Goggles ',
            qty: 3,
            slot: ' Body ',
            cost: 500,
            description: ' Weather gear ',
            selected: true,
          },
          unknownSection: [
            { name: 'Should not survive' },
          ],
        },
      },
      { generateRowId: rowIdGenerator('generated') },
    )

    expect(document).toEqual({
      slug: 'main',
      revision: 7,
      updatedAt: 999,
      money: 2500,
      notes: 'Shared party cache',
      inventory: {
        ...emptyInventory(),
        keyItems: [
          {
            id: 'amber-row',
            name: 'Old Amber',
            qty: 2,
            cost: '$5000',
            description: 'Fossil specimen',
          },
          {
            id: 'generated-1',
            name: 'Bicycle',
            qty: 0,
          },
        ],
        equipment: [
          {
            id: 'goggles-row',
            name: 'Safety Goggles',
            slot: 'Body',
            cost: 500,
            description: 'Weather gear',
          },
        ],
      },
    })
  })

  it('coerces bad quantities to safe non-negative integers', () => {
    const document = normalizeGroupInventoryDocument(
      {
        inventory: {
          pokemonItems: [
            { name: 'Potion', qty: -5 },
            { name: 'Ether', qty: 3.8 },
            { name: 'Revive', qty: Number.MAX_SAFE_INTEGER + 1000 },
            { name: 'Antidote', qty: Number.NaN },
            { name: 'Awakening' },
          ],
        },
      },
      { now: 1, generateRowId: rowIdGenerator('qty') },
    )

    expect(document.inventory.pokemonItems).toEqual([
      { id: 'qty-1', name: 'Potion', qty: 0 },
      { id: 'qty-2', name: 'Ether', qty: 3 },
      { id: 'qty-3', name: 'Revive', qty: Number.MAX_SAFE_INTEGER },
      { id: 'qty-4', name: 'Antidote', qty: 0 },
      { id: 'qty-5', name: 'Awakening' },
    ])
  })

  it('generates stable row IDs and preserves them on later normalizations', () => {
    const document = normalizeGroupInventoryDocument(
      {
        inventory: {
          keyItems: [
            { id: 'existing-row', name: 'Town Map' },
            { id: 'existing-row', name: 'Duplicate old ID' },
            { name: 'Lift Key' },
          ],
        },
      },
      {
        now: 1,
        generateRowId: ({ section, index }) => `${section}-${index}`,
      },
    )

    expect(document.inventory.keyItems.map((entry) => entry.id)).toEqual([
      'existing-row',
      'keyItems-1',
      'keyItems-2',
    ])

    const renormalized = normalizeGroupInventoryDocument(document, {
      now: 2,
      generateRowId: () => 'should-not-be-used',
    })

    expect(renormalized.inventory.keyItems.map((entry) => entry.id)).toEqual([
      'existing-row',
      'keyItems-1',
      'keyItems-2',
    ])
  })

  it('falls back to a safe generated row ID when a generator returns an invalid duplicate', () => {
    const document = normalizeGroupInventoryDocument(
      {
        inventory: {
          foodStuff: [
            { name: 'Rage Candy Bar' },
            { name: 'Lava Cookie' },
          ],
        },
      },
      { now: 1, generateRowId: () => '   ' },
    )

    expect(document.inventory.foodStuff.map((entry) => entry.id)).toEqual([
      `${GROUP_INVENTORY_ROW_ID_PREFIX}-1`,
      `${GROUP_INVENTORY_ROW_ID_PREFIX}-2`,
    ])
  })
})
