import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayMapScope,
  type LivePlayPatch,
  type SceneLifecyclePatchPayload,
  type SceneUpdatedPatchPayload,
  type SetSceneLivePlayCommand,
  type SetScenePayload,
} from '#shared/livePlayCommands'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AuthRole } from '#shared/auth'
import type { CharacterSheet } from '~/types/characterSheet'
import type { MapSceneState, SheetKind, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  createMapSceneState,
  mapSceneStatesEqual,
  normalizeMapSceneName,
  normalizeMapSceneState,
} from '~/utils/mapSceneState'
import { deepCloneJson } from '~/utils/serialization'
import { toPersistableSheetPayload } from '~/utils/sheets/persistence'
import {
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../livePlay/sqliteCommandExecutor'
import { livePlaySheetUpdateRealtimeAppendInputs } from '../livePlay/sheetUpdateRealtime'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import {
  SheetRevisionConflictError,
  sqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import {
  createSqlitePendingMoveResolutionRepository,
  type PendingMoveResolutionRepository,
  type StoredPendingMoveResolution,
} from '../storage/pendingMoveResolutionRepository'
import {
  encounterLifecyclePatchPayload,
} from '../domain/moveAutomation/lifecyclePatch'
import {
  createSceneLifecycleEvents,
  planSceneLifecycle,
  type SceneLifecyclePlan,
} from '../domain/moveAutomation/planSceneLifecycle'
import {
  DeclarationCompensationError,
  planPendingResolutionTermination,
  type PendingResolutionTerminationPlan,
} from '../domain/moveAutomation/declarationCompensation'
import { pendingResolutionGameEventExpiry } from '../domain/moveAutomation/pendingResolutionExpiry'
import type { EncounterLifecycleTriggerHandler } from '../domain/moveAutomation/reduceLifecycle'
import {
  logicalMapResourcePath,
  logicalSheetResourcePath,
} from '../utils/runtimeResourcePaths'
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

export interface LivePlaySceneCommandSheetUpdate {
  readonly kind: SheetKind
  readonly slug: string
  readonly path: string
  readonly sheet: Record<string, unknown>
}

export interface LivePlaySceneCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
  readonly activeScene?: MapSceneState | null
  readonly sheetUpdates?: readonly LivePlaySceneCommandSheetUpdate[]
}

export interface LivePlaySceneCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly mapRepository?: Pick<MapRepository, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly database?: Pick<RotomDatabase, 'withTransaction'>
  readonly sheetRepository?: SceneSheetRepository
  readonly pendingResolutionRepository?: Pick<
    PendingMoveResolutionRepository,
    'getById' | 'listByMap' | 'update'
  >
  readonly now?: () => number
  readonly relativePath?: (path: string) => string
  /** Server-owned trigger registry seam; production registrations are never client supplied. */
  readonly lifecycleHandlers?: readonly EncounterLifecycleTriggerHandler[]
}

interface ScenePendingResolutionTermination {
  readonly stored: StoredPendingMoveResolution
  readonly plan: PendingResolutionTerminationPlan
}

interface SceneCommitPlan {
  readonly lifecycle: SceneLifecyclePlan
  readonly pendingTerminations: readonly ScenePendingResolutionTermination[]
}

interface ResolvedSceneContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
  readonly commitPlan?: SceneCommitPlan
  readonly sheetUpdates?: readonly LivePlaySceneCommandSheetUpdate[]
}

interface AppliedSceneChange {
  readonly previous: MapSceneState | null
  readonly current: MapSceneState | null
  readonly nextMap: TabletopMap
  readonly commitPlan: SceneCommitPlan
}

type SceneSheetRepository = Pick<
  SheetRepository<Record<string, unknown>>,
  'get' | 'getByRef' | 'assertRevisions' | 'applyLivePlayUpdate'
>
type LivePlaySceneDependencySet = ReturnType<typeof actionDependencies>
type UnknownRecord = Record<string, unknown>

const livePlaySceneCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const actionDependencies = (dependencies: LivePlaySceneCommandDependencies) => {
  const injectedDatabase = dependencies.database
  const repositoryDatabase = injectedDatabase && 'connection' in injectedDatabase
    ? injectedDatabase as RotomDatabase
    : (injectedDatabase === undefined ? getRotomDatabase() : null)
  const database = injectedDatabase ?? repositoryDatabase!
  const pendingResolutionRepository = dependencies.pendingResolutionRepository
    ?? (repositoryDatabase
      ? createSqlitePendingMoveResolutionRepository(repositoryDatabase)
      : {
          getById: () => null,
          listByMap: () => [],
          update: () => { throw new Error('Pending resolution updates require a repository.') },
        })
  return {
    commandExecutor: dependencies.commandExecutor ?? livePlaySceneCommandExecutor,
    mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
    database,
    sheetRepository: dependencies.sheetRepository ?? (sqliteSheetRepository as SceneSheetRepository),
    pendingResolutionRepository,
    now: dependencies.now ?? Date.now,
    relativePath: dependencies.relativePath ?? ((path: string) => path),
    lifecycleHandlers: dependencies.lifecycleHandlers ?? [],
  }
}

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => logicalMapResourcePath(map)

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

const sceneBoundaryTimestamp = (
  map: TabletopMap,
  previous: MapSceneState | null,
  requested: number,
): number => {
  const candidates = [requested, map.updatedAt, previous?.startedAt]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .map(value => Math.max(0, Math.trunc(value)))
  const latestPersisted = Math.max(0, ...candidates.slice(1))
  return Math.max(candidates[0] ?? 0, latestPersisted + 1)
}

const lifecycleSheetSnapshots = (
  map: TabletopMap,
  repository: SceneSheetRepository,
): {
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
} => {
  const pokemonSheets = new Map<string, CharacterSheet>()
  const trainerSheets = new Map<string, TrainerSheet>()
  const seen = new Set<string>()
  for (const placement of map.placements) {
    const key = `${placement.sheetKind}:${placement.sheetSlug}`
    if (seen.has(key)) continue
    seen.add(key)
    const stored = repository.get(placement.sheetKind, placement.sheetSlug)
    if (!stored) continue
    const sheet = stored.document as unknown as CharacterSheet | TrainerSheet
    if (placement.sheetKind === 'pokemon') pokemonSheets.set(placement.sheetSlug, sheet as CharacterSheet)
    else trainerSheets.set(placement.sheetSlug, sheet as TrainerSheet)
  }
  return { pokemonSheets, trainerSheets }
}

type SceneSheetSnapshots = ReturnType<typeof lifecycleSheetSnapshots>

const snapshotsAfterTermination = (
  snapshots: SceneSheetSnapshots,
  termination: PendingResolutionTerminationPlan,
): SceneSheetSnapshots => {
  const pokemonSheets = new Map(snapshots.pokemonSheets)
  const trainerSheets = new Map(snapshots.trainerSheets)
  for (const write of termination.sheetWrites) {
    if (write.kind === 'pokemon') {
      pokemonSheets.set(write.slug, deepCloneJson(write.nextSheet) as CharacterSheet)
    }
    else {
      trainerSheets.set(write.slug, deepCloneJson(write.nextSheet) as TrainerSheet)
    }
  }
  return { pokemonSheets, trainerSheets }
}

const compensationSnapshots = (
  map: TabletopMap,
  stored: readonly StoredPendingMoveResolution[],
  repository: SceneSheetRepository,
): SceneSheetSnapshots => {
  const snapshots = lifecycleSheetSnapshots(map, repository)
  const pokemonSheets = new Map(snapshots.pokemonSheets)
  const trainerSheets = new Map(snapshots.trainerSheets)
  for (const pending of stored) {
    for (const group of pending.declarationPlan?.groups.sheets ?? []) {
      const destination = group.scope.sheetKind === 'pokemon' ? pokemonSheets : trainerSheets
      if (destination.has(group.scope.sheetSlug)) continue
      const sheet = repository.get(group.scope.sheetKind, group.scope.sheetSlug)
      if (!sheet) continue
      const document = {
        ...sheet.document,
        slug: sheet.slug,
        revision: sheet.revision,
        updatedAt: sheet.updatedAt,
      }
      if (group.scope.sheetKind === 'pokemon') {
        pokemonSheets.set(group.scope.sheetSlug, document as unknown as CharacterSheet)
      }
      else {
        trainerSheets.set(group.scope.sheetSlug, document as unknown as TrainerSheet)
      }
    }
  }
  return { pokemonSheets, trainerSheets }
}

const applySceneChange = (
  command: SetSceneLivePlayCommand,
  context: ResolvedSceneContext,
  dependencies: Pick<
    LivePlaySceneDependencySet,
    'sheetRepository' | 'pendingResolutionRepository' | 'lifecycleHandlers'
  >,
  timestamp: number,
): AppliedSceneChange => {
  const payload = expectSetScenePayload(command.payload)
  const previous = activeSceneState(context.map)
  const boundaryTime = sceneBoundaryTimestamp(context.map, previous, timestamp)
  const current = payload.name === null
    ? null
    : createMapSceneState(payload.name, boundaryTime)

  if (mapSceneStatesEqual(previous, current)) {
    rejectLivePlayCommand('no-op', 'The requested scene change is already reflected in authoritative state', {
      currentState: previous,
    })
  }

  const events = createSceneLifecycleEvents({
    mapSlug: context.map.slug,
    previous,
    current,
    operationId: command.opId,
  })
  const pending = dependencies.pendingResolutionRepository
    .listByMap(context.map.slug)
    .filter(candidate => candidate.status === 'pending')
    .reverse()
  let workingMap = deepCloneJson(context.map)
  let snapshots = compensationSnapshots(workingMap, pending, dependencies.sheetRepository)
  const pendingTerminations: ScenePendingResolutionTermination[] = []
  for (const stored of pending) {
    const expiry = pendingResolutionGameEventExpiry(stored.resolution, events)
    if (!expiry) continue
    try {
      const plan = planPendingResolutionTermination({
        pendingResolution: stored.resolution,
        declarationPlan: stored.declarationPlan ?? null,
        map: workingMap,
        ...snapshots,
        status: expiry.status,
        reasonCode: expiry.reasonCode,
        sourceOperationId: expiry.sourceOperationId,
        terminatedAt: boundaryTime,
      })
      pendingTerminations.push({ stored, plan })
      workingMap = plan.nextMap
      snapshots = snapshotsAfterTermination(snapshots, plan)
    }
    catch (error) {
      if (error instanceof DeclarationCompensationError) {
        rejectLivePlayCommand(
          'conflict',
          `Pending move ${stored.resolutionId} could not expire safely: ${error.message}`,
          { currentRevision: normalizeRevision(context.map.revision) },
        )
      }
      throw error
    }
  }

  const lifecycle = planSceneLifecycle({
    map: workingMap,
    previous,
    current,
    operationId: command.opId,
    time: boundaryTime,
    loadSheets: () => snapshots,
    handlers: dependencies.lifecycleHandlers,
  })

  return {
    previous,
    current,
    nextMap: lifecycle.nextMap,
    commitPlan: { lifecycle, pendingTerminations },
  }
}

const sceneLifecyclePatchPayload = (
  lifecycle: SceneLifecyclePlan,
): SceneLifecyclePatchPayload => ({
  ...encounterLifecyclePatchPayload({
    events: lifecycle.events,
    reductions: lifecycle.reductions,
    previousEncounterState: lifecycle.previousEncounterState,
    currentEncounterState: lifecycle.currentEncounterState,
    previousTemporaryHitPoints: lifecycle.previousTemporaryHitPoints,
    currentTemporaryHitPoints: lifecycle.currentTemporaryHitPoints,
    sheetWrites: lifecycle.sheetWrites,
  }),
  previousMoveUsage: lifecycle.previousMoveUsage === undefined
    ? null
    : deepCloneJson(lifecycle.previousMoveUsage),
  currentMoveUsage: lifecycle.currentMoveUsage === undefined
    ? null
    : deepCloneJson(lifecycle.currentMoveUsage),
})

const commandPatch = (
  command: SetSceneLivePlayCommand,
  revision: number,
  change: AppliedSceneChange,
): LivePlayPatch<
  typeof LIVE_PLAY_PATCH_TYPES.MAP_SCENE,
  SceneUpdatedPatchPayload,
  LivePlayMapScope
> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.MAP_SCENE,
  mapSlug: command.mapSlug,
  revision,
  scopes: [sceneScope()],
  payload: {
    command: command.type,
    previous: change.previous,
    current: change.current,
    lifecycle: sceneLifecyclePatchPayload(change.commitPlan.lifecycle),
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

const sheetUpdateFromPersisted = (
  sheet: PersistedSheet,
  dependencies: LivePlaySceneDependencySet,
): LivePlaySceneCommandSheetUpdate => ({
  kind: sheet.kind,
  slug: sheet.slug,
  path: dependencies.relativePath(logicalSheetResourcePath(sheet.kind, sheet.sheet)),
  sheet: deepCloneJson(sheet.sheet),
})

const lifecycleSheetChangesFromAccepted = (
  result: LivePlayCommandAccepted,
): readonly SceneLifecyclePatchPayload['sheetChanges'][number][] => {
  const patch = result.patches.find(candidate => candidate.type === LIVE_PLAY_PATCH_TYPES.MAP_SCENE)
  if (!patch || !isRecord(patch.payload) || !isRecord(patch.payload.lifecycle)) return []
  return Array.isArray(patch.payload.lifecycle.sheetChanges)
    ? patch.payload.lifecycle.sheetChanges as SceneLifecyclePatchPayload['sheetChanges']
    : []
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
    ...(context.sheetUpdates?.length ? { sheetUpdates: [...context.sheetUpdates] } : {}),
  } : {}),
})

const acceptedResult = (
  result: LivePlayCommandResult,
): LivePlayCommandAccepted | null => {
  if (!result.ok) return null
  if ('duplicate' in result) return result.original.ok ? result.original : null
  return result
}

const currentContextForAcceptedResult = async (
  result: LivePlayCommandAccepted,
  dependencies: LivePlaySceneDependencySet,
): Promise<ResolvedSceneContext | null> => {
  try {
    const map = await dependencies.mapRepository.getBySlug(result.mapSlug)
    if (!map) return null
    const sheetUpdates = lifecycleSheetChangesFromAccepted(result).flatMap((ref) => {
      const sheet = dependencies.sheetRepository.getByRef(ref.kind, ref.slug)
      return sheet ? [sheetUpdateFromPersisted(sheet, dependencies)] : []
    })
    const mapPath = mapPathForDocument(map)
    return {
      mapPath,
      relativePath: dependencies.relativePath(mapPath),
      map,
      ...(sheetUpdates.length ? { sheetUpdates } : {}),
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
      const change = applySceneChange(command, map, deps, deps.now())
      const revision = nextRevision(currentRevision)
      const nextMap = {
        ...map,
        map: {
          ...change.nextMap,
          revision,
        },
        commitPlan: change.commitPlan,
      }

      return {
        status: 'accepted',
        nextMap,
        previousRevision: currentRevision,
        revision,
        patches: [commandPatch(command, revision, change)],
      }
    },
    persist: () => {
      throw new Error('live-play scene commands must persist through the accepted-result commit hook')
    },
    commit: ({
      actor,
      command,
      currentRevision,
      nextMap,
      result,
      recordRealtimeEvents,
      saveOpResult,
    }) => {
      deps.database.withTransaction(() => {
        const commitPlan = nextMap.commitPlan!
        const lifecycle = commitPlan.lifecycle
        for (const termination of commitPlan.pendingTerminations) {
          const current = deps.pendingResolutionRepository.getById(
            termination.stored.resolutionId,
          )
          if (
            !current
            || current.status !== 'pending'
            || current.revision !== termination.stored.revision
          ) {
            rejectLivePlayCommand(
              'conflict',
              `Pending move ${termination.stored.resolutionId} changed before scene-end expiry.`,
              { currentRevision },
            )
          }
          for (const write of termination.plan.sheetWrites) {
            const sheetResult = deps.sheetRepository.applyLivePlayUpdate({
              kind: write.kind,
              slug: write.slug,
              expectedRevision: write.expectedRevision,
              nextSheet: {
                ...toPersistableSheetPayload(write.nextSheet as unknown as Record<string, unknown>),
                slug: write.slug,
                updatedAt: nextMap.map.updatedAt ?? deps.now(),
              },
            })
            if (sheetResult === 'stale') {
              rejectLivePlayCommand(
                'conflict',
                `${write.kind} sheet ${write.slug} changed before pending declaration compensation could be persisted`,
                { currentRevision },
              )
            }
          }
        }

        try {
          if (lifecycle.sheetReads.length > 0) {
            deps.sheetRepository.assertRevisions(lifecycle.sheetReads)
          }
        } catch (error) {
          if (error instanceof SheetRevisionConflictError) {
            rejectLivePlayCommand(
              'conflict',
              'A sheet consulted while changing the scene changed before commit. Refresh and retry.',
              { currentRevision },
            )
          }
          throw error
        }

        const persisted = toPersistedMap(
          nextMap.map,
          nextMap.map.folder ?? '',
          nextMap.map.updatedAt ?? deps.now(),
          { revision: result.revision },
        )
        const mapResult = deps.mapRepository.applyLivePlayUpdate({
          slug: result.mapSlug,
          expectedRevision: currentRevision,
          nextMap: persisted,
        })
        if (mapResult === 'stale') {
          rejectLivePlayCommand(
            'conflict',
            `Map ${result.mapSlug} changed before the live-play scene command could be persisted`,
            { currentRevision },
          )
        }

        for (const write of lifecycle.sheetWrites) {
          const nextSheet = {
            ...toPersistableSheetPayload(write.nextSheet as unknown as Record<string, unknown>),
            slug: write.slug,
            updatedAt: nextMap.map.updatedAt ?? deps.now(),
          }
          const sheetResult = deps.sheetRepository.applyLivePlayUpdate({
            kind: write.kind,
            slug: write.slug,
            expectedRevision: write.expectedRevision,
            nextSheet,
          })
          if (sheetResult === 'stale') {
            rejectLivePlayCommand(
              'conflict',
              `${write.kind} sheet ${write.slug} changed before scene lifecycle effects could be persisted`,
              { currentRevision },
            )
          }
        }

        for (const termination of commitPlan.pendingTerminations) {
          deps.pendingResolutionRepository.update({
            resolution: termination.plan.pendingResolution,
            expectedRevision: termination.stored.revision,
          })
        }

        const finalSheetRevisions = new Map<string, {
          readonly kind: SheetKind
          readonly slug: string
          readonly revision: number
        }>()
        for (const termination of commitPlan.pendingTerminations) {
          for (const write of termination.plan.sheetWrites) {
            finalSheetRevisions.set(`${write.kind}:${write.slug}`, write)
          }
        }
        for (const write of lifecycle.sheetWrites) {
          finalSheetRevisions.set(`${write.kind}:${write.slug}`, write)
        }
        const sheetUpdates = [...finalSheetRevisions.values()].map((write) => {
          const sheet = deps.sheetRepository.getByRef(write.kind, write.slug)
          if (!sheet) {
            throw new LivePlaySceneCommandUseCaseError(
              404,
              `${write.kind} sheet ${write.slug} not found after scene lifecycle commit`,
            )
          }
          if (normalizeRevision(sheet.revision) !== write.revision) {
            throw new LivePlaySceneCommandUseCaseError(
              409,
              `${write.kind} sheet ${write.slug} committed revision ${sheet.revision} instead of ${write.revision}`,
            )
          }
          return sheetUpdateFromPersisted(sheet, deps)
        })
        recordRealtimeEvents(livePlaySheetUpdateRealtimeAppendInputs({
          command,
          updates: sheetUpdates,
          clientId: actor.clientId,
        }))
        saveOpResult()

        const authoritativeMap = deps.mapRepository.getBySlug(result.mapSlug)
        if (!authoritativeMap) {
          throw new LivePlaySceneCommandUseCaseError(
            404,
            `Map ${result.mapSlug}.json not found after live-play scene command`,
          )
        }
        persistedContext = {
          mapPath: nextMap.mapPath,
          relativePath: nextMap.relativePath,
          map: authoritativeMap,
          ...(sheetUpdates.length ? { sheetUpdates } : {}),
        }
      })
    },
  })

  const accepted = acceptedResult(result)
  const responseContext = persistedContext
    ?? (accepted ? await currentContextForAcceptedResult(accepted, deps) : null)
  return responseFromContext(result, responseContext)
}
