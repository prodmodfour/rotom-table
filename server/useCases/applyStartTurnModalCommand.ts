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
import {
  applyStartTurnModalStateUpdate,
  normalizeStartTurnModalStateUpdatePayload,
  readStartTurnModalState,
  startTurnModalDismissalMatches,
  writeStartTurnModalState,
  type StartTurnModalStateUpdatePayload,
  type StartTurnModalTurnRef,
} from '#shared/startTurnModalState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../livePlay/sqliteCommandExecutor'
import { canAccessMapForRole } from '../policies/mapPolicy'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import {
  sqliteSheetRepository,
  type SheetRepository,
  type SheetRevisionExpectation,
} from '../storage/sheetRepository'
import { aa068EarlyBirdSleepSaveBonus } from '../domain/abilityAutomation/mechanics/aa068StaticIntegration'
import { aa069EnduringRagePreventsSave } from '../domain/abilityAutomation/mechanics/aa069StaticIntegration'
import { effectiveRuntimeAbilityIds } from '../domain/abilityAutomation/effectiveRuntimeAbilities'
import { normalizeConditionName } from '~/utils/statusConditions'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { commitLivePlayMapUpdate } from './livePlayMapPersistence'
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
  readonly sheetRepository?: Pick<SheetRepository, 'getByRef' | 'assertRevisions'>
  readonly database?: Pick<RotomDatabase, 'withTransaction'>
  readonly now?: () => number
  readonly rollD20?: () => number
  readonly relativePath?: (path: string) => string
}

interface ResolvedStartTurnModalContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
  readonly payload: StartTurnModalStateUpdatePayload
  readonly conditionRollModifier: number
  readonly forcedConditionSaveFailureEffectId: string | null
  readonly sheetRevisionExpectation: SheetRevisionExpectation | null
}

type StartTurnModalDependencySet = ReturnType<typeof actionDependencies>

const livePlayStartTurnModalCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const actionDependencies = (dependencies: StartTurnModalCommandDependencies) => ({
  commandExecutor: dependencies.commandExecutor ?? livePlayStartTurnModalCommandExecutor,
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  sheetRepository: dependencies.sheetRepository ?? sqliteSheetRepository,
  database: dependencies.database ?? getRotomDatabase(),
  now: dependencies.now ?? Date.now,
  rollD20: dependencies.rollD20 ?? (() => Math.floor(Math.random() * 20) + 1),
  relativePath: dependencies.relativePath ?? ((path: string) => path),
})

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => logicalMapResourcePath(map)

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
  const needsConditionRollSheet = payload.action === 'resolveCondition'
    && payload.resolution === 'roll'
  const activePlacement = needsConditionRollSheet
    ? map.placements.find(placement => placement.id === payload.activeId) ?? null
    : null
  if (needsConditionRollSheet && !activePlacement) {
    throw new StartTurnModalCommandUseCaseError(404, 'The active placement no longer exists')
  }
  const storedSheet = activePlacement
    ? dependencies.sheetRepository.getByRef(activePlacement.sheetKind, activePlacement.sheetSlug)
    : null
  if (activePlacement && !storedSheet) {
    throw new StartTurnModalCommandUseCaseError(404, 'The active placement sheet no longer exists')
  }
  const effectiveAbilityIds = storedSheet && activePlacement
    ? effectiveRuntimeAbilityIds({
        map,
        placement: activePlacement,
        sheet: storedSheet.sheet as unknown as CharacterSheet | TrainerSheet,
      })
    : []
  const canonicalCondition = payload.action === 'resolveCondition'
    ? normalizeConditionName(payload.condition) : null
  if (storedSheet && activePlacement && payload.action === 'resolveCondition'
    && payload.resolution === 'roll'
    && (aa069EnduringRagePreventsSave({
      map,
      placement: activePlacement,
      sheet: storedSheet.sheet as unknown as CharacterSheet | TrainerSheet,
      condition: payload.condition,
    }) || (canonicalCondition === 'Rage' && effectiveAbilityIds.includes('White Flame')))) {
    throw new StartTurnModalCommandUseCaseError(409, `${effectiveAbilityIds.includes('White Flame') ? 'White Flame' : 'Enduring Rage'} prevents Save Checks to cure Enraged.`)
  }
  const truantSaveBonus = activePlacement && map.encounterState?.effects.some(effect => (
    effect.tags.includes('aa096-truant-refused-turn')
    && effect.affected.placementIds.includes(activePlacement.id)
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
  )) ? 3 : 0
  const forcedConditionSaveFailureEffectId = activePlacement
    && canonicalCondition === 'Paralysis'
    && payload.action === 'resolveCondition'
    && payload.resolution === 'roll'
    ? map.encounterState?.effects.find(effect => (
        effect.tags.includes('aa095-tingly-tongue-fail-next-paralysis-save')
        && effect.affected.placementIds.includes(activePlacement.id)
        && effect.suppression.sources.length === 0
        && (effect.duration.remaining === null || effect.duration.remaining > 0)
      ))?.id ?? null
    : null
  const conditionRollModifier = storedSheet && activePlacement && payload.action === 'resolveCondition'
    ? aa068EarlyBirdSleepSaveBonus({
        map,
        placement: activePlacement,
        sheet: storedSheet.sheet as unknown as CharacterSheet | TrainerSheet,
        condition: payload.condition,
      }) + truantSaveBonus
    : 0
  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
    payload,
    conditionRollModifier: forcedConditionSaveFailureEffectId ? -100 : conditionRollModifier,
    forcedConditionSaveFailureEffectId,
    sheetRevisionExpectation: storedSheet ? {
      kind: storedSheet.kind,
      slug: storedSheet.slug,
      revision: storedSheet.revision,
    } : null,
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

  const forcedFailure = context.forcedConditionSaveFailureEffectId !== null
    && context.payload.action === 'resolveCondition'
    && context.payload.resolution === 'roll'
  const conditionRoll = context.payload.action === 'resolveCondition' && context.payload.resolution === 'roll'
    ? forcedFailure ? 1 : normalizeD20Roll(rollD20())
    : undefined
  const next = applyStartTurnModalStateUpdate(previous, context.payload, {
    dismissedAt: timestamp,
    resolvedAt: timestamp,
    ...(conditionRoll === undefined ? {} : {
      conditionRoll,
      conditionRollModifier: context.conditionRollModifier,
    }),
  })
  const encounterState = context.forcedConditionSaveFailureEffectId
    ? parseEncounterState({
        ...context.map.encounterState,
        effects: (context.map.encounterState?.effects ?? []).filter(effect => (
          effect.id !== context.forcedConditionSaveFailureEffectId
        )),
      })
    : context.map.encounterState
  return {
    ...context,
    forcedConditionSaveFailureEffectId: null,
    map: {
      ...context.map,
      encounterState,
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
      conditionRollModifier: 0,
      forcedConditionSaveFailureEffectId: null,
      sheetRevisionExpectation: null,
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
    persist: () => {
      throw new Error('live-play start-of-turn modal commands must persist through the accepted-result commit hook')
    },
    commit: ({ actor, command, currentRevision, nextMap, result, saveOpResult }) => {
      if (nextMap.sheetRevisionExpectation) {
        deps.sheetRepository.assertRevisions([nextMap.sheetRevisionExpectation])
      }
      const persisted = toPersistedMap(nextMap.map, nextMap.map.folder ?? '', nextMap.map.updatedAt ?? deps.now(), { revision: result.revision })
      const authoritativeMap = commitLivePlayMapUpdate({
        database: deps.database,
        mapRepository: deps.mapRepository,
        mapSlug: result.mapSlug,
        expectedRevision: currentRevision,
        nextMap: persisted,
        staleError: () => new StartTurnModalCommandUseCaseError(409, `Map ${result.mapSlug} changed before the live-play start-of-turn modal command could be persisted`),
        missingMapError: () => new StartTurnModalCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after live-play start-of-turn modal command`),
        saveOpResult,
      })
      persistedContext = {
        ...nextMap,
        map: authoritativeMap,
      }
      void actor
      void command
    },
  })

  const responseContext = persistedContext
    ?? (isAcceptedResult(result) ? await currentContextForAcceptedResult(result, input.role, deps) : null)
  return responseFromContext(result, responseContext)
}
