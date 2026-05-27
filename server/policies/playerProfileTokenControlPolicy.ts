import type { AuthRole } from '#shared/auth'
import {
  actorCanControlTokenPlacement,
  actorControlledPlacementIds,
  buildPlayerProfileTokenControlModel,
  playerProfileCanControlTokenSheet,
  playerProfileControlledPlacementIds,
  playerProfileTokenControlKeys,
  type PlayerProfileTokenControlModel,
  type TokenControlPlacementRef,
} from '#shared/playerProfileTokenControl'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetKind, SheetPlacement } from '~/types/map'

export type ServerTokenControlPlacementRef = Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>

export type ServerTokenControlSheetPredicate = (kind: SheetKind, slug: string) => boolean

export interface BuildServerPlayerProfileTokenControlModelInput {
  readonly role: AuthRole | null | undefined
  readonly profile?: PlayerProfile | null
  readonly placements: readonly ServerTokenControlPlacementRef[]
}

const asTokenControlPlacements = (
  placements: readonly ServerTokenControlPlacementRef[],
): readonly TokenControlPlacementRef[] => placements

export const playerProfileTokenControlSheetPredicate = (
  profile: PlayerProfile | null | undefined,
): ServerTokenControlSheetPredicate => (
  kind,
  slug,
) => playerProfileCanControlTokenSheet(profile, kind, slug)

export const playerProfileControlledMapPlacementIds = (
  profile: PlayerProfile | null | undefined,
  placements: readonly ServerTokenControlPlacementRef[],
): readonly string[] => playerProfileControlledPlacementIds(profile, asTokenControlPlacements(placements))

export const actorControlledMapPlacementIds = (
  input: BuildServerPlayerProfileTokenControlModelInput,
): readonly string[] => actorControlledPlacementIds({
  role: input.role,
  profile: input.profile,
  placements: asTokenControlPlacements(input.placements),
})

export const actorCanControlMapPlacement = (input: {
  readonly role: AuthRole | null | undefined
  readonly profile?: PlayerProfile | null
  readonly placement: ServerTokenControlPlacementRef
}): boolean => actorCanControlTokenPlacement({
  role: input.role,
  profile: input.profile,
  placement: input.placement,
})

export const buildServerPlayerProfileTokenControlModel = (
  input: BuildServerPlayerProfileTokenControlModelInput,
): PlayerProfileTokenControlModel => buildPlayerProfileTokenControlModel({
  role: input.role,
  profile: input.profile,
  placements: asTokenControlPlacements(input.placements),
})

export { playerProfileTokenControlKeys }
