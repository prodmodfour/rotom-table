import type { AuthRole } from '#shared/auth'
import {
  actorCanControlTokenPlacement,
  actorControlledPlacementIds,
  buildPlayerProfileTokenControlModel,
  playerProfileCanControlTokenSheet,
  playerProfileControlledPlacementIds,
  playerProfileTokenControlKeys,
  playerProfileTokenControlLinkedTrainerSlugs,
  type PlayerProfileTokenControlLinkedTrainerSheet,
  type PlayerProfileTokenControlModel,
  type TokenControlPlacementRef,
} from '#shared/playerProfileTokenControl'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetKind, SheetPlacement } from '~/types/map'

export type ServerTokenControlPlacementRef = Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>
export type ServerTokenControlLinkedTrainerSheet = PlayerProfileTokenControlLinkedTrainerSheet

export type ServerTokenControlSheetPredicate = (kind: SheetKind, slug: string) => boolean

export interface BuildServerPlayerProfileTokenControlModelInput {
  readonly role: AuthRole | null | undefined
  readonly profile?: PlayerProfile | null
  readonly placements: readonly ServerTokenControlPlacementRef[]
  readonly linkedTrainerSheets?: readonly ServerTokenControlLinkedTrainerSheet[]
}

const asTokenControlPlacements = (
  placements: readonly ServerTokenControlPlacementRef[],
): readonly TokenControlPlacementRef[] => placements

export const playerProfileTokenControlSheetPredicate = (
  profile: PlayerProfile | null | undefined,
  linkedTrainerSheets?: readonly ServerTokenControlLinkedTrainerSheet[],
): ServerTokenControlSheetPredicate => (
  kind,
  slug,
) => playerProfileCanControlTokenSheet(profile, kind, slug, { linkedTrainerSheets })

export const playerProfileControlledMapPlacementIds = (
  profile: PlayerProfile | null | undefined,
  placements: readonly ServerTokenControlPlacementRef[],
  linkedTrainerSheets?: readonly ServerTokenControlLinkedTrainerSheet[],
): readonly string[] => playerProfileControlledPlacementIds(profile, asTokenControlPlacements(placements), {
  linkedTrainerSheets,
})

export const actorControlledMapPlacementIds = (
  input: BuildServerPlayerProfileTokenControlModelInput,
): readonly string[] => actorControlledPlacementIds({
  role: input.role,
  profile: input.profile,
  placements: asTokenControlPlacements(input.placements),
  linkedTrainerSheets: input.linkedTrainerSheets,
})

export const actorCanControlMapPlacement = (input: {
  readonly role: AuthRole | null | undefined
  readonly profile?: PlayerProfile | null
  readonly placement: ServerTokenControlPlacementRef
  readonly linkedTrainerSheets?: readonly ServerTokenControlLinkedTrainerSheet[]
}): boolean => actorCanControlTokenPlacement({
  role: input.role,
  profile: input.profile,
  placement: input.placement,
  linkedTrainerSheets: input.linkedTrainerSheets,
})

export const buildServerPlayerProfileTokenControlModel = (
  input: BuildServerPlayerProfileTokenControlModelInput,
): PlayerProfileTokenControlModel => buildPlayerProfileTokenControlModel({
  role: input.role,
  profile: input.profile,
  placements: asTokenControlPlacements(input.placements),
  linkedTrainerSheets: input.linkedTrainerSheets,
})

export const playerProfileLinkedTrainerSheetsForTokenControl = (
  profile: PlayerProfile | null | undefined,
  readTrainerSheet: (slug: string) => ServerTokenControlLinkedTrainerSheet | null | undefined,
): readonly ServerTokenControlLinkedTrainerSheet[] => {
  const sheets: ServerTokenControlLinkedTrainerSheet[] = []
  for (const slug of playerProfileTokenControlLinkedTrainerSlugs(profile)) {
    const sheet = readTrainerSheet(slug)
    if (sheet) sheets.push(sheet)
  }
  return sheets
}

export const playerProfileLinkedTrainerSheetsForTokenControlAsync = async (
  profile: PlayerProfile | null | undefined,
  readTrainerSheet: (slug: string) => Promise<ServerTokenControlLinkedTrainerSheet | null | undefined>,
): Promise<readonly ServerTokenControlLinkedTrainerSheet[]> => {
  const sheets: ServerTokenControlLinkedTrainerSheet[] = []
  for (const slug of playerProfileTokenControlLinkedTrainerSlugs(profile)) {
    const sheet = await readTrainerSheet(slug)
    if (sheet) sheets.push(sheet)
  }
  return sheets
}

export { playerProfileTokenControlKeys }
