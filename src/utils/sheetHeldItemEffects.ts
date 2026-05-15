import { findItem } from '~~/data/ptuReference'

const BRIGHT_POWDER_SPEED_EVASION_BONUS = 2
const LUCK_INCENSE_ACCURACY_ROLL_BONUS = 1
const QUICK_CLAW_INITIATIVE_BONUS = 10

const canonicalHeldItemName = (heldItem: string | null | undefined): string | null => {
  if (!heldItem?.trim()) return null
  return findItem(heldItem)?.name ?? null
}

const heldItemIs = (heldItem: string | null | undefined, itemName: string): boolean =>
  canonicalHeldItemName(heldItem) === itemName

const heldItemsContain = (
  heldItems: readonly string[] | null | undefined,
  itemName: string,
): boolean => (heldItems ?? []).some((heldItem) => heldItemIs(heldItem, itemName))

export const heldItemSpeedEvasionBonus = (heldItem: string | null | undefined): number =>
  heldItemIs(heldItem, 'Bright Powder') ? BRIGHT_POWDER_SPEED_EVASION_BONUS : 0

export const heldItemAccuracyRollBonus = (heldItem: string | null | undefined): number =>
  heldItemIs(heldItem, 'Luck Incense') ? LUCK_INCENSE_ACCURACY_ROLL_BONUS : 0

export const heldItemsAccuracyRollBonus = (heldItems: readonly string[] | null | undefined): number =>
  heldItemsContain(heldItems, 'Luck Incense') ? LUCK_INCENSE_ACCURACY_ROLL_BONUS : 0

export const heldItemInitiativeBonus = (heldItem: string | null | undefined): number =>
  heldItemIs(heldItem, 'Quick Claw') ? QUICK_CLAW_INITIATIVE_BONUS : 0

export const sheetItemsInitiativeBonus = (itemNames: readonly string[] | null | undefined): number =>
  heldItemsContain(itemNames, 'Quick Claw') ? QUICK_CLAW_INITIATIVE_BONUS : 0
