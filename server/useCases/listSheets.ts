import type { AuthRole } from '#shared/auth'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { listSheetFilesWithFolders } from '../utils/sheetStorage'

export type PlayerSheetAccessPredicate = (
  kind: SheetKind,
  slug: string,
  sheet: CharacterSheet | TrainerSheet,
) => boolean

export interface ListSheetsInput {
  role: AuthRole
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

const isPlayerAccessible = (sheet: { player?: unknown }): boolean => sheet.player === true

const canListPlayerSheet = <TSheet extends CharacterSheet | TrainerSheet>(
  kind: SheetKind,
  sheet: TSheet,
  canAccessPlayerSheet?: PlayerSheetAccessPredicate,
): boolean => isPlayerAccessible(sheet) || canAccessPlayerSheet?.(kind, sheet.slug, sheet) === true

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
      pokemonSheets: pokemonSheets.filter((sheet) => canListPlayerSheet('pokemon', sheet, input.canAccessPlayerSheet)),
      trainerSheets: trainerSheets.filter((sheet) => canListPlayerSheet('trainer', sheet, input.canAccessPlayerSheet)),
    }
  }

  return { pokemonSheets, trainerSheets }
}
