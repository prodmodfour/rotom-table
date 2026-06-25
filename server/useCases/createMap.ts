import { UseCaseHttpError } from '../utils/useCaseErrors'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { GridDimensions, TabletopMap } from '~/types/map'
import { sanitizeMapFolderPath } from '../utils/mapPaths'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { type RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { createSqliteRealtimeEventRepository, type RealtimeEventRepository } from '../storage/realtimeEventRepository'
import {
  defaultLibraryRealtimePublicationFailureReporter,
  defaultPersistedLibraryRealtimeEventPublisher,
  mapLibraryCreatedRealtimeAppendInputs,
  publishPersistedLibraryRealtimeEventsAfterCommit,
  resolveLibraryMutationDatabase,
  type LibraryRealtimePublicationFailureReporter,
  type PersistedLibraryRealtimeEventPublisher,
} from '../realtime/libraryMutationRealtime'

export class CreateMapUseCaseError extends UseCaseHttpError<400 | 409> {}

export interface CreateMapInput {
  name?: unknown
  folder?: unknown
  dimensions?: unknown
  clientId?: string
}

type CreateMapRepository = Pick<MapRepository<TabletopMap>, 'allocateSlug' | 'create' | 'get'> & {
  readonly database?: RotomDatabase
}

type CreateMapRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface CreateMapDependencies {
  database?: RotomDatabase
  now?: () => number
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  mapRepository?: CreateMapRepository
  realtimeEventRepository?: CreateMapRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedLibraryRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: LibraryRealtimePublicationFailureReporter
}

export interface CreateMapResult {
  map: TabletopMap
  path: string
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export const DEFAULT_MAP_DIMENSIONS: GridDimensions = { x: 20, y: 12, z: 20 }

const MAX_MAP_NAME_LENGTH = 80

const clampMapDimension = (value: unknown, fallback: number): number => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(200, Math.max(1, Math.round(n)))
}

export const normalizeCreateMapName = (value: unknown): string => {
  const name = String(value ?? '').trim() || 'Untitled Map'
  if (name.length > MAX_MAP_NAME_LENGTH) {
    throw new CreateMapUseCaseError(400, 'name too long (max 80 chars)')
  }
  return name
}

export const normalizeCreateMapDimensions = (value: unknown): GridDimensions => {
  const source = value ?? DEFAULT_MAP_DIMENSIONS
  const dimensions = source as Partial<Record<keyof GridDimensions, unknown>>
  return {
    x: clampMapDimension(dimensions.x, DEFAULT_MAP_DIMENSIONS.x),
    y: clampMapDimension(dimensions.y, DEFAULT_MAP_DIMENSIONS.y),
    z: clampMapDimension(dimensions.z, DEFAULT_MAP_DIMENSIONS.z),
  }
}

const normalizeCreateMapFolder = (
  value: unknown,
  sanitizeFolder: (folder: string, allowEmpty: boolean) => string,
): string => {
  try {
    return sanitizeFolder(String(value ?? ''), true)
  } catch (err) {
    throw new CreateMapUseCaseError(400, (err as Error).message)
  }
}

const readAuthoritativeMapOrThrow = (
  mapRepository: CreateMapRepository,
  slug: string,
  expected: Pick<TabletopMap, 'revision' | 'updatedAt'>,
): TabletopMap => {
  const stored = mapRepository.get(slug)
  if (!stored) throw new Error(`Map ${slug} was not readable after create`)
  if (stored.revision !== expected.revision || stored.updatedAt !== expected.updatedAt) {
    throw new Error(`Map ${slug} authoritative re-read did not match created revision ${expected.revision} and timestamp ${expected.updatedAt}`)
  }
  return stored.document as unknown as TabletopMap
}

export const createMapUseCase = (
  input: CreateMapInput,
  dependencies: CreateMapDependencies = {},
): CreateMapResult => {
  const database = resolveLibraryMutationDatabase({
    database: dependencies.database,
    dependencies: [
      { label: 'Create map repository', dependency: dependencies.mapRepository },
      { label: 'Create map realtime event repository', dependency: dependencies.realtimeEventRepository },
    ],
  })
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const now = dependencies.now ?? Date.now

  const name = normalizeCreateMapName(input.name)
  const folder = normalizeCreateMapFolder(input.folder, sanitizeFolder)
  const dimensions = normalizeCreateMapDimensions(input.dimensions)

  const transactionResult = database.withTransaction(() => {
    const slug = mapRepository.allocateSlug(name)
    const timestamp = now()
    const map: TabletopMap = {
      schemaVersion: 2,
      revision: 0,
      slug,
      name,
      folder,
      dimensions,
      groundLevelY: 0,
      playerVisible: false,
      placements: [],
      initiative: { activeId: null, round: 1 },
      voxels: [],
      hazards: [],
      fieldEffects: { weather: [], terrains: [], rooms: [] },
      lights: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    let created: TabletopMap
    try {
      created = mapRepository.create({ slug, map, now: timestamp })
    } catch (err) {
      throw new CreateMapUseCaseError(409, (err as Error).message)
    }

    const authoritativeMap = readAuthoritativeMapOrThrow(mapRepository, created.slug, created)
    const realtimeEvents = realtimeEventRepository.appendMany(
      mapLibraryCreatedRealtimeAppendInputs(authoritativeMap, input.clientId),
    )
    return { map: authoritativeMap, realtimeEvents }
  })

  publishPersistedLibraryRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedLibraryRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultLibraryRealtimePublicationFailureReporter,
  })

  return {
    map: transactionResult.map,
    path: logicalMapResourcePath(transactionResult.map),
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
