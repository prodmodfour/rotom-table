import { describe, expect, it } from 'vitest'
import type { InventoryEntry } from '~/types/trainerSheet'
import {
  autofillTrainerInventoryItem,
  buildTrainerInventoryAutofillPatch,
  resolveTrainerInventoryItemReference,
  setTrainerInventoryItemName,
  trainerInventoryItemOptions,
} from '~/utils/sheets/trainerInventoryItems'

describe('trainerInventoryItems', () => {
  it('prioritizes section-relevant item options without hiding the rest of the catalog', () => {
    const pokeBallOptions = trainerInventoryItemOptions('pokeBalls')
    const potionIndex = pokeBallOptions.findIndex((option) => option.value === 'Potion')
    const greatBallIndex = pokeBallOptions.findIndex((option) => option.value === 'Great Ball')

    expect(greatBallIndex).toBeGreaterThanOrEqual(0)
    expect(potionIndex).toBeGreaterThanOrEqual(0)
    expect(greatBallIndex).toBeLessThan(potionIndex)
  })

  it('fills blank inventory fields from the selected reference item', () => {
    const entry: InventoryEntry = { name: '' }

    setTrainerInventoryItemName(entry, 'Potion', 'standard')

    expect(entry).toMatchObject({
      name: 'Potion',
      qty: 1,
      cost: '$200',
      description: 'Heals 20 Hit Points',
    })
  })

  it('canonicalizes aliases and fills Poké Ball capture modifiers', () => {
    const entry: InventoryEntry = { name: '' }

    setTrainerInventoryItemName(entry, 'Poke Ball', 'pokeBalls')

    expect(entry.name).toBe('Basic Ball')
    expect(entry.cost).toBe('$250')
    expect(entry.mod).toBe('+0')
  })

  it('updates fields that still match the previous reference autofill', () => {
    const entry: InventoryEntry = {
      name: 'Potion',
      qty: 1,
      cost: 200,
      description: 'Heals 20 Hit Points',
    }

    setTrainerInventoryItemName(entry, 'Super Potion', 'standard')

    expect(entry).toMatchObject({
      name: 'Super Potion',
      qty: 1,
      cost: '$380',
      description: 'Heals 35 Hit Points',
    })
  })

  it('does not overwrite custom inventory fields', () => {
    const entry: InventoryEntry = {
      name: 'Potion',
      qty: 4,
      cost: 150,
      description: 'Bought at a discount.',
    }

    setTrainerInventoryItemName(entry, 'Super Potion', 'standard')

    expect(entry).toMatchObject({
      name: 'Super Potion',
      qty: 4,
      cost: 150,
      description: 'Bought at a discount.',
    })
  })

  it('clears stale autofill fields when changing to a custom item name', () => {
    const entry: InventoryEntry = {
      name: 'Potion',
      qty: 1,
      cost: '$200',
      description: 'Heals 20 Hit Points',
    }

    setTrainerInventoryItemName(entry, 'Custom Poultice', 'standard')

    expect(entry).toEqual({ name: 'Custom Poultice', qty: 1 })
  })

  it('infers equipment slots from equipment reference categories', () => {
    const item = resolveTrainerInventoryItemReference('Safety Goggles')

    expect(item).toBeTruthy()
    expect(buildTrainerInventoryAutofillPatch(item!, 'equipment')).toMatchObject({
      slot: 'Head',
    })
  })

  it('can fill missing fields for an existing named row', () => {
    const entry: InventoryEntry = { name: 'Antidote', qty: 2 }

    expect(autofillTrainerInventoryItem(entry, 'standard')).toBe(true)

    expect(entry).toMatchObject({
      name: 'Antidote',
      qty: 2,
      cost: '$200',
      description: 'Cures Poison',
    })
  })
})
