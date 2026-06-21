import { join } from 'node:path'
import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayMapScope,
  type LivePlayPatch,
  type SetSceneLivePlayCommand,
  type SetScenePayload,
} from '#shared/livePlayCommands'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AuthRole } from '#shared/auth'
import type { RealtimeEvent } from '#shared/realtime'
import type { MapSceneState, TabletopMap } from '~/types/map'
import {
  createMapSceneState,
  mapSceneStatesEqual,
  normalizeMapSceneName,
  normalizeMapSceneState,
} from '~/utils/mapSceneState'
import {
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../livePlay/sqliteCommandExecutor'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { campaignPathLabel } from '../utils/campaignPaths'
import { MAPS_ROOT } from '../utils/mapPaths'
import { livePlayCommandAcceptedRealtimeEvent } from '../utils/mapRealtimeEvents'
import { publishRealtime } from '../utils/realtime'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'

export class LivePlaySceneCommandUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export type LivePlaySceneCommandType = typeof LIVE_PLAY_COMMAND_TYPES.SET_SCENE

export interface LivePlaySceneCommandActor {
  readonly role: AuthRole
  readonly clientId?: string
}

export interface ExecuteLivePlaySceneCommandInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
  readonly expectedType?: LivePlaySceneCommandType
}

export interface LivePlaySceneCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
  readonly activeScene?: MapSceneState | null
}

export interface LivePlaySceneCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly mapRepository?: Pick<MapRepository, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly publishRealtimeEvent?: (event: Omit<RealtimeEvent, 'timestamp'>) => void
  readonly now?: () => number
  readonly relativePath?: (path: string) => string
}

interface ResolvedSceneContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
}

interface AppliedSceneChange {
  readonly previous: MapSceneState | null
  readonly current: MapSceneState | null
  readonly nextMap: TabletopMap
}

type LivePlaySceneDependencySet = ReturnType<typeof actionDependencies>
type UnknownRecord = Record<string, unknown>

const livePlaySceneCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const actionDependencies = (dependencies: LivePlaySceneCommandDependencies) => ({
  commandExecutor: dependencies.commandExecutor ?? livePlaySceneCommandExecutor,
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  publishRealtimeEvent: dependencies.publishRealtimeEvent ?? publishRealtime,
  now: dependencies.now ?? Date.now,
  relativePath: dependencies.relativePath ?? campaignPathLabel,
})

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => (
  map.folder ? join(MAPS_ROOT, map.folder, `${map.slug}.json`) : join(MAPS_ROOT, `${map.slug}.json`)
)

const sceneScope = (): LivePlayMapScope => ({ kind: 'map', lane: 'scene' })

const commandHasSceneScope = (command: SetSceneLivePlayCommand): boolean => command.scopes.some((scope) => (
  scope.kind === 'map' && scope.lane === 'scene'
))

const expectSceneScope = (command: SetSceneLivePlayCommand): void => {
  if (!commandHasSceneScope(command)) {
    rejectLivePlayCommand('invalid', 'setScene scopes must include the map scene scope')
  }
}

const assertSceneCommandType = (
  command: SetSceneLivePlayCommand,
  expectedType?: LivePlaySceneCommandType,
): void => {
  if (expectedType && command.type !== expectedType) {
    rejectLivePlayCommand('invalid', `This route only accepts ${expectedType} commands`)
  }
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.SET_SCENE) {
    rejectLivePlayCommand('invalid', 'Scene live-play route supports setScene commands only')
  }
}

const expectSetScenePayload = (payload: unknown): SetScenePayload => {
  if (!isRecord(payload)) rejectLivePlayCommand('invalid', 'setScene payload must be an object')
  const record = payload as UnknownRecord
  if (!hasOwn(record, 'name')) rejectLivePlayCommand('invalid', 'setScene payload.name is required')
  if (record.name === null) return { name: null }

  const name = normalizeMapSceneName(record.name)
  if (!name) {
    rejectLivePlayCommand('invalid', 'setScene payload.name must be a non-empty scene name of 120 characters or fewer, or null')
  }
  return { name }
}

const activeSceneState = (map: TabletopMap): MapSceneState | null => normalizeMapSceneState(map.activeScene)

const applySceneChange = (
  command: SetSceneLivePlayCommand,
  context: ResolvedSceneContext,
  timestamp: number,
): AppliedSceneChange => {
  const payload = expectSetScenePayload(command.payload)
  const previous = activeSceneState(context.map)
  const current = payload.name === null
    ? null
    : createMapSceneState(payload.name, timestamp)

  if (mapSceneStatesEqual(previous, current)) {
    rejectLivePlayCommand('no-op', 'The requested scene change is already reflected in authoritative state', {
      currentState: previous,
    })
  }

  return {
    previous,
    current,
    nextMap: {
      ...context.map,
      activeScene: current,
      moveUsage: undefined,
      updatedAt: timestamp,
    },
  }
}

const commandPatch = (
  command: SetSceneLivePlayCommand,
  revision: number,
  change: Pick<AppliedSceneChange, 'previous' | 'current'>,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_SCENE, {
  readonly command: typeof LIVE_PLAY_COMMAND_TYPES.SET_SCENE
  readonly previous: MapSceneState | null
  readonly current: MapSceneState | null
}, LivePlayMapScope> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.MAP_SCENE,
  mapSlug: command.mapSlug,
  revision,
  scopes: [sceneScope()],
  payload: {
    command: command.type,
    previous: change.previous,
    current: change.current,
  },
})

const resolveContext = async (
  command: SetSceneLivePlayCommand,
  dependencies: LivePlaySceneDependencySet,
): Promise<ResolvedSceneContext> => {
  const map = await dependencies.mapRepository.getBySlug(command.mapSlug)
  if (!map) throw new LivePlaySceneCommandUseCaseError(404, `Map ${command.mapSlug}.json not found`)
  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
  }
}

const responseFromContext = (
  result: LivePlayCommandResult,
  context: ResolvedSceneContext | null,
): LivePlaySceneCommandResponse => ({
  result,
  ...(context ? {
    path: context.relativePath,
    map: context.map,
    activeScene: activeSceneState(context.map),
  } : {}),
})

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const currentContextForAcceptedResult = async (
  result: LivePlayCommandAccepted,
  dependencies: LivePlaySceneDependencySet,
): Promise<ResolvedSceneContext | null> => {
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

export const executeLivePlaySceneCommandUseCase = async (
  input: ExecuteLivePlaySceneCommandInput,
  dependencies: LivePlaySceneCommandDependencies = {},
): Promise<LivePlaySceneCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedSceneContext | null = null

  const result = await deps.commandExecutor.execute<SetSceneLivePlayCommand, ResolvedSceneContext, LivePlaySceneCommandActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
    },
    readMap: ({ command }) => resolveContext(command, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    authorize: ({ command, actor }) => {
      assertSceneCommandType(command, input.expectedType)
      expectSceneScope(command)
      expectSetScenePayload(command.payload)
      if (actor.role !== 'gm') {
        rejectLivePlayCommand('unauthorized', 'Only GMs can manage scenes')
      }
    },
    apply: ({ command, map, currentRevision }) => {
      const change = applySceneChange(command, map, deps.now())
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
        patches: [commandPatch(command, revision, change)],
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
        throw new LivePlaySceneCommandUseCaseError(409, `Map ${result.mapSlug} changed before the live-play scene command could be persisted`)
      }
      const authoritativeMap = await deps.mapRepository.getBySlug(result.mapSlug)
      if (!authoritativeMap) {
        throw new LivePlaySceneCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after live-play scene command`)
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
