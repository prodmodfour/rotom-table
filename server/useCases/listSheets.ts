import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { playerCanAccessSheet } from '../policies/playerProfilePolicy'
import {
  sqliteSheetRepository,
  type SheetRepository,
  type StoredSheetDocument,
} from '../storage/sheetRepository'

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

type ListSheetsRepository = Pick<SheetRepository<Record<string, unknown>>, 'list'>

export interface ListSheetsDependencies {
  listPokemonSheets?: () => CharacterSheet[]
  listTrainerSheets?: () => TrainerSheet[]
  sheetRepository?: ListSheetsRepository
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

const storedSheetDocumentToSheet = <TSheet extends CharacterSheet | TrainerSheet>(
  stored: StoredSheetDocument<Record<string, unknown>>,
): TSheet => ({
  ...stored.document,
  slug: stored.slug,
  revision: stored.revision,
}) as TSheet

const listRepositorySheets = <TSheet extends CharacterSheet | TrainerSheet>(
  repository: ListSheetsRepository,
  kind: SheetKind,
): TSheet[] => repository.list(kind).map((stored) => storedSheetDocumentToSheet<TSheet>(
  stored as StoredSheetDocument<Record<string, unknown>>,
))

export const listSheetsUseCase = (
  input: ListSheetsInput,
  dependencies: ListSheetsDependencies = {},
): ListSheetsResult => {
  const sheetRepository = dependencies.sheetRepository ?? (sqliteSheetRepository as ListSheetsRepository)
  const listPokemonSheets = dependencies.listPokemonSheets
    ?? (() => listRepositorySheets<CharacterSheet>(sheetRepository, 'pokemon'))
  const listTrainerSheets = dependencies.listTrainerSheets
    ?? (() => listRepositorySheets<TrainerSheet>(sheetRepository, 'trainer'))

  const pokemonSheets = listPokemonSheets()
  const trainerSheets = listTrainerSheets()

  if (input.role === 'player') {
    return {
      pokemonSheets: pokemonSheets.filter((sheet) => playerCanAccessSheet({
        kind: 'pokemon',
        slug: sheet.slug,
        sheet,
        playerProfile: input.playerProfile,
        canAccessPlayerSheet: input.canAccessPlayerSheet,
        linkedTrainerSheets: trainerSheets,
      })),
      trainerSheets: trainerSheets.filter((sheet) => canListPlayerSheet('trainer', sheet, input)),
    }
  }

  return { pokemonSheets, trainerSheets }
}
