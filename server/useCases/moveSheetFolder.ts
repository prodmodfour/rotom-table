import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sanitizeFolderPath } from '#shared/paths'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { SheetKind } from '#shared/sheets'
import type { RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository, type PersistedSheet, type SheetRepository } from '../storage/sheetRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import {
  defaultLibraryRealtimePublicationFailureReporter,
  defaultPersistedLibraryRealtimeEventPublisher,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  resolveLibraryMutationDatabase,
  sheetFolderMovedRealtimeAppendInputs,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class MoveSheetFolderUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface MoveSheetFolderInput {
  from?: unknown
  to?: unknown
  clientId?: string
}

type MoveSheetFolderRepository = Pick<SheetRepository<Record<string, unknown>>, 'moveFolder' | 'getByRef'> & {
  readonly database?: RotomDatabase
}

type MoveSheetFolderRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface MoveSheetFolderDependencies {
  database?: RotomDatabase
  sheetRepository?: MoveSheetFolderRepository
  moveFolder?: (from: string, to: string) => { moved: boolean; count: number; affectedSheets?: readonly { readonly kind: SheetKind; readonly slug: string }[] } | null
  now?: () => number
  realtimeEventRepository?: MoveSheetFolderRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
}

export interface MoveSheetFolderResult {
  ok: true
  moved: boolean
  count: number
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const normalizeMoveSheetFolderPath = (value: unknown, label: 'from' | 'to'): string => {
  try {
    return sanitizeFolderPath(String(value ?? ''), { label })
  } catch (err) {
    throw new MoveSheetFolderUseCaseError(400, (err as Error).message)
  }
}

const readAffectedSheets = (
  sheetRepository: MoveSheetFolderRepository,
  refs: readonly { readonly kind: SheetKind; readonly slug: string }[],
): readonly PersistedSheet[] => refs.map((ref) => {
  const sheet = sheetRepository.getByRef(ref.kind, ref.slug)
  if (!sheet) throw new Error(`${ref.kind} sheet ${ref.slug} was not readable after folder move`)
  return sheet
})

export const moveSheetFolderUseCase = (
  input: MoveSheetFolderInput,
  dependencies: MoveSheetFolderDependencies = {},
): MoveSheetFolderResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Move sheet folder repository', dependency: dependencies.sheetRepository },
      { label: 'Move sheet folder realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const moveFolder = dependencies.moveFolder ?? ((from: string, to: string) => sheetRepository.moveFolder(from, to, undefined, dependencies.now?.()))
  const from = normalizeMoveSheetFolderPath(input.from, 'from')
  const to = normalizeMoveSheetFolderPath(input.to, 'to')

  const transactionResult = database.withTransaction(() => {
    let result
    try {
      result = moveFolder(from, to)
    } catch (err) {
      const message = (err as Error).message
      if (message.includes('Destination')) throw new MoveSheetFolderUseCaseError(409, message)
      throw new MoveSheetFolderUseCaseError(400, message)
    }

    if (!result) throw new MoveSheetFolderUseCaseError(404, `Folder "${from}" not found`)

    const affectedSheets = result.moved ? readAffectedSheets(sheetRepository, result.affectedSheets ?? []) : []
    const realtimeEvents = result.moved
      ? realtimeEventRepository.appendMany(sheetFolderMovedRealtimeAppendInputs({ from, to, affectedSheets, clientId: input.clientId }))
      : []
    return { result, realtimeEvents }
  })

  publishPersistedLibraryRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedLibraryRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultLibraryRealtimePublicationFailureReporter,
  })

  return {
    ok: true,
    moved: transactionResult.result.moved,
    count: transactionResult.result.count,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
