import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sanitizeFolderPath } from '#shared/paths'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository, type DeleteSheetDocumentResult, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import {
  defaultLibraryRealtimePublicationFailureReporter,
  defaultPersistedLibraryRealtimeEventPublisher,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  resolveLibraryMutationDatabase,
  sheetDeleteMapCleanupRealtimeAppendInputs,
  sheetFolderDeletedRealtimeAppendInputs,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class DeleteSheetFolderUseCaseError extends UseCaseHttpError<400 | 404> {}

export interface DeleteSheetFolderInput {
  folder?: unknown
  clientId?: string
}

type DeleteSheetFolderRepository = Pick<SheetRepository, 'deleteFolder'> & {
  readonly database?: RotomDatabase
}

type DeleteSheetFolderRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface DeleteSheetFolderDependencies {
  database?: RotomDatabase
  sheetRepository?: DeleteSheetFolderRepository
  deleteFolder?: (folder: string) => { count: number; removed: readonly string[]; deletedSheetResults?: readonly DeleteSheetDocumentResult[] } | null
  realtimeEventRepository?: DeleteSheetFolderRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
}

export interface DeleteSheetFolderResult {
  ok: true
  count: number
  removed: string[]
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const normalizeDeleteSheetFolderPath = (value: unknown): string => {
  try {
    return sanitizeFolderPath(String(value ?? ''))
  } catch (err) {
    throw new DeleteSheetFolderUseCaseError(400, (err as Error).message)
  }
}

export const deleteSheetFolderUseCase = (
  input: DeleteSheetFolderInput,
  dependencies: DeleteSheetFolderDependencies = {},
): DeleteSheetFolderResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Delete sheet folder repository', dependency: dependencies.sheetRepository },
      { label: 'Delete sheet folder realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const deleteFolder = dependencies.deleteFolder ?? ((folder: string) => sheetRepository.deleteFolder(folder))
  const folder = normalizeDeleteSheetFolderPath(input.folder)

  const transactionResult = database.withTransaction(() => {
    const result = deleteFolder(folder)
    if (!result) throw new DeleteSheetFolderUseCaseError(404, `Folder "${folder}" not found`)

    const deletedResults = result.deletedSheetResults ?? []
    const realtimeEvents = realtimeEventRepository.appendMany([
      ...sheetFolderDeletedRealtimeAppendInputs({
        folder,
        deletedSheets: deletedResults.map((deleted) => deleted.sheet),
        clientId: input.clientId,
      }),
      ...deletedResults.flatMap((deleted) => sheetDeleteMapCleanupRealtimeAppendInputs(deleted.mapUpdates, input.clientId)),
    ])
    return { result, realtimeEvents }
  })

  publishPersistedLibraryRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedLibraryRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultLibraryRealtimePublicationFailureReporter,
  })

  return {
    ok: true,
    count: transactionResult.result.count,
    removed: [...transactionResult.result.removed],
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
