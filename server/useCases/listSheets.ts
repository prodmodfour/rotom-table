import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  authorizeSheetList,
  type PlayerAccessMarkerOptions,
  type PlayerSheetAccessPredicate,
} from './authorizeSheetList'
import { projectSheetEquipmentContributions } from '../utils/sheetPrivacy'
import {
  sqliteSheetRepository,
  type SheetRepository,
  type StoredSheetDocument,
} from '../storage/sheetRepository'

export interface ListSheetsInput {
  role: AuthRole
  playerProfile?: PlayerProfile | null
  canAccessPlayerSheet?: PlayerSheetAccessPredicate
  markPlayerAccess?: PlayerAccessMarkerOptions
}

export type ListSheetsRepository = Pick<SheetRepository<Record<string, unknown>>, 'list'>

export interface ListSheetsDependencies {
  listPokemonSheets?: () => CharacterSheet[]
  listTrainerSheets?: () => TrainerSheet[]
  sheetRepository?: ListSheetsRepository
  /** @deprecated SQLite sheet documents now carry authoritative folders. */
  sheetFoldersBySlug?: unknown
}

export interface ListSheetsResult {
  pokemonSheets: CharacterSheet[]
  trainerSheets: TrainerSheet[]
}

export const storedSheetDocumentToSheet = <TSheet extends CharacterSheet | TrainerSheet>(
  stored: StoredSheetDocument<Record<string, unknown>>,
): TSheet => {
  if (!stored.document || typeof stored.document !== 'object' || Array.isArray(stored.document)) {
    throw new Error(`SQLite ${stored.kind} sheet ${stored.slug} document must be an object`)
  }

  return {
    ...stored.document,
    slug: stored.slug,
    revision: stored.revision,
    folder: typeof stored.document.folder === 'string' ? stored.document.folder : '',
  } as TSheet
}

export const listRepositorySheets = <TSheet extends CharacterSheet | TrainerSheet>(
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

  const authorized = authorizeSheetList({
    role: input.role,
    playerProfile: input.playerProfile,
    canAccessPlayerSheet: input.canAccessPlayerSheet,
    markPlayerAccess: input.markPlayerAccess,
    pokemonSheets,
    trainerSheets,
  })

  if (input.role === 'player') return authorized
  return {
    pokemonSheets: authorized.pokemonSheets.map((sheet) => projectSheetEquipmentContributions(
      'pokemon',
      sheet as unknown as Record<string, unknown>,
    ) as unknown as CharacterSheet),
    trainerSheets: authorized.trainerSheets.map((sheet) => projectSheetEquipmentContributions(
      'trainer',
      sheet as unknown as Record<string, unknown>,
    ) as unknown as TrainerSheet),
  }
}
