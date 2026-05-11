import { describe, expect, it } from 'vitest'
import {
  TRAINER_EQUIPMENT_SLOTS,
  TRAINER_INVENTORY_SECTIONS,
  inventoryTableColumnCount,
} from '~/utils/sheets/trainerInventorySections'

describe('trainerInventorySections', () => {
  it('keeps equipment slots in sheet display order', () => {
    expect(TRAINER_EQUIPMENT_SLOTS.map((slot) => [slot.key, slot.label])).toEqual([
      ['mainHand', 'Main Hand'],
      ['offHand', 'Off Hand'],
      ['head', 'Head'],
      ['body', 'Body'],
      ['feet', 'Feet'],
      ['accessory', 'Accessory'],
    ])
  })

  it('keeps inventory sections in existing display order with placeholders', () => {
    expect(TRAINER_INVENTORY_SECTIONS.map((section) => [section.key, section.title, section.namePlaceholder, section.variant])).toEqual([
      ['keyItems', 'Key Items', 'Item', 'standard'],
      ['pokemonItems', 'Pokémon Items', 'Item', 'standard'],
      ['medicalKit', 'Medical Kit', 'Item', 'standard'],
      ['pokeBalls', 'Poké Balls & Accessories', 'Poké Ball', 'pokeBalls'],
      ['foodStuff', 'Food Stuff', 'Food', 'standard'],
      ['equipment', 'Equipment', 'Equipment', 'equipment'],
    ])
  })

  it('reports table column counts for empty rows', () => {
    expect(inventoryTableColumnCount('standard')).toBe(5)
    expect(inventoryTableColumnCount('equipment')).toBe(5)
    expect(inventoryTableColumnCount('pokeBalls')).toBe(6)
  })
})
