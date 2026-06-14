import type { AuthRole } from './auth'
import {
  linkedCharacterRefKey,
  type LinkedCharacterRef,
  type PlayerProfile,
} from './playerProfiles'
import type { SheetKind } from './sheets'

export type TokenPlacementSheetKey = `${SheetKind}:${string}`

export interface TokenControlPlacementRef {
  readonly id: string
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
}

export interface PlayerProfileTokenControlLinkedTrainerSheet {
  readonly slug: string
  readonly currentTeam?: readonly unknown[]
  readonly boxedPokemon?: readonly unknown[]
}

export type PlayerProfileTokenControlLinkedTrainerSheetSource =
  | Iterable<PlayerProfileTokenControlLinkedTrainerSheet>
  | (() => Iterable<PlayerProfileTokenControlLinkedTrainerSheet>)

export type PlayerProfileTokenControlStatus =
  | 'guest'
  | 'gm-authority'
  | 'missing-profile'
  | 'linked-profile'
  | 'unlinked-profile'

export interface BuildPlayerProfileTokenControlModelInput {
  readonly role: AuthRole | null | undefined
  readonly profile?: PlayerProfile | null
  readonly placements: readonly TokenControlPlacementRef[]
  readonly linkedTrainerSheets?: PlayerProfileTokenControlLinkedTrainerSheetSource
}

export interface PlayerProfileTokenControlModel {
  readonly status: PlayerProfileTokenControlStatus
  readonly controllablePlacementIds: readonly string[]
  readonly canControlAllTokens: boolean
  readonly requiresProfile: boolean
  readonly notice: string | null
}

export const tokenPlacementSheetKey = (
  placement: Pick<TokenControlPlacementRef, 'sheetKind' | 'sheetSlug'>,
): TokenPlacementSheetKey => linkedCharacterRefKey({
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
}) as TokenPlacementSheetKey

export const linkedCharacterTokenControlKeys = (
  refs: readonly LinkedCharacterRef[],
): ReadonlySet<TokenPlacementSheetKey> => new Set(
  refs.map((ref) => linkedCharacterRefKey(ref) as TokenPlacementSheetKey),
)

const normalizeLinkedPokemonSlug = (slug: unknown): string => (
  typeof slug === 'string' ? slug.trim() : ''
)

const addLinkedPokemonSlugs = (
  out: Set<string>,
  slugs: readonly unknown[] | undefined,
): void => {
  for (const value of slugs ?? []) {
    const slug = normalizeLinkedPokemonSlug(value)
    if (slug) out.add(slug)
  }
}

const resolveLinkedTrainerSheets = (
  source: PlayerProfileTokenControlLinkedTrainerSheetSource | undefined,
): Iterable<PlayerProfileTokenControlLinkedTrainerSheet> => {
  if (!source) return []
  return typeof source === 'function' ? source() : source
}

export const playerProfileTokenControlLinkedTrainerSlugs = (
  profile: PlayerProfile | null | undefined,
): ReadonlySet<string> => new Set(
  (profile?.linkedCharacters ?? [])
    .filter((ref) => ref.sheetKind === 'trainer')
    .map((ref) => ref.sheetSlug),
)

export const playerProfileTokenControlLinkedTrainerPokemonSlugs = (
  profile: PlayerProfile | null | undefined,
  linkedTrainerSheets: PlayerProfileTokenControlLinkedTrainerSheetSource | undefined,
): ReadonlySet<string> => {
  const trainerSlugs = playerProfileTokenControlLinkedTrainerSlugs(profile)
  const pokemonSlugs = new Set<string>()
  if (trainerSlugs.size === 0) return pokemonSlugs

  for (const trainerSheet of resolveLinkedTrainerSheets(linkedTrainerSheets)) {
    if (!trainerSlugs.has(trainerSheet.slug)) continue
    addLinkedPokemonSlugs(pokemonSlugs, trainerSheet.currentTeam)
    addLinkedPokemonSlugs(pokemonSlugs, trainerSheet.boxedPokemon)
  }

  return pokemonSlugs
}

export const playerProfileTokenControlKeys = (
  profile: PlayerProfile | null | undefined,
  options: { readonly linkedTrainerSheets?: PlayerProfileTokenControlLinkedTrainerSheetSource } = {},
): ReadonlySet<TokenPlacementSheetKey> => {
  const keys = new Set<TokenPlacementSheetKey>(linkedCharacterTokenControlKeys(profile?.linkedCharacters ?? []))
  for (const slug of playerProfileTokenControlLinkedTrainerPokemonSlugs(profile, options.linkedTrainerSheets)) {
    keys.add(linkedCharacterRefKey({ sheetKind: 'pokemon', sheetSlug: slug }) as TokenPlacementSheetKey)
  }
  return keys
}

export const playerProfileCanControlTokenSheet = (
  profile: PlayerProfile | null | undefined,
  sheetKind: SheetKind,
  sheetSlug: string,
  options: { readonly linkedTrainerSheets?: PlayerProfileTokenControlLinkedTrainerSheetSource } = {},
): boolean => playerProfileTokenControlKeys(profile, options).has(
  linkedCharacterRefKey({ sheetKind, sheetSlug }) as TokenPlacementSheetKey,
)

export const playerProfileCanControlTokenPlacement = (
  profile: PlayerProfile | null | undefined,
  placement: Pick<TokenControlPlacementRef, 'sheetKind' | 'sheetSlug'>,
  options: { readonly linkedTrainerSheets?: PlayerProfileTokenControlLinkedTrainerSheetSource } = {},
): boolean => playerProfileCanControlTokenSheet(profile, placement.sheetKind, placement.sheetSlug, options)

export const uniqueTokenPlacementIds = (
  placements: readonly Pick<TokenControlPlacementRef, 'id'>[],
): readonly string[] => [...new Set(placements.map((placement) => placement.id))]

export const playerProfileControlledPlacementIds = (
  profile: PlayerProfile | null | undefined,
  placements: readonly TokenControlPlacementRef[],
  options: { readonly linkedTrainerSheets?: PlayerProfileTokenControlLinkedTrainerSheetSource } = {},
): readonly string[] => {
  const controlKeys = playerProfileTokenControlKeys(profile, options)
  if (controlKeys.size === 0) return []

  return uniqueTokenPlacementIds(placements.filter((placement) => (
    controlKeys.has(tokenPlacementSheetKey(placement))
  )))
}

export const actorControlledPlacementIds = (
  input: BuildPlayerProfileTokenControlModelInput,
): readonly string[] => {
  if (input.role === 'gm') return uniqueTokenPlacementIds(input.placements)
  if (input.role !== 'player') return []
  return playerProfileControlledPlacementIds(input.profile, input.placements, {
    linkedTrainerSheets: input.linkedTrainerSheets,
  })
}

export const actorCanControlTokenPlacement = (
  input: Omit<BuildPlayerProfileTokenControlModelInput, 'placements'> & {
    readonly placement: TokenControlPlacementRef
  },
): boolean => {
  if (input.role === 'gm') return true
  if (input.role !== 'player') return false
  return playerProfileCanControlTokenPlacement(input.profile, input.placement, {
    linkedTrainerSheets: input.linkedTrainerSheets,
  })
}

export const buildPlayerProfileTokenControlModel = (
  input: BuildPlayerProfileTokenControlModelInput,
): PlayerProfileTokenControlModel => {
  if (input.role === 'gm') {
    return {
      status: 'gm-authority',
      controllablePlacementIds: uniqueTokenPlacementIds(input.placements),
      canControlAllTokens: true,
      requiresProfile: false,
      notice: null,
    }
  }

  if (input.role !== 'player') {
    return {
      status: 'guest',
      controllablePlacementIds: [],
      canControlAllTokens: false,
      requiresProfile: false,
      notice: null,
    }
  }

  if (!input.profile) {
    return {
      status: 'missing-profile',
      controllablePlacementIds: [],
      canControlAllTokens: false,
      requiresProfile: true,
      notice: 'Choose a player profile before controlling map tokens.',
    }
  }

  const controllablePlacementIds = playerProfileControlledPlacementIds(input.profile, input.placements, {
    linkedTrainerSheets: input.linkedTrainerSheets,
  })

  if (controllablePlacementIds.length > 0) {
    return {
      status: 'linked-profile',
      controllablePlacementIds,
      canControlAllTokens: false,
      requiresProfile: false,
      notice: null,
    }
  }

  return {
    status: 'unlinked-profile',
    controllablePlacementIds,
    canControlAllTokens: false,
    requiresProfile: false,
    notice: 'This player profile has no linked characters on this map.',
  }
}
