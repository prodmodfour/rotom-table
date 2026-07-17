import { TRAINER_EQUIPMENT_SLOTS } from '~/utils/sheets/trainerInventorySections'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const EMPTY_ITEM_LABELS = new Set(['-', '—', 'none', 'n/a', 'na'])

export const splitSheetItemNames = (value: string | null | undefined): string[] => {
  if (!value?.trim()) return []
  return value
    .split(/\s*(?:[,;]|\s+[+&|/]\s+)\s*/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !EMPTY_ITEM_LABELS.has(item.toLowerCase()))
}

export const pokemonHeldItemNames = (sheet: CharacterSheet): string[] =>
  splitSheetItemNames(sheet.items?.held)

export interface TrainerEquippedItemNameOptions {
  /** Magic Room suppresses only Accessory-slot equipment for Trainers. */
  readonly includeAccessory?: boolean
}

export const trainerEquippedItemNames = (
  sheet: TrainerSheet,
  options: TrainerEquippedItemNameOptions = {},
): string[] => {
  const slots = sheet.equipmentSlots
  if (!slots) return []
  const includeAccessory = options.includeAccessory ?? true
  return TRAINER_EQUIPMENT_SLOTS
    .filter(slot => includeAccessory || slot.key !== 'accessory')
    .flatMap((slot) => splitSheetItemNames(slots[slot.key]))
}
