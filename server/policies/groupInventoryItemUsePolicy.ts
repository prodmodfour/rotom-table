import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'

export const GROUP_INVENTORY_ITEM_USE_PROFILE_REQUIRED_MESSAGE =
  'Choose a player profile before using shared inventory for a linked Trainer.'

export const GROUP_INVENTORY_ITEM_USE_TABLE_POLICY = Object.freeze({
  schemaVersion: 1 as const,
  delegation: 'linked-trainer-actor' as const,
  targetScope: 'selected-actor-roster' as const,
  extendedActionSource: 'trainer-custody-required' as const,
})

export type GroupInventoryItemUseAuthorizationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly statusCode: 403; readonly message: string }

/**
 * Fixed liveplay table policy: a GM may name any current Trainer actor; a
 * player may spend shared custody only through one Trainer explicitly linked
 * to the selected Profile. This grants no item mechanics or target authority.
 */
export const authorizeGroupInventoryItemUseActor = (input: {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly trainerSlug: string
}): GroupInventoryItemUseAuthorizationResult => {
  if (input.role === 'gm') return { ok: true }
  if (!input.playerProfile) {
    return { ok: false, statusCode: 403, message: GROUP_INVENTORY_ITEM_USE_PROFILE_REQUIRED_MESSAGE }
  }
  if (playerProfileCanControlTokenSheet(input.playerProfile, 'trainer', input.trainerSlug)) return { ok: true }
  return {
    ok: false,
    statusCode: 403,
    message: 'The selected player profile is not delegated to use shared inventory through this Trainer.',
  }
}
