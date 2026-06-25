import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sanitizeFolderPath } from '#shared/paths'
import { SHEET_KINDS, type SheetKind } from '#shared/sheets'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import { logicalSheetFolderPath } from '../utils/runtimeResourcePaths'
import {
  defaultLibraryRealtimePublicationFailureReporter,
  defaultPersistedLibraryRealtimeEventPublisher,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  resolveLibraryMutationDatabase,
  sheetFolderCreatedRealtimeAppendInputs,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class CreateSheetFolderUseCaseError extends UseCaseHttpError<400> {}

export interface CreateSheetFolderInput {
  folder?: unknown
  clientId?: string
}

type CreateSheetFolderRepository = Pick<SheetRepository, 'createFolder'> & {
  readonly database?: RotomDatabase
}

type CreateSheetFolderRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface CreateSheetFolderDependencies {
  database?: RotomDatabase
  sheetRepository?: CreateSheetFolderRepository
  createFolder?: (folder: string) => { created: boolean; path: string; folder: string }
  now?: () => number
  realtimeEventRepository?: CreateSheetFolderRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
}

export interface CreateSheetFolderResult {
  ok: true
  created: boolean
  path: string
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const normalizeCreateSheetFolderPath = (value: unknown): string => {
  try {
    return sanitizeFolderPath(String(value ?? ''))
  } catch (err) {
    throw new CreateSheetFolderUseCaseError(400, (err as Error).message)
  }
}

export const createSheetFolderUseCase = (
  input: CreateSheetFolderInput,
  dependencies: CreateSheetFolderDependencies = {},
): CreateSheetFolderResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Create sheet folder repository', dependency: dependencies.sheetRepository },
      { label: 'Create sheet folder realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const createFolder = dependencies.createFolder
  const folder = normalizeCreateSheetFolderPath(input.folder)

  const transactionResult = database.withTransaction(() => {
    if (createFolder) {
      const result = createFolder(folder)
      const realtimeEvents = result.created
        ? realtimeEventRepository.appendMany(sheetFolderCreatedRealtimeAppendInputs(result.folder, input.clientId))
        : []
      return { created: result.created, path: result.path, realtimeEvents }
    }

    let created = false
    for (const kind of SHEET_KINDS) {
      const result = sheetRepository.createFolder(kind as SheetKind, folder, dependencies.now?.())
      created = created || result.created
    }
    const realtimeEvents = created
      ? realtimeEventRepository.appendMany(sheetFolderCreatedRealtimeAppendInputs(folder, input.clientId))
      : []
    return { created, path: logicalSheetFolderPath('pokemon', folder), realtimeEvents }
  })

  publishPersistedLibraryRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedLibraryRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultLibraryRealtimePublicationFailureReporter,
  })

  return {
    ok: true,
    created: transactionResult.created,
    path: transactionResult.path,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
