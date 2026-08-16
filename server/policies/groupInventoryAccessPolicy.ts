import type { AuthRole } from '#shared/auth'
import { GROUP_INVENTORY_MAIN_SLUG } from '~/types/groupInventory'

/**
 * Liveplay exposes one shared player-facing group inventory. Additional valid
 * group slugs are GM custody unless a later versioned campaign policy grants
 * them explicitly.
 */
export const canAccessGroupInventoryForRole = (
  role: AuthRole,
  groupSlug: string,
): boolean => role === 'gm' || groupSlug === GROUP_INVENTORY_MAIN_SLUG
