import type { TrainerEquipmentSlots, TrainerInventory } from '~/types/trainerSheet'

export type TrainerInventoryKey = keyof NonNullable<TrainerInventory>
export type TrainerInventoryTableVariant = 'standard' | 'pokeBalls' | 'equipment'

export interface TrainerInventorySection {
  readonly key: TrainerInventoryKey
  readonly title: string
  readonly namePlaceholder: string
  readonly variant: TrainerInventoryTableVariant
}

export interface TrainerEquipmentSlotDefinition {
  readonly key: keyof TrainerEquipmentSlots
  readonly label: string
}

export const TRAINER_EQUIPMENT_SLOTS = [
  { key: 'mainHand', label: 'Main Hand' },
  { key: 'offHand', label: 'Off Hand' },
  { key: 'head', label: 'Head' },
  { key: 'body', label: 'Body' },
  { key: 'feet', label: 'Feet' },
  { key: 'accessory', label: 'Accessory' },
] as const satisfies readonly TrainerEquipmentSlotDefinition[]

export const TRAINER_INVENTORY_SECTIONS = [
  { key: 'keyItems', title: 'Key Items', namePlaceholder: 'Item', variant: 'standard' },
  { key: 'pokemonItems', title: 'Pokémon Items', namePlaceholder: 'Item', variant: 'standard' },
  { key: 'medicalKit', title: 'Medical Kit', namePlaceholder: 'Item', variant: 'standard' },
  { key: 'pokeBalls', title: 'Poké Balls & Accessories', namePlaceholder: 'Poké Ball', variant: 'pokeBalls' },
  { key: 'foodStuff', title: 'Food Stuff', namePlaceholder: 'Food', variant: 'standard' },
  { key: 'equipment', title: 'Equipment', namePlaceholder: 'Equipment', variant: 'equipment' },
] as const satisfies readonly TrainerInventorySection[]

export const inventoryTableColumnCount = (variant: TrainerInventoryTableVariant): number =>
  variant === 'pokeBalls' ? 6 : 5
