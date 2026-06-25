import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { SheetKind } from '#shared/sheets'
import type { RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import {
  defaultLibraryRealtimePublicationFailureReporter,
  defaultPersistedLibraryRealtimeEventPublisher,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  resolveLibraryMutationDatabase,
  sheetDeleteMapCleanupRealtimeAppendInputs,
  sheetLibraryDeletedRealtimeAppendInputs,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class DeleteSheetUseCaseError extends UseCaseHttpError<404> {}

export interface DeleteSheetInput {
  kind: SheetKind
  slug: string
  clientId?: string
}

type DeleteSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'deleteDocument'> & {
  readonly database?: RotomDatabase
}

type DeleteSheetRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface DeleteSheetDependencies {
  database?: RotomDatabase
  sheetRepository?: DeleteSheetRepository
  realtimeEventRepository?: DeleteSheetRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
}

export interface DeleteSheetResult {
  ok: true
  path: string
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const deleteSheetUseCase = (
  input: DeleteSheetInput,
  dependencies: DeleteSheetDependencies = {},
): DeleteSheetResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Delete sheet repository', dependency: dependencies.sheetRepository },
      { label: 'Delete sheet realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })

  const transactionResult = database.withTransaction(() => {
    const deleted = sheetRepository.deleteDocument(input.kind, input.slug)
    if (!deleted) throw new DeleteSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

    const realtimeEvents = realtimeEventRepository.appendMany([
      ...sheetLibraryDeletedRealtimeAppendInputs({
        kind: input.kind,
        slug: input.slug,
        revision: deleted.sheet.revision,
        clientId: input.clientId,
      }),
      ...sheetDeleteMapCleanupRealtimeAppendInputs(deleted.mapUpdates, input.clientId),
    ])
    return { path: deleted.path, realtimeEvents }
  })

  publishPersistedLibraryRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedLibraryRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultLibraryRealtimePublicationFailureReporter,
  })

  return {
    ok: true,
    path: transactionResult.path,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
