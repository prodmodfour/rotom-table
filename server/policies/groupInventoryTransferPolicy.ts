import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { playerProfileCanAccessSheet } from './playerProfilePolicy'

export const GROUP_INVENTORY_TRANSFER_PROFILE_REQUIRED_MESSAGE =
  'Choose a player profile before transferring inventory for linked trainer sheets.'

export const groupInventoryTransferUnlinkedTrainerMessage = (trainerSlug: string): string =>
  `Trainer sheet ${trainerSlug} is not linked to the selected player profile.`

export interface GroupInventoryTrainerTransferActor {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
}

export interface GroupInventoryTrainerTransferAuthorizationInput extends GroupInventoryTrainerTransferActor {
  readonly trainerSlug: string
}

export type GroupInventoryTrainerTransferAuthorizationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly statusCode: 403; readonly message: string }

export const authorizeGroupInventoryTrainerTransfer = (
  input: GroupInventoryTrainerTransferAuthorizationInput,
): GroupInventoryTrainerTransferAuthorizationResult => {
  if (input.role === 'gm') return { ok: true }

  if (!input.playerProfile) {
    return {
      ok: false,
      statusCode: 403,
      message: GROUP_INVENTORY_TRANSFER_PROFILE_REQUIRED_MESSAGE,
    }
  }

  if (playerProfileCanAccessSheet(input.playerProfile, 'trainer', input.trainerSlug)) {
    return { ok: true }
  }

  return {
    ok: false,
    statusCode: 403,
    message: groupInventoryTransferUnlinkedTrainerMessage(input.trainerSlug),
  }
}
