import { join } from 'node:path'
import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayMapScope,
  type LivePlayPatch,
  type UpdateStartTurnModalLivePlayCommand,
} from '#shared/livePlayCommands'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AuthRole } from '#shared/auth'
import type { RealtimeEvent } from '#shared/realtime'
import {
  applyStartTurnModalStateUpdate,
  normalizeStartTurnModalStateUpdatePayload,
  readStartTurnModalState,
  startTurnModalDismissalMatches,
  writeStartTurnModalState,
  type StartTurnModalStateUpdatePayload,
  type StartTurnModalTurnRef,
} from '#shared/startTurnModalState'
import type { TabletopMap } from '~/types/map'
import {
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../livePlay/sqliteCommandExecutor'
import { canAccessMapForRole } from '../policies/mapPolicy'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import { campaignPathLabel } from '../utils/campaignPaths'
import { MAPS_ROOT } from '../utils/mapPaths'
import { livePlayCommandAcceptedRealtimeEvent } from '../utils/mapRealtimeEvents'
import { publishRealtime } from '../utils/realtime'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'

export class StartTurnModalCommandUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export type StartTurnModalLivePlayCommandType = typeof LIVE_PLAY_COMMAND_TYPES.UPDATE_START_TURN_MODAL

export interface StartTurnModalLivePlayActor {
  readonly role: AuthRole
  readonly clientId?: string
}

export interface ExecuteStartTurnModalLivePlayCommandInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
  readonly expectedType?: StartTurnModalLivePlayCommandType
}

export interface StartTurnModalLivePlayCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
}

export interface StartTurnModalCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly mapRepository?: Pick<MapRepository, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly publishRealtimeEvent?: (event: Omit<RealtimeEvent, 'timestamp'>) => void
  readonly now?: () => number
  readonly rollD20?: () => number
  readonly relativePath?: (path: string) => string
}

interface ResolvedStartTurnModalContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
  readonly payload: StartTurnModalStateUpdatePayload
}

type StartTurnModalDependencySet = ReturnType<typeof actionDependencies>

const livePlayStartTurnModalCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const actionDependencies = (dependencies: StartTurnModalCommandDependencies) => ({
  commandExecutor: dependencies.commandExecutor ?? livePlayStartTurnModalCommandExecutor,
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  publishRealtimeEvent: dependencies.publishRealtimeEvent ?? publishRealtime,
  now: dependencies.now ?? Date.now,
  rollD20: dependencies.rollD20 ?? (() => Math.floor(Math.random() * 20) + 1),
  relativePath: dependencies.relativePath ?? campaignPathLabel,
})

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => (
  map.folder ? join(MAPS_ROOT, map.folder, `${map.slug}.json`) : join(MAPS_ROOT, `${map.slug}.json`)
)

const normalizeRound = (value: unknown): number => {
  const round = Math.floor(Number(value ?? 1))
  return Number.isFinite(round) && round > 0 ? round : 1
}

const currentTurnRef = (map: TabletopMap): StartTurnModalTurnRef | null => {
  const activeId = typeof map.initiative?.activeId === 'string' ? map.initiative.activeId.trim() : ''
  if (!activeId) return null
  if (!map.placements.some((placement) => placement.id === activeId)) return null
  return {
    activeId,
    round: normalizeRound(map.initiative?.round),
  }
}

const metadataScopeMatches = (scopes: readonly LivePlayMapScope[]): boolean => scopes.some((scope) => (
  scope.kind === 'map' && scope.lane === 'metadata'
))

const assertStartTurnModalCommandType = (
  command: UpdateStartTurnModalLivePlayCommand,
  expectedType: StartTurnModalLivePlayCommandType | undefined,
): void => {
  if (expectedType && command.type !== expectedType) {
    rejectLivePlayCommand('invalid', `This route only accepts ${expectedType} commands`)
  }
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.UPDATE_START_TURN_MODAL) {
    rejectLivePlayCommand('invalid', 'Start-of-turn modal live-play route supports updateStartTurnModal commands only')
  }
  if (!metadataScopeMatches(command.scopes)) {
    rejectLivePlayCommand('invalid', 'updateStartTurnModal scopes must include the map metadata scope')
  }
}

const expectStartTurnModalPayload = (
  payload: unknown,
): StartTurnModalStateUpdatePayload => {
  const normalized = normalizeStartTurnModalStateUpdatePayload(payload)
  if (normalized !== null) return normalized
  return rejectLivePlayCommand('invalid', 'updateStartTurnModal payload is invalid')
}

const turnRefsEqual = (
  left: StartTurnModalTurnRef | null,
  right: StartTurnModalTurnRef,
): boolean => Boolean(left && left.activeId === right.activeId && left.round === right.round)

const resolveContext = async (
  command: UpdateStartTurnModalLivePlayCommand,
  role: AuthRole,
  dependencies: StartTurnModalDependencySet,
): Promise<ResolvedStartTurnModalContext> => {
  const map = await dependencies.mapRepository.getBySlug(command.mapSlug)
  if (!map) throw new StartTurnModalCommandUseCaseError(404, `Map ${command.mapSlug}.json not found`)
  if (!canAccessMapForRole(role, map)) throw new StartTurnModalCommandUseCaseError(403, 'You do not have access to this map')

  const payload = expectStartTurnModalPayload(command.payload)
  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
    payload,
  }
}

const normalizeD20Roll = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 20 ? value : undefined
)

const applyStartTurnModalCommand = (
  context: ResolvedStartTurnModalContext,
  timestamp: number,
  rollD20: () => number,
): ResolvedStartTurnModalContext => {
  const activeTurn = currentTurnRef(context.map)
  if (!turnRefsEqual(activeTurn, context.payload)) {
    rejectLivePlayCommand('conflict', 'Cannot update a start-of-turn modal that is not the current active turn', {
      currentState: activeTurn,
    })
  }

  const previous = readStartTurnModalState(context.map.metadata)
  if (context.payload.action === 'dismiss' && startTurnModalDismissalMatches(previous.dismissedTurn, context.payload)) {
    rejectLivePlayCommand('no-op', 'The current start-of-turn modal is already dismissed', {
      currentState: previous,
    })
  }

  const conditionRoll = context.payload.action === 'resolveCondition' && context.payload.resolution === 'roll'
    ? normalizeD20Roll(rollD20())
    : undefined
  const next = applyStartTurnModalStateUpdate(previous, context.payload, {
    dismissedAt: timestamp,
    resolvedAt: timestamp,
    ...(conditionRoll === undefined ? {} : { conditionRoll }),
  })
  return {
    ...context,
    map: {
      ...context.map,
      metadata: writeStartTurnModalState(context.map.metadata, next),
    },
  }
}

const metadataPatch = (
  command: UpdateStartTurnModalLivePlayCommand,
  revision: number,
  previousContext: ResolvedStartTurnModalContext,
  nextContext: ResolvedStartTurnModalContext,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_METADATA> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
  mapSlug: command.mapSlug,
  revision,
  scopes: command.scopes,
  payload: {
    action: nextContext.payload.action,
    previous: previousContext.map.metadata ?? {},
    current: nextContext.map.metadata ?? {},
  },
})

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const responseFromContext = (
  result: LivePlayCommandResult,
  context: ResolvedStartTurnModalContext | null,
): StartTurnModalLivePlayCommandResponse => ({
  result,
  ...(context ? {
    path: context.relativePath,
    map: context.map,
  } : {}),
})

const currentContextForAcceptedResult = async (
  result: LivePlayCommandAccepted,
  role: AuthRole,
  dependencies: StartTurnModalDependencySet,
): Promise<ResolvedStartTurnModalContext | null> => {
  try {
    const map = await dependencies.mapRepository.getBySlug(result.mapSlug)
    if (!map || !canAccessMapForRole(role, map)) return null
    const mapPath = mapPathForDocument(map)
    const activeTurn = currentTurnRef(map)
    return {
      mapPath,
      relativePath: dependencies.relativePath(mapPath),
      map,
      payload: {
        action: 'dismiss',
        activeId: activeTurn?.activeId ?? 'unknown',
        round: activeTurn?.round ?? 1,
      },
    }
  } catch {
    return null
  }
}

export const executeStartTurnModalLivePlayCommandUseCase = async (
  input: ExecuteStartTurnModalLivePlayCommandInput,
  dependencies: StartTurnModalCommandDependencies = {},
): Promise<StartTurnModalLivePlayCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedStartTurnModalContext | null = null

  const result = await deps.commandExecutor.execute<UpdateStartTurnModalLivePlayCommand, ResolvedStartTurnModalContext, StartTurnModalLivePlayActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
    },
    readMap: ({ command }) => resolveContext(command, input.role, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    authorize: ({ command, actor }) => {
      assertStartTurnModalCommandType(command, input.expectedType)
      expectStartTurnModalPayload(command.payload)
      if (actor.role !== 'gm') {
        rejectLivePlayCommand('unauthorized', 'Only GMs can manage start-of-turn modals')
      }
    },
    apply: ({ command, map, currentRevision }) => {
      const updatedAt = deps.now()
      const nextContext = applyStartTurnModalCommand(map, updatedAt, deps.rollD20)
      const revision = nextRevision(currentRevision)
      const nextMapContext = {
        ...nextContext,
        map: {
          ...nextContext.map,
          revision,
          updatedAt,
        },
      }
      return {
        status: 'accepted',
        nextMap: nextMapContext,
        previousRevision: currentRevision,
        revision,
        patches: [metadataPatch(command, revision, map, nextMapContext)],
      }
    },
    persist: async ({ actor, command, currentRevision, nextMap, result }) => {
      const persisted = toPersistedMap(nextMap.map, nextMap.mapPath, nextMap.map.updatedAt ?? deps.now(), { revision: result.revision })
      const updateResult = await deps.mapRepository.applyLivePlayUpdate({
        slug: result.mapSlug,
        expectedRevision: currentRevision,
        nextMap: persisted,
      })
      if (updateResult === 'stale') {
        throw new StartTurnModalCommandUseCaseError(409, `Map ${result.mapSlug} changed before the live-play start-of-turn modal command could be persisted`)
      }
      const authoritativeMap = await deps.mapRepository.getBySlug(result.mapSlug)
      if (!authoritativeMap) throw new StartTurnModalCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after live-play start-of-turn modal command`)
      persistedContext = {
        ...nextMap,
        map: authoritativeMap,
      }
      void actor
      void command
    },
    publish: ({ actor, result }) => {
      if (!persistedContext) return
      deps.publishRealtimeEvent(livePlayCommandAcceptedRealtimeEvent(result, actor.clientId))
    },
  })

  const responseContext = persistedContext
    ?? (isAcceptedResult(result) ? await currentContextForAcceptedResult(result, input.role, deps) : null)
  return responseFromContext(result, responseContext)
}
