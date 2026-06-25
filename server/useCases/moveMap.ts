import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { TabletopMap } from '~/types/map'
import { validateSlug } from '#shared/paths'
import { sanitizeMapFolderPath } from '../utils/mapPaths'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import type { RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import {
  defaultLibraryRealtimePublicationFailureReporter,
  defaultPersistedLibraryRealtimeEventPublisher,
  mapLibraryMovedRealtimeAppendInputs,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  resolveLibraryMutationDatabase,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class MoveMapUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface MoveMapInput {
  slug?: unknown
  folder?: unknown
  clientId?: string
}

type MoveMapRepository = Pick<MapRepository<TabletopMap>, 'moveToFolder' | 'get'> & {
  readonly database?: RotomDatabase
}

type MoveMapRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface MoveMapDependencies {
  database?: RotomDatabase
  now?: () => number
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  mapRepository?: MoveMapRepository
  realtimeEventRepository?: MoveMapRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
}

export interface MoveMapResult {
  ok: true
  moved: boolean
  path: string
  map: TabletopMap
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const normalizeMoveMapSlug = (value: unknown): string => {
  try {
    return validateSlug(value, 'slug')
  } catch {
    throw new MoveMapUseCaseError(400, 'slug must match /^[a-z0-9-]+$/')
  }
}

export const normalizeMoveMapFolder = (
  value: unknown,
  sanitizeFolder: (folder: string, allowEmpty: boolean) => string = sanitizeMapFolderPath,
): string => {
  try {
    return sanitizeFolder(String(value ?? ''), true)
  } catch (err) {
    throw new MoveMapUseCaseError(400, (err as Error).message)
  }
}

const readAuthoritativeMapOrThrow = (
  mapRepository: MoveMapRepository,
  slug: string,
  expected: Pick<TabletopMap, 'revision' | 'updatedAt'>,
): TabletopMap => {
  const stored = mapRepository.get(slug)
  if (!stored) throw new MoveMapUseCaseError(404, `Map ${slug}.json not found`)
  if (stored.revision !== expected.revision || stored.updatedAt !== expected.updatedAt) {
    throw new Error(`Map ${slug} authoritative re-read did not match moved revision ${expected.revision} and timestamp ${expected.updatedAt}`)
  }
  return stored.document as unknown as TabletopMap
}

export const moveMapUseCase = (
  input: MoveMapInput,
  dependencies: MoveMapDependencies = {},
): MoveMapResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Move map repository', dependency: dependencies.mapRepository },
      { label: 'Move map realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const now = dependencies.now ?? Date.now

  const slug = normalizeMoveMapSlug(input.slug)
  const folder = normalizeMoveMapFolder(input.folder, sanitizeFolder)

  const transactionResult = database.withTransaction(() => {
    let result
    try {
      result = mapRepository.moveToFolder({ slug, folder, now: now() })
    } catch (err) {
      const message = (err as Error).message
      if (message.includes('already exists')) throw new MoveMapUseCaseError(409, message)
      throw new MoveMapUseCaseError(400, message)
    }
    if (!result) throw new MoveMapUseCaseError(404, `Map ${slug}.json not found`)

    const authoritativeMap = result.moved
      ? readAuthoritativeMapOrThrow(mapRepository, slug, result.map)
      : result.map
    const realtimeEvents = result.moved
      ? realtimeEventRepository.appendMany(mapLibraryMovedRealtimeAppendInputs(authoritativeMap, input.clientId))
      : []

    return {
      moved: result.moved,
      map: authoritativeMap,
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
    moved: transactionResult.moved,
    path: logicalMapResourcePath(transactionResult.map),
    map: transactionResult.map,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
