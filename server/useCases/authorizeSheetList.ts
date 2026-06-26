import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  playerCanAccessSheet,
  playerProfileCanAccessSheet,
  playerSheetAccessKey,
  type PlayerSheetAccessKey,
} from '../policies/playerProfilePolicy'
import { redactSheetForPlayer } from '../utils/sheetPrivacy'

export type AuthorizableSheet = CharacterSheet | TrainerSheet

export type PlayerSheetAccessPredicate = (
  kind: SheetKind,
  slug: string,
  sheet: AuthorizableSheet,
) => boolean

export interface PlayerAccessMarkerOptions {
  readonly sessionAccessible?: PlayerSheetAccessPredicate
}

export interface AuthorizeSheetListInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
  readonly canAccessPlayerSheet?: PlayerSheetAccessPredicate
  readonly markPlayerAccess?: PlayerAccessMarkerOptions
}

export interface AuthorizedSheetList {
  readonly pokemonSheets: CharacterSheet[]
  readonly trainerSheets: TrainerSheet[]
}

export interface PlayerSheetAccessContextInput {
  readonly sessionAccessKeys?: ReadonlySet<PlayerSheetAccessKey> | null
  readonly mapSheetAccessKeys?: ReadonlySet<PlayerSheetAccessKey> | null
}

export interface PlayerSheetAccessContext {
  readonly canAccessPlayerSheet: PlayerSheetAccessPredicate
  readonly markPlayerAccess: PlayerAccessMarkerOptions
}

const keySetHasSheet = (
  keys: ReadonlySet<PlayerSheetAccessKey> | null | undefined,
  kind: SheetKind,
  slug: string,
): boolean => keys?.has(playerSheetAccessKey(kind, slug)) === true

export const playerSheetAccessContextFromKeys = (
  input: PlayerSheetAccessContextInput,
): PlayerSheetAccessContext => {
  const canAccessPlayerSheet: PlayerSheetAccessPredicate = (kind, slug) => (
    keySetHasSheet(input.sessionAccessKeys, kind, slug)
    || keySetHasSheet(input.mapSheetAccessKeys, kind, slug)
  )

  const sessionAccessible: PlayerSheetAccessPredicate = (kind, slug) => (
    keySetHasSheet(input.sessionAccessKeys, kind, slug)
  )

  return {
    canAccessPlayerSheet,
    markPlayerAccess: { sessionAccessible },
  }
}

const markPlayerAccessibleSheet = <TSheet extends AuthorizableSheet>(
  sheet: TSheet,
  options: { readonly sessionAccessible: boolean; readonly profileAccessible: boolean },
): TSheet => {
  if (!options.sessionAccessible && !options.profileAccessible) return sheet

  return {
    ...sheet,
    ...(options.sessionAccessible ? { sessionPlayerAccessible: true } : {}),
    ...(options.profileAccessible ? { playerProfileAccessible: true } : {}),
  } as TSheet
}

const canListPlayerSheet = <TSheet extends AuthorizableSheet>(
  kind: SheetKind,
  sheet: TSheet,
  input: AuthorizeSheetListInput,
  linkedTrainerSheets?: readonly TrainerSheet[],
): boolean => playerCanAccessSheet({
  kind,
  slug: sheet.slug,
  sheet,
  playerProfile: input.playerProfile,
  canAccessPlayerSheet: input.canAccessPlayerSheet,
  linkedTrainerSheets,
})

const markAuthorizedPokemonSheets = (
  sheets: readonly CharacterSheet[],
  input: AuthorizeSheetListInput,
  linkedTrainerSheets: readonly TrainerSheet[],
): CharacterSheet[] => sheets.map((sheet) => markPlayerAccessibleSheet(
  sheet,
  {
    sessionAccessible: input.markPlayerAccess?.sessionAccessible?.('pokemon', sheet.slug, sheet) === true,
    profileAccessible: playerProfileCanAccessSheet(input.playerProfile, 'pokemon', sheet.slug, { linkedTrainerSheets }),
  },
))

const markAuthorizedTrainerSheets = (
  sheets: readonly TrainerSheet[],
  input: AuthorizeSheetListInput,
): TrainerSheet[] => sheets.map((sheet) => markPlayerAccessibleSheet(
  sheet,
  {
    sessionAccessible: input.markPlayerAccess?.sessionAccessible?.('trainer', sheet.slug, sheet) === true,
    profileAccessible: playerProfileCanAccessSheet(input.playerProfile, 'trainer', sheet.slug),
  },
))

export const authorizeSheetList = (input: AuthorizeSheetListInput): AuthorizedSheetList => {
  if (input.role !== 'player') {
    return {
      pokemonSheets: [...input.pokemonSheets],
      trainerSheets: [...input.trainerSheets],
    }
  }

  const trainerSheets = input.trainerSheets.filter((sheet) => canListPlayerSheet('trainer', sheet, input))
  const pokemonSheets = input.pokemonSheets.filter((sheet) => canListPlayerSheet(
    'pokemon',
    sheet,
    input,
    input.trainerSheets,
  ))

  if (!input.markPlayerAccess) {
    return {
      pokemonSheets: pokemonSheets.map((sheet) => redactSheetForPlayer('pokemon', sheet)),
      trainerSheets,
    }
  }

  return {
    pokemonSheets: markAuthorizedPokemonSheets(pokemonSheets, input, trainerSheets)
      .map((sheet) => redactSheetForPlayer('pokemon', sheet)),
    trainerSheets: markAuthorizedTrainerSheets(trainerSheets, input),
  }
}
