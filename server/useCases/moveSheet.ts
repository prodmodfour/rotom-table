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
  sheetLibraryMovedRealtimeAppendInputs,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class MoveSheetUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface MoveSheetInput {
  kind: SheetKind
  slug: string
  folder: string
  clientId?: string
}

type MoveSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'moveToFolder' | 'getByRef'> & {
  readonly database?: RotomDatabase
}

type MoveSheetRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface MoveSheetDependencies {
  database?: RotomDatabase
  sheetRepository?: MoveSheetRepository
  realtimeEventRepository?: MoveSheetRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
  now?: () => number
}

export interface MoveSheetResult {
  ok: true
  moved: boolean
  path: string
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const moveSheetUseCase = (
  input: MoveSheetInput,
  dependencies: MoveSheetDependencies = {},
): MoveSheetResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Move sheet repository', dependency: dependencies.sheetRepository },
      { label: 'Move sheet realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })

  const transactionResult = database.withTransaction(() => {
    let moved
    try {
      moved = sheetRepository.moveToFolder({
        kind: input.kind,
        slug: input.slug,
        folder: input.folder,
        now: dependencies.now?.(),
      })
    } catch (err) {
      const message = (err as Error).message
      if (message.includes('already exists')) throw new MoveSheetUseCaseError(409, message)
      throw new MoveSheetUseCaseError(400, message)
    }

    if (!moved) throw new MoveSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

    const authoritativeSheet = moved.moved
      ? sheetRepository.getByRef(input.kind, input.slug)
      : moved.sheet
    if (!authoritativeSheet) throw new MoveSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)
    if (moved.moved && (authoritativeSheet.revision !== moved.sheet.revision || authoritativeSheet.updatedAt !== moved.sheet.updatedAt)) {
      throw new Error(`${input.kind} sheet ${input.slug} authoritative re-read did not match moved revision ${moved.sheet.revision} and timestamp ${moved.sheet.updatedAt}`)
    }
    const realtimeEvents = moved.moved
      ? realtimeEventRepository.appendMany(sheetLibraryMovedRealtimeAppendInputs(authoritativeSheet, moved.folder, input.clientId))
      : []

    return { moved, realtimeEvents }
  })

  publishPersistedLibraryRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedLibraryRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultLibraryRealtimePublicationFailureReporter,
  })

  return {
    ok: true,
    moved: transactionResult.moved.moved,
    path: transactionResult.moved.path,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
