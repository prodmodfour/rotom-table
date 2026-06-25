import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { validateSlug } from '#shared/paths'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import type { RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import {
  defaultLibraryRealtimePublicationFailureReporter,
  defaultPersistedLibraryRealtimeEventPublisher,
  mapLibraryDeletedRealtimeAppendInputs,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  resolveLibraryMutationDatabase,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class DeleteMapUseCaseError extends UseCaseHttpError<400 | 404> {}

export interface DeleteMapInput {
  slug?: unknown
  clientId?: string
}

type DeleteMapRepository = Pick<MapRepository, 'deleteDocument'> & {
  readonly database?: RotomDatabase
}

type DeleteMapRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface DeleteMapDependencies {
  database?: RotomDatabase
  mapRepository?: DeleteMapRepository
  realtimeEventRepository?: DeleteMapRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
}

export interface DeleteMapResult {
  ok: true
  path: string
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const normalizeDeleteMapSlug = (value: unknown): string => {
  try {
    return validateSlug(value, 'slug')
  } catch {
    throw new DeleteMapUseCaseError(400, 'slug must match /^[a-z0-9-]+$/')
  }
}

export const deleteMapUseCase = (
  input: DeleteMapInput,
  dependencies: DeleteMapDependencies = {},
): DeleteMapResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Delete map repository', dependency: dependencies.mapRepository },
      { label: 'Delete map realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const slug = normalizeDeleteMapSlug(input.slug)

  const transactionResult = database.withTransaction(() => {
    const deleted = mapRepository.deleteDocument(slug)
    if (!deleted) throw new DeleteMapUseCaseError(404, `Map ${slug}.json not found`)

    const realtimeEvents = realtimeEventRepository.appendMany(mapLibraryDeletedRealtimeAppendInputs({
      slug,
      revision: deleted.map.revision,
      clientId: input.clientId,
    }))
    return {
      path: logicalMapResourcePath(deleted.map),
      realtimeEvents,
    }
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
