import type { PlayerProfile, PlayerProfileId } from '#shared/playerProfiles'
import { parsePlayerProfileId } from '#shared/playerProfiles'
import type { SheetKind } from '#shared/sheets'
import { readPlayerProfile } from '../utils/playerProfileStorage'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class PlayerProfilePolicyError extends UseCaseHttpError<400 | 404> {}

export type PlayerSheetAccessSource = 'public-sheet' | 'linked-player-profile' | 'additional-grant'
export type PlayerSheetAccessKey = `${SheetKind}:${string}`

export type PlayerSheetAccessPredicate<TSheet extends { player?: unknown }> = (
  kind: SheetKind,
  slug: string,
  sheet: TSheet,
) => boolean

export interface PlayerProfileLinkedTrainerSheet {
  readonly slug: string
  readonly currentTeam?: readonly unknown[]
  readonly boxedPokemon?: readonly unknown[]
}

export type PlayerProfileLinkedTrainerSheetSource =
  | Iterable<PlayerProfileLinkedTrainerSheet>
  | (() => Iterable<PlayerProfileLinkedTrainerSheet>)

export interface PlayerProfileSheetAccessOptions {
  readonly linkedTrainerSheets?: PlayerProfileLinkedTrainerSheetSource
}

export interface PlayerSheetAccessInput<TSheet extends { player?: unknown }> {
  readonly kind: SheetKind
  readonly slug: string
  readonly sheet: TSheet
  readonly playerProfile?: PlayerProfile | null
  readonly canAccessPlayerSheet?: PlayerSheetAccessPredicate<TSheet>
  readonly linkedTrainerSheets?: PlayerProfileLinkedTrainerSheetSource
}

export interface ResolvePlayerProfileForPolicyDependencies {
  readonly readProfile?: (profileId: PlayerProfileId) => PlayerProfile | null
}

export const playerSheetAccessKey = (kind: SheetKind, slug: string): PlayerSheetAccessKey =>
  `${kind}:${slug}`

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
  source: PlayerProfileLinkedTrainerSheetSource | undefined,
): Iterable<PlayerProfileLinkedTrainerSheet> => {
  if (!source) return []
  return typeof source === 'function' ? source() : source
}

export const playerProfileLinkedTrainerSlugs = (
  profile: PlayerProfile | null | undefined,
): ReadonlySet<string> => new Set(
  (profile?.linkedCharacters ?? [])
    .filter((ref) => ref.sheetKind === 'trainer')
    .map((ref) => ref.sheetSlug),
)

export const playerProfileLinkedTrainerPokemonSlugs = (
  profile: PlayerProfile | null | undefined,
  linkedTrainerSheets: PlayerProfileLinkedTrainerSheetSource | undefined,
): ReadonlySet<string> => {
  const trainerSlugs = playerProfileLinkedTrainerSlugs(profile)
  const pokemonSlugs = new Set<string>()
  if (trainerSlugs.size === 0) return pokemonSlugs

  for (const trainerSheet of resolveLinkedTrainerSheets(linkedTrainerSheets)) {
    if (!trainerSlugs.has(trainerSheet.slug)) continue
    addLinkedPokemonSlugs(pokemonSlugs, trainerSheet.currentTeam)
    addLinkedPokemonSlugs(pokemonSlugs, trainerSheet.boxedPokemon)
  }

  return pokemonSlugs
}

export const playerProfileCanAccessSheet = (
  profile: PlayerProfile | null | undefined,
  kind: SheetKind,
  slug: string,
  options: PlayerProfileSheetAccessOptions = {},
): boolean => {
  if (profile?.linkedCharacters.some(
    (ref) => ref.sheetKind === kind && ref.sheetSlug === slug,
  ) === true) {
    return true
  }

  if (kind !== 'pokemon') return false
  return playerProfileLinkedTrainerPokemonSlugs(profile, options.linkedTrainerSheets).has(slug)
}

export const playerProfileSheetAccessKeys = (
  profile: PlayerProfile | null | undefined,
  options: PlayerProfileSheetAccessOptions = {},
): ReadonlySet<PlayerSheetAccessKey> => {
  const keys = new Set<PlayerSheetAccessKey>(
    (profile?.linkedCharacters ?? []).map((ref) => playerSheetAccessKey(ref.sheetKind, ref.sheetSlug)),
  )

  for (const slug of playerProfileLinkedTrainerPokemonSlugs(profile, options.linkedTrainerSheets)) {
    keys.add(playerSheetAccessKey('pokemon', slug))
  }

  return keys
}

export const playerSheetAccessSource = <TSheet extends { player?: unknown }>(
  input: PlayerSheetAccessInput<TSheet>,
): PlayerSheetAccessSource | null => {
  if (input.sheet.player === true) return 'public-sheet'
  if (playerProfileCanAccessSheet(input.playerProfile, input.kind, input.slug, {
    linkedTrainerSheets: input.linkedTrainerSheets,
  })) {
    return 'linked-player-profile'
  }
  if (input.canAccessPlayerSheet?.(input.kind, input.slug, input.sheet) === true) {
    return 'additional-grant'
  }
  return null
}

export const playerCanAccessSheet = <TSheet extends { player?: unknown }>(
  input: PlayerSheetAccessInput<TSheet>,
): boolean => playerSheetAccessSource(input) !== null

const normalizeOptionalProfileIdInput = (value: unknown): PlayerProfileId | null => {
  if (value === undefined || value === null || value === '') return null
  if (Array.isArray(value)) {
    throw new PlayerProfilePolicyError(400, 'profileId must be a single player profile id')
  }

  try {
    return parsePlayerProfileId(value)
  } catch (error) {
    throw new PlayerProfilePolicyError(
      400,
      error instanceof Error ? error.message : String(error),
    )
  }
}

export const resolvePlayerProfileForPolicy = (
  profileIdInput: unknown,
  dependencies: ResolvePlayerProfileForPolicyDependencies = {},
): PlayerProfile | null => {
  const profileId = normalizeOptionalProfileIdInput(profileIdInput)
  if (profileId === null) return null

  const profile = (dependencies.readProfile ?? readPlayerProfile)(profileId)
  if (!profile) {
    throw new PlayerProfilePolicyError(404, `Player profile ${profileId} not found`)
  }
  return profile
}
