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
  sheetLibraryCreatedRealtimeAppendInputs,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export interface CreateSheetInput {
  kind: SheetKind
  folder: string
  clientId?: string
}

type CreateSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'create' | 'getByRef'> & {
  readonly database?: RotomDatabase
}

type CreateSheetRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface CreateSheetDependencies {
  database?: RotomDatabase
  sheetRepository?: CreateSheetRepository
  realtimeEventRepository?: CreateSheetRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
  now?: () => number
}

export interface CreateSheetResult {
  ok: true
  kind: SheetKind
  slug: string
  path: string
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const createSheetUseCase = (
  input: CreateSheetInput,
  dependencies: CreateSheetDependencies = {},
): CreateSheetResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Create sheet repository', dependency: dependencies.sheetRepository },
      { label: 'Create sheet realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })

  const transactionResult = database.withTransaction(() => {
    const created = sheetRepository.create({
      kind: input.kind,
      folder: input.folder,
      now: dependencies.now?.(),
    })
    const authoritativeSheet = sheetRepository.getByRef(input.kind, created.slug)
    if (!authoritativeSheet) throw new Error(`${input.kind} sheet ${created.slug} was not readable after create`)
    if (authoritativeSheet.revision !== created.revision || authoritativeSheet.updatedAt !== created.updatedAt) {
      throw new Error(`${input.kind} sheet ${created.slug} authoritative re-read did not match created revision ${created.revision} and timestamp ${created.updatedAt}`)
    }
    const realtimeEvents = realtimeEventRepository.appendMany(
      sheetLibraryCreatedRealtimeAppendInputs(authoritativeSheet, input.clientId),
    )
    return { created, authoritativeSheet, realtimeEvents }
  })

  publishPersistedLibraryRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedLibraryRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultLibraryRealtimePublicationFailureReporter,
  })

  return {
    ok: true,
    kind: input.kind,
    slug: transactionResult.created.slug,
    path: transactionResult.created.path,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
