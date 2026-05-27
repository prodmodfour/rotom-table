import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { playerCanAccessSheet } from '../policies/playerProfilePolicy'
import { listSheetFilesWithFolders } from '../utils/sheetStorage'

export type PlayerSheetAccessPredicate = (
  kind: SheetKind,
  slug: string,
  sheet: CharacterSheet | TrainerSheet,
) => boolean

export interface ListSheetsInput {
  role: AuthRole
  playerProfile?: PlayerProfile | null
  canAccessPlayerSheet?: PlayerSheetAccessPredicate
}

export interface ListSheetsDependencies {
  listPokemonSheets?: () => CharacterSheet[]
  listTrainerSheets?: () => TrainerSheet[]
}

export interface ListSheetsResult {
  pokemonSheets: CharacterSheet[]
  trainerSheets: TrainerSheet[]
}

const canListPlayerSheet = <TSheet extends CharacterSheet | TrainerSheet>(
  kind: SheetKind,
  sheet: TSheet,
  input: ListSheetsInput,
): boolean => playerCanAccessSheet({
  kind,
  slug: sheet.slug,
  sheet,
  playerProfile: input.playerProfile,
  canAccessPlayerSheet: input.canAccessPlayerSheet,
})

export const listSheetsUseCase = (
  input: ListSheetsInput,
  dependencies: ListSheetsDependencies = {},
): ListSheetsResult => {
  const listPokemonSheets = dependencies.listPokemonSheets
    ?? (() => listSheetFilesWithFolders<CharacterSheet>('pokemon'))
  const listTrainerSheets = dependencies.listTrainerSheets
    ?? (() => listSheetFilesWithFolders<TrainerSheet>('trainer'))

  const pokemonSheets = listPokemonSheets()
  const trainerSheets = listTrainerSheets()

  if (input.role === 'player') {
    return {
      pokemonSheets: pokemonSheets.filter((sheet) => canListPlayerSheet('pokemon', sheet, input)),
      trainerSheets: trainerSheets.filter((sheet) => canListPlayerSheet('trainer', sheet, input)),
    }
  }

  return { pokemonSheets, trainerSheets }
}
