import type { SheetKind } from '#shared/sheets'
import type { TrainerSheet } from '~/types/trainerSheet'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteMapRepository,
  type MapRepository,
} from '../storage/mapRepository'
import {
  createSqliteSheetRepository,
  type SheetRepository,
} from '../storage/sheetRepository'
import { sqlitePlayerVisibleMapSheetAccessKeys } from '../utils/mapSheetAccess'
import type {
  RealtimeEventAccessDependencies,
  RealtimePolicyPersistedSheet,
} from './realtimeEventAccessPolicy'

export interface SqliteRealtimeEventAccessAdapterOptions {
  readonly database?: RotomDatabase
  readonly mapRepository?: Pick<MapRepository, 'getBySlug' | 'list'>
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'list'>
}

const defaultDatabase = (database: RotomDatabase | undefined): RotomDatabase => database ?? getRotomDatabase()

const defaultMapRepository = (
  database: RotomDatabase,
): Pick<MapRepository, 'getBySlug' | 'list'> => createSqliteMapRepository(database)

const defaultSheetRepository = (
  database: RotomDatabase,
): Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'list'> => createSqliteSheetRepository<Record<string, unknown>>(database)

const trainerSheetFromStored = (
  stored: ReturnType<Pick<SheetRepository<Record<string, unknown>>, 'list'>['list']>[number],
): TrainerSheet => {
  const document = stored.document as Record<string, unknown>
  return {
    ...document,
    slug: stored.slug,
    revision: stored.revision,
    updatedAt: stored.updatedAt,
    folder: typeof document.folder === 'string' ? document.folder : '',
  } as unknown as TrainerSheet
}

const persistedSheetForPolicy = (
  sheetRepository: Pick<SheetRepository<Record<string, unknown>>, 'getByRef'>,
  kind: SheetKind,
  slug: string,
): RealtimePolicyPersistedSheet | null => {
  const persisted = sheetRepository.getByRef(kind, slug)
  if (!persisted) return null
  return {
    kind: persisted.kind,
    slug: persisted.slug,
    sheet: persisted.sheet,
    revision: persisted.revision,
    updatedAt: persisted.updatedAt,
  }
}

export const createSqliteRealtimeEventAccessDependencies = (
  options: SqliteRealtimeEventAccessAdapterOptions = {},
): RealtimeEventAccessDependencies => {
  const database = defaultDatabase(options.database)
  const mapRepository = options.mapRepository ?? defaultMapRepository(database)
  const sheetRepository = options.sheetRepository ?? defaultSheetRepository(database)

  return {
    getMap: (slug) => mapRepository.getBySlug(slug),
    getSheet: (kind, slug) => persistedSheetForPolicy(sheetRepository, kind, slug),
    listTrainerSheets: () => sheetRepository.list('trainer').map(trainerSheetFromStored),
    playerVisibleMapSheetAccessKeys: () => sqlitePlayerVisibleMapSheetAccessKeys(mapRepository),
  }
}
