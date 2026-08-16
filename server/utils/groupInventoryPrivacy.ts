import type { GroupInventoryDocument } from '~/types/groupInventory'

/**
 * Player-safe shared inventory projection. Whole-item count remains visible,
 * while stable serialized identity, hashes, configuration, and item state stay
 * server/GM private.
 */
export const projectGroupInventoryForPlayer = (
  document: GroupInventoryDocument,
): GroupInventoryDocument => ({
  ...structuredClone(document),
  inventory: Object.fromEntries(Object.entries(document.inventory).map(([section, rows]) => [
    section,
    rows.map((entry) => {
      if (entry.serializedEquipment === undefined) return structuredClone(entry)
      const projected = { ...structuredClone(entry), qty: 1 }
      delete projected.serializedEquipment
      return projected
    }),
  ])) as GroupInventoryDocument['inventory'],
})
