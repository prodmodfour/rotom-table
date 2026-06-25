import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { TabletopMap } from '~/types/map'
import { sanitizeMapFolderPath } from '../utils/mapPaths'
import { logicalMapFolderPath } from '../utils/runtimeResourcePaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import {
  defaultLibraryRealtimePublicationFailureReporter,
  defaultPersistedLibraryRealtimeEventPublisher,
  mapFolderDeletedRealtimeAppendInputs,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  resolveLibraryMutationDatabase,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class DeleteMapFolderUseCaseError extends UseCaseHttpError<400 | 404> {}

export interface DeleteMapFolderInput {
  folder?: unknown
  clientId?: string
}

type DeleteMapFolderRepository = Pick<MapRepository, 'deleteFolder'> & {
  readonly database?: RotomDatabase
}

type DeleteMapFolderRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface DeleteMapFolderDependencies {
  database?: RotomDatabase
  mapRepository?: DeleteMapFolderRepository
  deleteFolder?: (folder: string) => { folder?: string; removed?: string; deletedMaps?: readonly TabletopMap[] } | null
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  realtimeEventRepository?: DeleteMapFolderRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
}

export interface DeleteMapFolderResult {
  ok: true
  removed: string
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const normalizeDeleteMapFolderPath = (
  value: unknown,
  sanitizeFolder: (folder: string, allowEmpty: boolean) => string = sanitizeMapFolderPath,
): string => {
  try {
    return sanitizeFolder(String(value ?? ''), false)
  } catch (err) {
    throw new DeleteMapFolderUseCaseError(400, (err as Error).message)
  }
}

export const deleteMapFolderUseCase = (
  input: DeleteMapFolderInput,
  dependencies: DeleteMapFolderDependencies = {},
): DeleteMapFolderResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Delete map folder repository', dependency: dependencies.mapRepository },
      { label: 'Delete map folder realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const deleteFolder = dependencies.deleteFolder ?? ((folder: string) => mapRepository.deleteFolder(folder))

  const folder = normalizeDeleteMapFolderPath(input.folder, sanitizeFolder)

  const transactionResult = database.withTransaction(() => {
    let result
    try {
      result = deleteFolder(folder)
    } catch (err) {
      throw new DeleteMapFolderUseCaseError(400, (err as Error).message)
    }

    if (!result) throw new DeleteMapFolderUseCaseError(404, `Folder "${folder}" not found`)

    const removed = ('removed' in result && typeof result.removed === 'string')
      ? result.removed
      : logicalMapFolderPath(result.folder ?? folder)
    const deletedMaps = result.deletedMaps ?? []
    const realtimeEvents = realtimeEventRepository.appendMany(mapFolderDeletedRealtimeAppendInputs({
      folder,
      deletedMaps,
      clientId: input.clientId,
    }))
    return { removed, realtimeEvents }
  })

  publishPersistedLibraryRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedLibraryRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultLibraryRealtimePublicationFailureReporter,
  })

  return {
    ok: true,
    removed: transactionResult.removed,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
