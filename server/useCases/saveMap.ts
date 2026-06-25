import { UseCaseHttpError } from '../utils/useCaseErrors'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { isRevision, normalizeRevision, nextRevision } from '#shared/sessionRevisions'
import { normalizeMapFieldEffects } from '~/utils/mapFieldEffects'
import { normalizeMapMoveUsage } from '~/utils/moveUsage'
import { normalizeMapSceneState } from '~/utils/mapSceneState'
import { normalizeMapTemporaryHitPointsState } from '~/utils/mapTemporaryHitPoints'
import type { AuthRole } from '#shared/auth'
import type { TabletopMap } from '~/types/map'
import { normalizeMapGroundLevelY } from '../utils/mapNormalization'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import {
  createSqliteRealtimeEventRepository,
  type RealtimeEventRepository,
} from '../storage/realtimeEventRepository'
import { setupMapSaveRealtimeAppendInputs } from '../realtime/setupDocumentRealtime'
import {
  defaultPersistedSetupSaveRealtimeEventPublisher,
  defaultSetupSaveRealtimePublicationFailureReporter,
  publishPersistedSetupSaveRealtimeEventsAfterCommit,
  type PersistedSetupSaveRealtimeEventPublisher,
  type SetupSaveRealtimePublicationFailureReporter,
} from '../realtime/persistedRealtimePublication'

export class SaveMapUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface SaveMapInput {
  role: AuthRole
  slug: string
  map: TabletopMap
  expectedRevision?: number
  clientId?: string
  interactionMode: MapInteractionMode
}

type SaveMapRepository = Pick<MapRepository<TabletopMap>, 'replaceSetupMap' | 'get'> & {
  readonly database?: RotomDatabase
}

type SaveMapRealtimeEventRepository = Pick<RealtimeEventRepository, 'appendMany'> & {
  readonly database?: RotomDatabase
}

export interface SaveMapDependencies {
  database?: RotomDatabase
  mapRepository?: SaveMapRepository
  realtimeEventRepository?: SaveMapRealtimeEventRepository
  publishPersistedRealtimeEvent?: PersistedSetupSaveRealtimeEventPublisher
  reportAfterCommitPublicationFailure?: SetupSaveRealtimePublicationFailureReporter
  now?: () => number
}

export interface SaveMapResult {
  ok: true
  path: string
  map: TabletopMap
  realtimeEvents: readonly PersistedRealtimeEvent[]
}

export interface ToPersistedMapOptions {
  revision?: number
  advanceRevision?: boolean
  folder?: string
}

export const toPersistedMap = (
  source: TabletopMap,
  folderOrPath: string,
  updatedAt: number,
  options: ToPersistedMapOptions = {},
): TabletopMap => {
  const initiative = source.initiative && typeof source.initiative === 'object'
    ? source.initiative
    : { activeId: null, round: 1 }
  const activeScene = normalizeMapSceneState(source.activeScene)
  const temporaryHitPoints = normalizeMapTemporaryHitPointsState(source.temporaryHitPoints, activeScene)
  const folder = options.folder ?? folderOrPath

  return {
    schemaVersion: 2,
    revision: options.revision ?? (options.advanceRevision
      ? nextRevision(normalizeRevision(source.revision))
      : normalizeRevision(source.revision)),
    slug: source.slug,
    name: source.name,
    folder,
    dimensions: source.dimensions,
    groundLevelY: normalizeMapGroundLevelY(source.groundLevelY, source.dimensions?.y ?? 1),
    playerVisible: source.playerVisible === true,
    voxels: Array.isArray(source.voxels) ? source.voxels : [],
    hazards: Array.isArray(source.hazards) ? source.hazards : [],
    fieldEffects: normalizeMapFieldEffects(source.fieldEffects),
    placements: Array.isArray(source.placements) ? source.placements : [],
    lights: Array.isArray(source.lights) ? source.lights : [],
    initiative,
    ...(activeScene ? { activeScene } : {}),
    ...(temporaryHitPoints ? { temporaryHitPoints } : {}),
    moveUsage: normalizeMapMoveUsage(source.moveUsage),
    metadata: source.metadata,
    createdAt: source.createdAt,
    updatedAt,
  }
}

const databaseFromDependencies = (dependencies: SaveMapDependencies): RotomDatabase => {
  const mapDatabase = dependencies.mapRepository?.database
  const realtimeDatabase = dependencies.realtimeEventRepository?.database
  const database = dependencies.database ?? mapDatabase ?? realtimeDatabase ?? getRotomDatabase()

  if (mapDatabase && mapDatabase !== database) {
    throw new Error('Map setup save map repository must use the same RotomDatabase as the save transaction')
  }
  if (realtimeDatabase && realtimeDatabase !== database) {
    throw new Error('Map setup save realtime event repository must use the same RotomDatabase as the save transaction')
  }
  return database
}

const replaceMapOrThrow = (
  mapRepository: SaveMapRepository,
  input: SaveMapInput,
  timestamp: number,
) => {
  try {
    return mapRepository.replaceSetupMap({
      slug: input.slug,
      expectedRevision: input.expectedRevision as number,
      map: input.map,
      now: timestamp,
    })
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('stale') || message.includes('expected revision')) {
      throw new SaveMapUseCaseError(409, message)
    }
    throw new SaveMapUseCaseError(400, message)
  }
}

const readAuthoritativeMapOrThrow = (
  mapRepository: SaveMapRepository,
  slug: string,
  expected: Pick<TabletopMap, 'revision' | 'updatedAt'>,
): TabletopMap => {
  const stored = mapRepository.get(slug)
  if (!stored) throw new SaveMapUseCaseError(404, `Map ${slug}.json not found`)
  if (stored.revision !== expected.revision || stored.updatedAt !== expected.updatedAt) {
    throw new Error(
      `Map ${slug} authoritative re-read did not match saved revision ${expected.revision} and timestamp ${expected.updatedAt}`,
    )
  }
  return stored.document as unknown as TabletopMap
}

export const saveMapUseCase = (
  input: SaveMapInput,
  dependencies: SaveMapDependencies = {},
): SaveMapResult => {
  if (input.map.slug !== input.slug) {
    throw new SaveMapUseCaseError(
      400,
      `map.slug "${input.map.slug}" must match request slug "${input.slug}"`,
    )
  }

  if (input.interactionMode !== MAP_INTERACTION_MODES.SETUP_EDIT) {
    throw new SaveMapUseCaseError(403, 'Whole-map saves are setup/edit-only; live play uses commands')
  }
  if (input.role !== 'gm') {
    throw new SaveMapUseCaseError(403, 'Player whole-map saves are not allowed; live play uses commands')
  }

  if (!isRevision(input.expectedRevision)) {
    throw new SaveMapUseCaseError(400, 'expectedRevision must be a safe non-negative integer')
  }

  const database = databaseFromDependencies(dependencies)
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(database)
  const realtimeEventRepository = dependencies.realtimeEventRepository
    ?? createSqliteRealtimeEventRepository({ database })
  const now = dependencies.now ?? Date.now

  const transactionResult = database.withTransaction(() => {
    const saved = replaceMapOrThrow(mapRepository, input, now())
    if (!saved) throw new SaveMapUseCaseError(404, `Map ${input.slug}.json not found`)

    const authoritativeMap = readAuthoritativeMapOrThrow(mapRepository, input.slug, saved.map)
    const realtimeEvents = saved.changed
      ? realtimeEventRepository.appendMany(setupMapSaveRealtimeAppendInputs(authoritativeMap, input.clientId))
      : []

    return {
      map: authoritativeMap,
      realtimeEvents,
    }
  })

  publishPersistedSetupSaveRealtimeEventsAfterCommit({
    events: transactionResult.realtimeEvents,
    resource: { kind: 'map', mapSlug: input.slug },
    publish: dependencies.publishPersistedRealtimeEvent ?? defaultPersistedSetupSaveRealtimeEventPublisher,
    reportFailure: dependencies.reportAfterCommitPublicationFailure ?? defaultSetupSaveRealtimePublicationFailureReporter,
  })

  return {
    ok: true,
    path: logicalMapResourcePath(transactionResult.map),
    map: transactionResult.map,
    realtimeEvents: transactionResult.realtimeEvents,
  }
}
