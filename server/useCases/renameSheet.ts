import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { SheetKind } from '#shared/sheets'
import type { RotomDatabase } from '../storage/database'
import {
  createSqliteSheetRepository,
  type RenameSheetDocumentInput,
  type RenameSheetDocumentResult,
  type SheetRepository,
} from '../storage/sheetRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import {
  defaultLibraryRealtimePublicationFailureReporter,
  defaultPersistedLibraryRealtimeEventPublisher,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  resolveLibraryMutationDatabase,
  sheetLibraryRenamedRealtimeAppendInputs,
  sheetRenameMapRetargetRealtimeAppendInputs,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class RenameSheetUseCaseError extends UseCaseHttpError<404 | 409 | 500> {}

export interface RenameSheetInput {
  kind: SheetKind
  slug: string
  name: string
  clientId?: string
}

type RenameSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'rename' | 'getByRef'> & {
  readonly database?: RotomDatabase
}

type RenameSheetRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface RenameSheetDependencies {
  database?: RotomDatabase
  sheetRepository?: RenameSheetRepository
  realtimeEventRepository?: RenameSheetRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
  now?: () => number
  failAfterSheetUpdate?: () => void
}

export interface RenameSheetResult {
  ok: true
  slug: string
  name: string
  path: string
  sheet: Record<string, unknown>
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const renameSheetUseCase = (
  input: RenameSheetInput,
  dependencies: RenameSheetDependencies = {},
): RenameSheetResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Rename sheet repository', dependency: dependencies.sheetRepository },
      { label: 'Rename sheet realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })

  const transactionResult = database.withTransaction(() => {
    let renamed: RenameSheetDocumentResult | null
    try {
      renamed = sheetRepository.rename({
        kind: input.kind,
        slug: input.slug,
        name: input.name,
        now: dependencies.now?.(),
        failAfterSheetUpdate: dependencies.failAfterSheetUpdate,
      } as RenameSheetDocumentInput)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('already exists') || message.includes('UNIQUE')) throw new RenameSheetUseCaseError(409, message)
      throw new RenameSheetUseCaseError(500, `Failed to rename sheet: ${message}`)
    }

    if (!renamed) throw new RenameSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)

    const authoritativeSheet = renamed.changed
      ? sheetRepository.getByRef(input.kind, renamed.newSlug)
      : renamed.sheet
    if (!authoritativeSheet) throw new Error(`${input.kind} sheet ${renamed.newSlug} was not readable after rename`)
    if (renamed.changed && (authoritativeSheet.revision !== renamed.sheet.revision || authoritativeSheet.updatedAt !== renamed.sheet.updatedAt)) {
      throw new Error(`${input.kind} sheet ${renamed.newSlug} authoritative re-read did not match renamed revision ${renamed.sheet.revision} and timestamp ${renamed.sheet.updatedAt}`)
    }

    const realtimeEvents = renamed.changed
      ? realtimeEventRepository.appendMany([
          ...sheetLibraryRenamedRealtimeAppendInputs({
            oldSlug: input.slug,
            sheet: authoritativeSheet,
            renamed: renamed.renamed,
            clientId: input.clientId,
          }),
          ...sheetRenameMapRetargetRealtimeAppendInputs(renamed.mapUpdates, input.clientId),
        ])
      : []

    return { renamed, authoritativeSheet, realtimeEvents }
  })

  publishPersistedLibraryRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedLibraryRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultLibraryRealtimePublicationFailureReporter,
  })

  return {
    ok: true,
    slug: transactionResult.renamed.newSlug,
    name: input.name,
    path: transactionResult.renamed.path,
    sheet: transactionResult.authoritativeSheet.sheet,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
