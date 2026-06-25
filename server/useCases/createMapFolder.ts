import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { sanitizeMapFolderPath } from '../utils/mapPaths'
import { logicalMapFolderPath } from '../utils/runtimeResourcePaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import {
  defaultLibraryRealtimePublicationFailureReporter,
  defaultPersistedLibraryRealtimeEventPublisher,
  mapFolderCreatedRealtimeAppendInputs,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  resolveLibraryMutationDatabase,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class CreateMapFolderUseCaseError extends UseCaseHttpError<400> {}

export interface CreateMapFolderInput {
  folder?: unknown
  clientId?: string
}

type CreateMapFolderRepository = Pick<MapRepository, 'createFolder'> & {
  readonly database?: RotomDatabase
}

type CreateMapFolderRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface CreateMapFolderDependencies {
  database?: RotomDatabase
  mapRepository?: CreateMapFolderRepository
  createFolder?: (folder: string) => { created: boolean; folder: string }
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  now?: () => number
  realtimeEventRepository?: CreateMapFolderRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
}

export interface CreateMapFolderResult {
  ok: true
  created: boolean
  path: string
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const normalizeCreateMapFolder = (
  value: unknown,
  sanitizeFolder: (folder: string, allowEmpty: boolean) => string = sanitizeMapFolderPath,
): string => {
  try {
    return sanitizeFolder(String(value ?? ''), false)
  } catch (err) {
    throw new CreateMapFolderUseCaseError(400, (err as Error).message)
  }
}

export const createMapFolderUseCase = (
  input: CreateMapFolderInput,
  dependencies: CreateMapFolderDependencies = {},
): CreateMapFolderResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Create map folder repository', dependency: dependencies.mapRepository },
      { label: 'Create map folder realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const createFolder = dependencies.createFolder ?? ((folder: string) => mapRepository.createFolder(folder, dependencies.now?.()))

  const folder = normalizeCreateMapFolder(input.folder, sanitizeFolder)

  const transactionResult = database.withTransaction(() => {
    let result
    try {
      result = createFolder(folder)
    } catch (err) {
      throw new CreateMapFolderUseCaseError(400, (err as Error).message)
    }

    const realtimeEvents = result.created
      ? realtimeEventRepository.appendMany(mapFolderCreatedRealtimeAppendInputs(result.folder, input.clientId))
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
    created: transactionResult.result.created,
    path: logicalMapFolderPath(transactionResult.result.folder),
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
