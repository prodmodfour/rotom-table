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

export interface PlayerSheetAccessInput<TSheet extends { player?: unknown }> {
  readonly kind: SheetKind
  readonly slug: string
  readonly sheet: TSheet
  readonly playerProfile?: PlayerProfile | null
  readonly canAccessPlayerSheet?: PlayerSheetAccessPredicate<TSheet>
}

export interface ResolvePlayerProfileForPolicyDependencies {
  readonly readProfile?: (profileId: PlayerProfileId) => PlayerProfile | null
}

export const playerSheetAccessKey = (kind: SheetKind, slug: string): PlayerSheetAccessKey =>
  `${kind}:${slug}`

export const playerProfileCanAccessSheet = (
  profile: PlayerProfile | null | undefined,
  kind: SheetKind,
  slug: string,
): boolean => profile?.linkedCharacters.some(
  (ref) => ref.sheetKind === kind && ref.sheetSlug === slug,
) === true

export const playerProfileSheetAccessKeys = (
  profile: PlayerProfile | null | undefined,
): ReadonlySet<PlayerSheetAccessKey> => new Set(
  (profile?.linkedCharacters ?? []).map((ref) => playerSheetAccessKey(ref.sheetKind, ref.sheetSlug)),
)

export const playerSheetAccessSource = <TSheet extends { player?: unknown }>(
  input: PlayerSheetAccessInput<TSheet>,
): PlayerSheetAccessSource | null => {
  if (input.sheet.player === true) return 'public-sheet'
  if (playerProfileCanAccessSheet(input.playerProfile, input.kind, input.slug)) {
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
