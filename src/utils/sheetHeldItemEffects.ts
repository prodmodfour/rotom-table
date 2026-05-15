import { findItem } from '~~/data/ptuReference'

const BRIGHT_POWDER_SPEED_EVASION_BONUS = 2
const LUCK_INCENSE_ACCURACY_ROLL_BONUS = 1

const canonicalHeldItemName = (heldItem: string | null | undefined): string | null => {
  if (!heldItem?.trim()) return null
  return findItem(heldItem)?.name ?? null
}

const heldItemIs = (heldItem: string | null | undefined, itemName: string): boolean =>
  canonicalHeldItemName(heldItem) === itemName

export const heldItemSpeedEvasionBonus = (heldItem: string | null | undefined): number =>
  heldItemIs(heldItem, 'Bright Powder') ? BRIGHT_POWDER_SPEED_EVASION_BONUS : 0

export const heldItemAccuracyRollBonus = (heldItem: string | null | undefined): number =>
  heldItemIs(heldItem, 'Luck Incense') ? LUCK_INCENSE_ACCURACY_ROLL_BONUS : 0

export const heldItemsAccuracyRollBonus = (heldItems: readonly string[] | null | undefined): number =>
  (heldItems ?? []).some((heldItem) => heldItemIs(heldItem, 'Luck Incense'))
    ? LUCK_INCENSE_ACCURACY_ROLL_BONUS
    : 0
