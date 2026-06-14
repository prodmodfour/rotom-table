import {
  actorCanControlTokenPlacement,
  actorControlledPlacementIds,
  buildPlayerProfileTokenControlModel,
  linkedCharacterTokenControlKeys,
  playerProfileCanControlTokenPlacement,
  playerProfileCanControlTokenSheet,
  playerProfileControlledPlacementIds,
  playerProfileTokenControlKeys,
  tokenPlacementSheetKey,
  uniqueTokenPlacementIds,
  type BuildPlayerProfileTokenControlModelInput,
  type PlayerProfileTokenControlModel,
  type PlayerProfileTokenControlStatus,
  type TokenControlPlacementRef,
  type TokenPlacementSheetKey,
} from '#shared/playerProfileTokenControl'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetPlacement } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

export type ClientTokenControlPlacementRef = Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>
export type ClientTokenControlLinkedTrainerSheet = Pick<TrainerSheet, 'slug' | 'currentTeam' | 'boxedPokemon'>

export interface BuildClientPlayerProfileTokenControlModelInput {
  readonly role: AuthRole | null | undefined
  readonly profile?: PlayerProfile | null
  readonly placements: readonly ClientTokenControlPlacementRef[]
  readonly linkedTrainerSheets?: readonly ClientTokenControlLinkedTrainerSheet[]
}

const asTokenControlPlacements = (
  placements: readonly ClientTokenControlPlacementRef[],
): readonly TokenControlPlacementRef[] => placements

export const buildClientPlayerProfileTokenControlModel = (
  input: BuildClientPlayerProfileTokenControlModelInput,
): PlayerProfileTokenControlModel => buildPlayerProfileTokenControlModel({
  role: input.role,
  profile: input.profile,
  placements: asTokenControlPlacements(input.placements),
  linkedTrainerSheets: input.linkedTrainerSheets,
})

export const clientPlayerProfileControlledPlacementIds = (
  profile: PlayerProfile | null | undefined,
  placements: readonly ClientTokenControlPlacementRef[],
  linkedTrainerSheets?: readonly ClientTokenControlLinkedTrainerSheet[],
): readonly string[] => playerProfileControlledPlacementIds(profile, asTokenControlPlacements(placements), {
  linkedTrainerSheets,
})

export const clientActorControlledPlacementIds = (
  input: BuildClientPlayerProfileTokenControlModelInput,
): readonly string[] => actorControlledPlacementIds({
  role: input.role,
  profile: input.profile,
  placements: asTokenControlPlacements(input.placements),
  linkedTrainerSheets: input.linkedTrainerSheets,
})

export const clientActorCanControlPlacement = (input: {
  readonly role: AuthRole | null | undefined
  readonly profile?: PlayerProfile | null
  readonly placement: ClientTokenControlPlacementRef
  readonly linkedTrainerSheets?: readonly ClientTokenControlLinkedTrainerSheet[]
}): boolean => actorCanControlTokenPlacement({
  role: input.role,
  profile: input.profile,
  placement: input.placement,
  linkedTrainerSheets: input.linkedTrainerSheets,
})

export {
  actorCanControlTokenPlacement,
  actorControlledPlacementIds,
  buildPlayerProfileTokenControlModel,
  linkedCharacterTokenControlKeys,
  playerProfileCanControlTokenPlacement,
  playerProfileCanControlTokenSheet,
  playerProfileControlledPlacementIds,
  playerProfileTokenControlKeys,
  tokenPlacementSheetKey,
  uniqueTokenPlacementIds,
  type BuildPlayerProfileTokenControlModelInput,
  type PlayerProfileTokenControlModel,
  type PlayerProfileTokenControlStatus,
  type TokenControlPlacementRef,
  type TokenPlacementSheetKey,
}
