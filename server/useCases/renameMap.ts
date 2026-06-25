import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { TabletopMap } from '~/types/map'
import { validateSlug } from '#shared/paths'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import type { RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import {
  defaultLibraryRealtimePublicationFailureReporter,
  defaultPersistedLibraryRealtimeEventPublisher,
  mapLibraryRenamedRealtimeAppendInputs,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  resolveLibraryMutationDatabase,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class RenameMapUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface RenameMapInput {
  slug?: unknown
  name?: unknown
  clientId?: string
}

type RenameMapRepository = Pick<MapRepository<TabletopMap>, 'rename' | 'get'> & {
  readonly database?: RotomDatabase
}

type RenameMapRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface RenameMapDependencies {
  database?: RotomDatabase
  now?: () => number
  mapRepository?: RenameMapRepository
  realtimeEventRepository?: RenameMapRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
}

export interface RenameMapResult {
  ok: true
  slug: string
  name: string
  path: string
  map: TabletopMap
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

const MAX_MAP_NAME_LENGTH = 80

export const normalizeRenameMapSlug = (value: unknown): string => {
  try {
    return validateSlug(value, 'slug')
  } catch {
    throw new RenameMapUseCaseError(400, 'slug must match /^[a-z0-9-]+$/')
  }
}

export const normalizeRenameMapName = (value: unknown): string => {
  const name = String(value ?? '').trim()
  if (!name) throw new RenameMapUseCaseError(400, 'name is required')
  if (name.length > MAX_MAP_NAME_LENGTH) {
    throw new RenameMapUseCaseError(400, 'name too long (max 80 chars)')
  }
  return name
}

const readAuthoritativeMapOrThrow = (
  mapRepository: RenameMapRepository,
  slug: string,
  expected: Pick<TabletopMap, 'revision' | 'updatedAt'>,
): TabletopMap => {
  const stored = mapRepository.get(slug)
  if (!stored) throw new RenameMapUseCaseError(404, `Map ${slug}.json not found`)
  if (stored.revision !== expected.revision || stored.updatedAt !== expected.updatedAt) {
    throw new Error(`Map ${slug} authoritative re-read did not match renamed revision ${expected.revision} and timestamp ${expected.updatedAt}`)
  }
  return stored.document as unknown as TabletopMap
}

export const renameMapUseCase = (
  input: RenameMapInput,
  dependencies: RenameMapDependencies = {},
): RenameMapResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Rename map repository', dependency: dependencies.mapRepository },
      { label: 'Rename map realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const now = dependencies.now ?? Date.now

  const slug = normalizeRenameMapSlug(input.slug)
  const name = normalizeRenameMapName(input.name)

  const transactionResult = database.withTransaction(() => {
    let renamed
    try {
      renamed = mapRepository.rename({ slug, name, now: now() })
    } catch (err) {
      const message = (err as Error).message
      if (message.includes('already exists') || message.includes('UNIQUE')) throw new RenameMapUseCaseError(409, message)
      throw new RenameMapUseCaseError(400, message)
    }
    if (!renamed) throw new RenameMapUseCaseError(404, `Map ${slug}.json not found`)

    const map = renamed.changed
      ? readAuthoritativeMapOrThrow(mapRepository, renamed.newSlug, renamed.map)
      : renamed.map
    const realtimeEvents = renamed.changed
      ? realtimeEventRepository.appendMany(mapLibraryRenamedRealtimeAppendInputs({
          oldSlug: slug,
          map,
          renamed: renamed.renamed,
          clientId: input.clientId,
        }))
      : []

    return {
      newSlug: renamed.newSlug,
      map,
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
    slug: transactionResult.newSlug,
    name,
    path: logicalMapResourcePath(transactionResult.map),
    map: transactionResult.map,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
