import { join } from 'node:path'
import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayMapScope,
  type LivePlayPatch,
  type LivePlayTerrainCommand,
} from '#shared/livePlayCommands'
import type { AuthRole } from '#shared/auth'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { RealtimeEvent } from '#shared/realtime'
import type { MapVoxelV2, TabletopMap } from '~/types/map'
import {
  applyLivePlayTerrainChange,
  cloneTerrainVoxel,
  createLivePlayTerrainPatchPayload,
  validateLivePlayTerrainCommandPayloadAndScopes,
  type AppliedLivePlayTerrainChange,
  type LivePlayTerrainPatchPayload,
} from '../livePlay/terrainDomain'
import {
  createAuthoritativeLivePlayCommandExecutor,
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { sqliteLivePlayOpRepository } from '../storage/opRepository'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { campaignPathLabel } from '../utils/campaignPaths'
import { MAPS_ROOT } from '../utils/mapPaths'
import { livePlayCommandAcceptedRealtimeEvent } from '../utils/mapRealtimeEvents'
import { publishRealtime } from '../utils/realtime'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'

export class LivePlayTerrainCommandUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export type LivePlayTerrainCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL
  | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL

export interface LivePlayTerrainCommandActor {
  readonly role: AuthRole
  readonly clientId?: string
}

export interface ExecuteLivePlayTerrainCommandInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
  readonly expectedType?: LivePlayTerrainCommandType
}

export interface LivePlayTerrainCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
  readonly voxels?: readonly MapVoxelV2[]
}

export interface LivePlayTerrainCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly mapRepository?: Pick<MapRepository, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly publishRealtimeEvent?: (event: Omit<RealtimeEvent, 'timestamp'>) => void
  readonly now?: () => number
  readonly relativePath?: (path: string) => string
}

interface ResolvedTerrainContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
}

type LivePlayTerrainDependencySet = ReturnType<typeof actionDependencies>

const livePlayTerrainCommandExecutor = createAuthoritativeLivePlayCommandExecutor({
  opStore: sqliteLivePlayOpRepository,
})

const terrainCommandTypes = new Set<string>([
  LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
  LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL,
])

const actionDependencies = (dependencies: LivePlayTerrainCommandDependencies) => ({
  commandExecutor: dependencies.commandExecutor ?? livePlayTerrainCommandExecutor,
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  publishRealtimeEvent: dependencies.publishRealtimeEvent ?? publishRealtime,
  now: dependencies.now ?? Date.now,
  relativePath: dependencies.relativePath ?? campaignPathLabel,
})

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => (
  map.folder ? join(MAPS_ROOT, map.folder, `${map.slug}.json`) : join(MAPS_ROOT, `${map.slug}.json`)
)

const terrainScope = (): LivePlayMapScope => ({ kind: 'map', lane: 'terrain' })

const assertLivePlayTerrainCommandType = (
  command: LivePlayTerrainCommand,
  expectedType?: LivePlayTerrainCommandType,
): void => {
  if (expectedType && command.type !== expectedType) {
    rejectLivePlayCommand('invalid', `This route only accepts ${expectedType} commands`)
  }
  if (!terrainCommandTypes.has(command.type)) {
    rejectLivePlayCommand(
      'invalid',
      'Terrain live-play routes support buildTerrainVoxel and removeTerrainVoxel commands only',
    )
  }
}

const terrainPatch = (
  command: LivePlayTerrainCommand,
  revision: number,
  change: AppliedLivePlayTerrainChange,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN, LivePlayTerrainPatchPayload, LivePlayMapScope> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN,
  mapSlug: command.mapSlug,
  revision,
  scopes: [terrainScope()],
  payload: createLivePlayTerrainPatchPayload(command.type as LivePlayTerrainCommandType, change),
})

const resolveContext = async (
  command: LivePlayTerrainCommand,
  dependencies: LivePlayTerrainDependencySet,
): Promise<ResolvedTerrainContext> => {
  const map = await dependencies.mapRepository.getBySlug(command.mapSlug)
  if (!map) throw new LivePlayTerrainCommandUseCaseError(404, `Map ${command.mapSlug}.json not found`)
  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
  }
}

const cloneTerrainVoxels = (voxels: readonly MapVoxelV2[] | null | undefined): MapVoxelV2[] => (
  (voxels ?? []).map(cloneTerrainVoxel)
)

const responseFromContext = (
  result: LivePlayCommandResult,
  context: ResolvedTerrainContext | null,
): LivePlayTerrainCommandResponse => ({
  result,
  ...(context ? {
    path: context.relativePath,
    map: context.map,
    voxels: cloneTerrainVoxels(context.map.voxels),
  } : {}),
})

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const currentContextForAcceptedResult = async (
  result: LivePlayCommandAccepted,
  dependencies: LivePlayTerrainDependencySet,
): Promise<ResolvedTerrainContext | null> => {
  try {
    const map = await dependencies.mapRepository.getBySlug(result.mapSlug)
    if (!map) return null
    const mapPath = mapPathForDocument(map)
    return {
      mapPath,
      relativePath: dependencies.relativePath(mapPath),
      map,
    }
  } catch {
    return null
  }
}

export const executeLivePlayTerrainCommandUseCase = async (
  input: ExecuteLivePlayTerrainCommandInput,
  dependencies: LivePlayTerrainCommandDependencies = {},
): Promise<LivePlayTerrainCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedTerrainContext | null = null

  const result = await deps.commandExecutor.execute<LivePlayTerrainCommand, ResolvedTerrainContext, LivePlayTerrainCommandActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
    },
    readMap: ({ command }) => resolveContext(command, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    authorize: ({ command, actor }) => {
      assertLivePlayTerrainCommandType(command, input.expectedType)
      validateLivePlayTerrainCommandPayloadAndScopes(command)
      if (actor.role !== 'gm') {
        rejectLivePlayCommand('unauthorized', 'Only GMs can edit terrain voxels')
      }
    },
    apply: ({ command, map, currentRevision }) => {
      const change = applyLivePlayTerrainChange(command, map.map, deps.now())
      const revision = nextRevision(currentRevision)
      const nextMap = {
        ...map,
        map: {
          ...change.nextMap,
          revision,
        },
      }

      return {
        status: 'accepted',
        nextMap,
        previousRevision: currentRevision,
        revision,
        patches: [terrainPatch(command, revision, change)],
      }
    },
    persist: async ({ actor, currentRevision, nextMap, result }) => {
      const persisted = toPersistedMap(nextMap.map, nextMap.mapPath, deps.now(), { revision: result.revision })
      const updateResult = await deps.mapRepository.applyLivePlayUpdate({
        slug: result.mapSlug,
        expectedRevision: currentRevision,
        nextMap: persisted,
      })
      if (updateResult === 'stale') {
        throw new LivePlayTerrainCommandUseCaseError(409, `Map ${result.mapSlug} changed before the live-play terrain command could be persisted`)
      }
      const authoritativeMap = await deps.mapRepository.getBySlug(result.mapSlug)
      if (!authoritativeMap) {
        throw new LivePlayTerrainCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after live-play terrain command`)
      }
      persistedContext = {
        mapPath: nextMap.mapPath,
        relativePath: nextMap.relativePath,
        map: authoritativeMap,
      }
      void actor
    },
    publish: ({ actor, result }) => {
      if (!persistedContext) return
      deps.publishRealtimeEvent(livePlayCommandAcceptedRealtimeEvent(result, actor.clientId))
    },
  })

  const responseContext = persistedContext
    ?? (isAcceptedResult(result) ? await currentContextForAcceptedResult(result, deps) : null)
  return responseFromContext(result, responseContext)
}
