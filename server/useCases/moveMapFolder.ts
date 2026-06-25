import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { TabletopMap } from '~/types/map'
import { sanitizeMapFolderPath } from '../utils/mapPaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import {
  defaultLibraryRealtimePublicationFailureReporter,
  defaultPersistedLibraryRealtimeEventPublisher,
  mapFolderMovedRealtimeAppendInputs,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  resolveLibraryMutationDatabase,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class MoveMapFolderUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface MoveMapFolderInput {
  from?: unknown
  to?: unknown
  clientId?: string
}

type MoveMapFolderRepository = Pick<MapRepository<TabletopMap>, 'moveFolder' | 'get'> & {
  readonly database?: RotomDatabase
}

type MoveMapFolderRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface MoveMapFolderDependencies {
  database?: RotomDatabase
  mapRepository?: MoveMapFolderRepository
  moveFolder?: (from: string, to: string) => { moved: boolean; affectedMapSlugs?: readonly string[] } | null
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  now?: () => number
  realtimeEventRepository?: MoveMapFolderRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
}

export interface MoveMapFolderResult {
  ok: true
  moved: boolean
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const normalizeMoveMapFolderPath = (
  value: unknown,
  sanitizeFolder: (folder: string, allowEmpty: boolean) => string = sanitizeMapFolderPath,
): string => {
  try {
    return sanitizeFolder(String(value ?? ''), false)
  } catch (err) {
    throw new MoveMapFolderUseCaseError(400, (err as Error).message)
  }
}

const readAffectedMaps = (
  mapRepository: MoveMapFolderRepository,
  slugs: readonly string[],
): readonly TabletopMap[] => slugs.map((slug) => {
  const stored = mapRepository.get(slug)
  if (!stored) throw new Error(`Map ${slug} was not readable after folder move`)
  return stored.document as unknown as TabletopMap
})

export const moveMapFolderUseCase = (
  input: MoveMapFolderInput,
  dependencies: MoveMapFolderDependencies = {},
): MoveMapFolderResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Move map folder repository', dependency: dependencies.mapRepository },
      { label: 'Move map folder realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const moveFolder = dependencies.moveFolder ?? ((from: string, to: string) => mapRepository.moveFolder(from, to, dependencies.now?.()))

  const from = normalizeMoveMapFolderPath(input.from, sanitizeFolder)
  const to = normalizeMoveMapFolderPath(input.to, sanitizeFolder)

  if (from === to) {
    return {
      ok: true,
      moved: false,
      realtimeEvents: [],
    }
  }
  if (to.startsWith(`${from}/`)) {
    throw new MoveMapFolderUseCaseError(400, 'Cannot move a folder into itself or one of its descendants')
  }

  const transactionResult = database.withTransaction(() => {
    let result
    try {
      result = moveFolder(from, to)
    } catch (err) {
      const message = (err as Error).message
      if (message === 'Destination folder already exists') throw new MoveMapFolderUseCaseError(409, message)
      throw new MoveMapFolderUseCaseError(400, message)
    }

    if (!result) throw new MoveMapFolderUseCaseError(404, `Folder "${from}" not found`)

    const affectedMaps = result.moved ? readAffectedMaps(mapRepository, result.affectedMapSlugs ?? []) : []
    const realtimeEvents = result.moved
      ? realtimeEventRepository.appendMany(mapFolderMovedRealtimeAppendInputs({ from, to, affectedMaps, clientId: input.clientId }))
      : []
    return { moved: result.moved, realtimeEvents }
  })

  publishPersistedLibraryRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedLibraryRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultLibraryRealtimePublicationFailureReporter,
  })

  return {
    ok: true,
    moved: transactionResult.moved,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
