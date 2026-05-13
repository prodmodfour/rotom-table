import type { AuthRole } from '#shared/auth'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { listSheetFilesWithFolders } from '../utils/sheetStorage'

export interface ListSheetsInput {
  role: AuthRole
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
      pokemonSheets: pokemonSheets.filter(isPlayerAccessible),
      trainerSheets: trainerSheets.filter(isPlayerAccessible),
    }
  }

  return { pokemonSheets, trainerSheets }
}
