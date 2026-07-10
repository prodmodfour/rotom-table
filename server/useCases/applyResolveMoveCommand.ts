import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayPatch,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { normalizeRevision } from '#shared/sessionRevisions'
import {
  LIVE_PLAY_RESOLVED_MOVE_RESULT_SCHEMA_VERSION,
  parseLivePlayResolvedMoveResult,
  parseResolveMoveIntent,
  type LivePlayResolvedMoveResult,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createLivePlayMovePresentationSummary } from '#shared/livePlayMovePresentation'
import {
  parseLivePlayMoveStatePatchPayload,
  type LivePlayMoveSheetChangeRef,
  type LivePlayMoveStatePatchChanges,
  type LivePlayMoveStatePatchPayload,
} from '#shared/livePlayMoveState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import { toPersistableSheetPayload } from '~/utils/sheets/persistence'
import {
  planAuthoritativeMoveState,
  isAuthoritativeMoveStatePlanningError,
  type AuthoritativeMoveStatePlan,
  type PlanAuthoritativeMoveStateInput,
} from '../domain/planAuthoritativeMoveState'
import type { AuthoritativeMoveRandomSource } from '../domain/moveAutomation/random'
import { summarizeMoveResolutionTrace } from '../domain/moveAutomation/trace'
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControl,
  type ServerTokenControlLinkedTrainerSheet,
} from '../policies/playerProfileTokenControlPolicy'
import { canAccessMapForRole } from '../policies/mapPolicy'
import {
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../livePlay/sqliteCommandExecutor'
import { livePlaySheetUpdateRealtimeAppendInputs } from '../livePlay/sheetUpdateRealtime'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  createSqliteMapRepository,
  type MapRepository,
} from '../storage/mapRepository'
import {
  createSqliteSheetRepository,
  SheetRevisionConflictError,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import { logicalMapResourcePath, logicalSheetResourcePath } from '../utils/runtimeResourcePaths'
import { redactSheetUpdatesForPlayer } from '../utils/sheetPrivacy'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'
import { validateResolveMoveScopes } from './resolveMoveCommandScopes'

export class LivePlayResolveMoveCommandUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface LivePlayResolveMoveCommandActor {
  readonly role: AuthRole
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
}

export interface ExecuteLivePlayResolveMoveCommandInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
  readonly expectedType?: typeof LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE
}

export interface LivePlayResolveMoveCommandSheetUpdate {
  readonly kind: SheetKind
  readonly slug: string
  readonly path?: string
  readonly sheet: Record<string, unknown>
}

export interface LivePlayResolveMoveCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
  readonly sheetUpdates?: readonly LivePlayResolveMoveCommandSheetUpdate[]
  readonly move?: LivePlayResolvedMoveResult
}

export interface LivePlayResolveMoveCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly database?: Pick<RotomDatabase, 'withTransaction'> & Partial<RotomDatabase>
  readonly mapRepository?: Pick<MapRepository<TabletopMap>, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'assertRevisions' | 'applyLivePlayUpdate'>
  readonly planner?: (input: PlanAuthoritativeMoveStateInput) => AuthoritativeMoveStatePlan
  readonly random?: AuthoritativeMoveRandomSource
  readonly now?: () => number
  readonly idFactory?: () => string
  readonly maxMoveLogEntries?: number
  readonly relativePath?: (path: string) => string
}

interface ResolvedResolveMoveCommandContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
  readonly intent: ResolveMoveIntent
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly linkedTrainerSheets: readonly ServerTokenControlLinkedTrainerSheet[]
  readonly plan?: AuthoritativeMoveStatePlan
  readonly move?: LivePlayResolvedMoveResult
  readonly sheetUpdates?: readonly LivePlayResolveMoveCommandSheetUpdate[]
}

type DependencySet = ReturnType<typeof actionDependencies>
type UnknownRecord = Record<string, unknown>

const defaultNow = (): number => Date.now()

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const actionDependencies = (dependencies: LivePlayResolveMoveCommandDependencies) => {
  const database = dependencies.database ?? getRotomDatabase()
  const concreteDatabase = database as RotomDatabase
  const mapRepository = dependencies.mapRepository ?? createSqliteMapRepository<TabletopMap>(concreteDatabase)
  const sheetRepository = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(concreteDatabase)
  const commandExecutor = dependencies.commandExecutor ?? createSqliteAuthoritativeLivePlayCommandExecutor({
    database: concreteDatabase,
  })
  return {
    database,
    mapRepository,
    sheetRepository,
    commandExecutor,
    planner: dependencies.planner ?? planAuthoritativeMoveState,
    random: dependencies.random,
    now: dependencies.now ?? defaultNow,
    idFactory: dependencies.idFactory,
    maxMoveLogEntries: dependencies.maxMoveLogEntries,
    relativePath: dependencies.relativePath ?? ((path: string) => path),
  }
}

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => logicalMapResourcePath(map)

const tokenControlTrainerSheet = (sheet: PersistedSheet): ServerTokenControlLinkedTrainerSheet => ({
  slug: sheet.slug,
  ...(Array.isArray(sheet.sheet.currentTeam) ? { currentTeam: sheet.sheet.currentTeam } : {}),
  ...(Array.isArray(sheet.sheet.boxedPokemon) ? { boxedPokemon: sheet.sheet.boxedPokemon } : {}),
})

const linkedTrainerSheetsForActor = (
  actor: LivePlayResolveMoveCommandActor,
  dependencies: DependencySet,
): readonly ServerTokenControlLinkedTrainerSheet[] => playerProfileLinkedTrainerSheetsForTokenControl(
  actor.playerProfile,
  (slug) => {
    const sheet = dependencies.sheetRepository.getByRef('trainer', slug)
    return sheet ? tokenControlTrainerSheet(sheet) : null
  },
)

const persistedSheetRecord = (sheet: PersistedSheet): Record<string, unknown> => ({
  ...sheet.sheet,
  slug: sheet.slug,
  revision: sheet.revision,
  updatedAt: sheet.updatedAt,
})

const persistedPokemonSheet = (sheet: PersistedSheet): CharacterSheet => (
  persistedSheetRecord(sheet) as unknown as CharacterSheet
)

const persistedTrainerSheet = (sheet: PersistedSheet): TrainerSheet => (
  persistedSheetRecord(sheet) as unknown as TrainerSheet
)

const assertResolveMoveCommandType = (
  command: ResolveMoveLivePlayCommand,
  expectedType?: typeof LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
): void => {
  if (expectedType && command.type !== expectedType) {
    rejectLivePlayCommand('invalid', `This route only accepts ${expectedType} commands`)
  }
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE) {
    rejectLivePlayCommand('invalid', 'This route only accepts resolveMove commands')
  }
}

const parseResolveMoveCommandIntent = (command: ResolveMoveLivePlayCommand): ResolveMoveIntent => {
  const parsed = parseResolveMoveIntent(command.payload)
  if (parsed.valid) return parsed.intent
  rejectLivePlayCommand(
    'invalid',
    `Invalid resolveMove intent: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    { currentState: { code: 'invalid-resolve-move-intent', issues: parsed.issues } },
  )
  throw new Error('unreachable')
}

const uniquePlacementSheetRefs = (
  placements: readonly SheetPlacement[],
): readonly { readonly kind: SheetKind; readonly slug: string }[] => {
  const refs: Array<{ kind: SheetKind; slug: string }> = []
  const seen = new Set<string>()
  for (const placement of placements) {
    const key = `${placement.sheetKind}:${placement.sheetSlug}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ kind: placement.sheetKind, slug: placement.sheetSlug })
  }
  return refs
}

const readAuthoritativeContext = (
  command: ResolveMoveLivePlayCommand,
  actor: LivePlayResolveMoveCommandActor,
  dependencies: DependencySet,
): ResolvedResolveMoveCommandContext => {
  assertResolveMoveCommandType(command)
  const intent = parseResolveMoveCommandIntent(command)
  const linkedTrainerSheets = linkedTrainerSheetsForActor(actor, dependencies)

  return dependencies.database.withTransaction(() => {
    const map = dependencies.mapRepository.getBySlug(command.mapSlug)
    if (!map) throw new LivePlayResolveMoveCommandUseCaseError(404, `Map ${command.mapSlug}.json not found`)

    if (!canAccessMapForRole(actor.role, map)) {
      throw new LivePlayResolveMoveCommandUseCaseError(403, 'Map is not player visible')
    }

    const pokemonSheets = new Map<string, CharacterSheet>()
    const trainerSheets = new Map<string, TrainerSheet>()
    for (const ref of uniquePlacementSheetRefs(map.placements)) {
      const sheet = dependencies.sheetRepository.getByRef(ref.kind, ref.slug)
      if (!sheet) continue
      if (ref.kind === 'pokemon') pokemonSheets.set(ref.slug, persistedPokemonSheet(sheet))
      else trainerSheets.set(ref.slug, persistedTrainerSheet(sheet))
    }

    const mapPath = mapPathForDocument(map)
    return {
      mapPath,
      relativePath: dependencies.relativePath(mapPath),
      map,
      intent,
      pokemonSheets,
      trainerSheets,
      linkedTrainerSheets,
    }
  })
}

const actorPlacement = (
  context: ResolvedResolveMoveCommandContext,
): SheetPlacement | null => context.map.placements.find((placement) => placement.id === context.intent.placementId) ?? null

const controlDeniedMessage = (role: AuthRole, profile: PlayerProfile | null | undefined): string => (
  role === 'player' && !profile
    ? 'Select a player profile to control linked map tokens'
    : 'Token is not linked to selected player profile'
)

const assertExactBaseRevision = (command: ResolveMoveLivePlayCommand, currentRevision: number): void => {
  if (command.baseRevision === currentRevision) return
  rejectLivePlayCommand('stale-revision', `resolveMove requires an exact map revision. Refresh and retry from revision ${currentRevision}.`, {
    currentRevision,
    currentState: { code: 'exact-map-revision-required', currentRevision },
  })
}

const plannerRejectionReason = (reason: string) => {
  if (reason === 'not-found') return 'not-found' as const
  if (reason === 'conflict' || reason === 'unauthorized-state') return 'conflict' as const
  return 'invalid' as const
}

const planMoveState = (
  context: ResolvedResolveMoveCommandContext,
  dependencies: DependencySet,
): AuthoritativeMoveStatePlan => {
  try {
    return dependencies.planner({
      map: context.map,
      pokemonSheets: context.pokemonSheets,
      trainerSheets: context.trainerSheets,
      intent: context.intent,
      random: dependencies.random,
      now: dependencies.now,
      idFactory: dependencies.idFactory,
      maxMoveLogEntries: dependencies.maxMoveLogEntries,
    })
  } catch (error) {
    if (isAuthoritativeMoveStatePlanningError(error)) {
      rejectLivePlayCommand(
        plannerRejectionReason(error.reason),
        error.message,
        { currentState: { code: error.code, reason: error.reason } },
      )
    }
    throw error
  }
}

const moveResultFromPlan = (plan: AuthoritativeMoveStatePlan): LivePlayResolvedMoveResult => {
  const clonedResolution = deepCloneJson(plan.resolution)
  const { auditTrace, ...publicResolution } = clonedResolution
  const candidate = {
    schemaVersion: LIVE_PLAY_RESOLVED_MOVE_RESULT_SCHEMA_VERSION,
    ...publicResolution,
    trace: summarizeMoveResolutionTrace(auditTrace),
  }
  const parsed = parseLivePlayResolvedMoveResult(candidate)
  if (!parsed.valid) {
    throw new Error(`Planner produced an invalid resolved move result: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`)
  }
  return parsed.move
}

const nullableMapState = <T>(value: T | undefined): T | null => value === undefined ? null : deepCloneJson(value)

const patchChangesFromPlan = (plan: AuthoritativeMoveStatePlan): LivePlayMoveStatePatchChanges => {
  const changes: LivePlayMoveStatePatchChanges = {}
  if (plan.mapChanges.placements) {
    Object.assign(changes, { placements: deepCloneJson(plan.mapChanges.placements) })
  }
  if (plan.mapChanges.temporaryHitPoints) {
    Object.assign(changes, {
      temporaryHitPoints: {
        previous: nullableMapState(plan.mapChanges.temporaryHitPoints.previous),
        current: nullableMapState(plan.mapChanges.temporaryHitPoints.current),
      },
    })
  }
  if (plan.mapChanges.moveUsage) {
    Object.assign(changes, {
      moveUsage: {
        previous: nullableMapState(plan.mapChanges.moveUsage.previous),
        current: nullableMapState(plan.mapChanges.moveUsage.current),
      },
    })
  }
  if (plan.mapChanges.hazards) {
    Object.assign(changes, { hazards: deepCloneJson(plan.mapChanges.hazards) })
  }
  if (plan.mapChanges.fieldEffects) {
    Object.assign(changes, { fieldEffects: deepCloneJson(plan.mapChanges.fieldEffects) })
  }
  if (plan.mapChanges.metadata) {
    Object.assign(changes, {
      metadata: {
        previous: nullableMapState(plan.mapChanges.metadata.previous),
        current: nullableMapState(plan.mapChanges.metadata.current),
      },
    })
  }
  return changes
}

const sheetRefsFromPlan = (plan: AuthoritativeMoveStatePlan): readonly LivePlayMoveSheetChangeRef[] => plan.sheetWrites.map((write) => ({
  kind: write.kind,
  slug: write.slug,
  expectedRevision: write.expectedRevision,
  revision: write.revision,
  placementIds: [...write.placementIds],
  changedFields: [...write.changedFields],
}))

const moveStatePayload = (
  operationId: string,
  plan: AuthoritativeMoveStatePlan,
  move: LivePlayResolvedMoveResult,
): LivePlayMoveStatePatchPayload => ({
  command: 'resolveMove',
  updatedAt: plan.nextMap.updatedAt ?? 0,
  move: deepCloneJson(move),
  presentation: createLivePlayMovePresentationSummary({ operationId, move }),
  sheets: sheetRefsFromPlan(plan),
  changes: patchChangesFromPlan(plan),
})

const moveStatePatch = (
  command: ResolveMoveLivePlayCommand,
  plan: AuthoritativeMoveStatePlan,
  move: LivePlayResolvedMoveResult,
  scopes: readonly LivePlayPatch['scopes'][number][],
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MOVE_STATE, LivePlayMoveStatePatchPayload> => {
  const payload = moveStatePayload(command.opId, plan, move)
  const parsedPayload = parseLivePlayMoveStatePatchPayload(payload)
  if (!parsedPayload.valid) {
    throw new Error(`MOVE_STATE payload failed invariant validation: ${parsedPayload.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`)
  }
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    type: LIVE_PLAY_PATCH_TYPES.MOVE_STATE,
    mapSlug: command.mapSlug,
    revision: plan.revision,
    scopes: deepCloneJson(scopes),
    payload: parsedPayload.payload,
  }
}

const applyResolveMoveCommand = (
  command: ResolveMoveLivePlayCommand,
  context: ResolvedResolveMoveCommandContext,
  dependencies: DependencySet,
): {
  readonly context: ResolvedResolveMoveCommandContext
  readonly patches: readonly LivePlayPatch[]
} => {
  const plan = planMoveState(context, dependencies)
  const move = moveResultFromPlan(plan)
  const scopes = validateResolveMoveScopes({ command, intent: context.intent, map: context.map, plan })
  const patch = moveStatePatch(command, plan, move, scopes)
  return {
    context: {
      ...context,
      map: plan.nextMap,
      plan,
      move,
    },
    patches: [patch],
  }
}

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const acceptedResult = (result: LivePlayCommandResult): LivePlayCommandAccepted | null => {
  if (!result.ok) return null
  if ('duplicate' in result) return result.original.ok ? result.original : null
  return result
}

const moveStatePatchFromAccepted = (result: LivePlayCommandAccepted): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MOVE_STATE, LivePlayMoveStatePatchPayload> => {
  const patches = result.patches.filter((patch) => patch.type === LIVE_PLAY_PATCH_TYPES.MOVE_STATE)
  if (patches.length !== 1) {
    throw new LivePlayResolveMoveCommandUseCaseError(409, `Stored resolveMove result must contain exactly one MOVE_STATE patch; found ${patches.length}`)
  }
  const patch = patches[0]
  if (!patch) throw new LivePlayResolveMoveCommandUseCaseError(409, 'Stored resolveMove result is missing its MOVE_STATE patch')
  const parsed = parseLivePlayMoveStatePatchPayload(patch.payload)
  if (!parsed.valid) {
    throw new LivePlayResolveMoveCommandUseCaseError(
      409,
      `Stored resolveMove MOVE_STATE payload is invalid: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    )
  }
  if (parsed.payload.presentation.operationId !== result.opId) {
    throw new LivePlayResolveMoveCommandUseCaseError(
      409,
      'Stored resolveMove presentation operation ID does not match the accepted operation result',
    )
  }
  return { ...patch, payload: parsed.payload } as LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MOVE_STATE, LivePlayMoveStatePatchPayload>
}

const sheetPayloadForPersistence = (
  sheet: Record<string, unknown>,
  slug: string,
  updatedAt: number,
): Record<string, unknown> => ({
  ...toPersistableSheetPayload(sheet),
  slug,
  updatedAt,
})

const sheetUpdateFromPersisted = (
  sheet: PersistedSheet,
  dependencies: DependencySet,
): LivePlayResolveMoveCommandSheetUpdate => {
  const path = logicalSheetResourcePath(sheet.kind, sheet.sheet)
  return {
    kind: sheet.kind,
    slug: sheet.slug,
    path: dependencies.relativePath(path),
    sheet: sheet.sheet,
  }
}

const assertConsultedSheetRevisions = (
  plan: AuthoritativeMoveStatePlan,
  dependencies: DependencySet,
  currentRevision: number,
): void => {
  try {
    dependencies.sheetRepository.assertRevisions(plan.sheetReads)
  } catch (error) {
    if (error instanceof SheetRevisionConflictError) {
      rejectLivePlayCommand(
        'conflict',
        'A sheet consulted while resolving the move changed before commit. Refresh and retry.',
        { currentRevision },
      )
    }
    throw error
  }
}

const assertCommittedMapMatchesPlan = (map: TabletopMap, plan: AuthoritativeMoveStatePlan): void => {
  if (normalizeRevision(map.revision) !== plan.revision) {
    throw new LivePlayResolveMoveCommandUseCaseError(409, `Committed map revision ${normalizeRevision(map.revision)} did not match planned revision ${plan.revision}`)
  }
  if (map.updatedAt !== plan.nextMap.updatedAt) {
    throw new LivePlayResolveMoveCommandUseCaseError(409, 'Committed map timestamp did not match the planned move timestamp')
  }
}

const assertCommittedSheetMatchesPlan = (sheet: PersistedSheet, expectedRevision: number): void => {
  if (normalizeRevision(sheet.revision) !== expectedRevision) {
    throw new LivePlayResolveMoveCommandUseCaseError(409, `Committed ${sheet.kind} sheet ${sheet.slug} revision ${sheet.revision} did not match planned revision ${expectedRevision}`)
  }
}

const responseFromContext = (
  result: LivePlayCommandResult,
  context: ResolvedResolveMoveCommandContext | null,
  role: AuthRole,
  move: LivePlayResolvedMoveResult | undefined = context?.move,
): LivePlayResolveMoveCommandResponse => ({
  result,
  ...(context ? {
    path: context.relativePath,
    map: context.map,
    ...(context.sheetUpdates?.length ? {
      sheetUpdates: role === 'player'
        ? (redactSheetUpdatesForPlayer([...context.sheetUpdates]) ?? [])
        : [...context.sheetUpdates],
    } : {}),
  } : {}),
  ...(move === undefined ? {} : { move }),
})

const currentContextForAcceptedResult = (
  result: LivePlayCommandAccepted,
  role: AuthRole,
  dependencies: DependencySet,
): ResolvedResolveMoveCommandContext => {
  const patch = moveStatePatchFromAccepted(result)
  const payload = patch.payload
  const map = dependencies.mapRepository.getBySlug(result.mapSlug)
  if (!map) throw new LivePlayResolveMoveCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after resolveMove command`)
  if (!canAccessMapForRole(role, map)) throw new LivePlayResolveMoveCommandUseCaseError(403, 'Map is not player visible')

  const sheetUpdates: LivePlayResolveMoveCommandSheetUpdate[] = []
  for (const ref of payload.sheets) {
    const sheet = dependencies.sheetRepository.getByRef(ref.kind, ref.slug)
    if (!sheet) throw new LivePlayResolveMoveCommandUseCaseError(404, `Changed sheet ${ref.kind}/${ref.slug} not found after resolveMove command`)
    sheetUpdates.push(sheetUpdateFromPersisted(sheet, dependencies))
  }

  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
    intent: {
      schemaVersion: 1,
      placementId: payload.move.actorPlacementId,
      moveName: payload.move.moveName,
      ...(payload.move.targetBranchId ? { targetBranchId: payload.move.targetBranchId } : {}),
      selection: { kind: 'self' },
    },
    pokemonSheets: new Map(),
    trainerSheets: new Map(),
    linkedTrainerSheets: [],
    sheetUpdates,
    move: payload.move,
  }
}

export const executeLivePlayResolveMoveCommandUseCase = async (
  input: ExecuteLivePlayResolveMoveCommandInput,
  dependencies: LivePlayResolveMoveCommandDependencies = {},
): Promise<LivePlayResolveMoveCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedResolveMoveCommandContext | null = null

  const result = await deps.commandExecutor.execute<ResolveMoveLivePlayCommand, ResolvedResolveMoveCommandContext, LivePlayResolveMoveCommandActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
      playerProfile: input.playerProfile,
    },
    readMap: ({ command, actor }) => readAuthoritativeContext(command, actor, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    authorize: ({ command, actor, map, currentRevision }) => {
      assertResolveMoveCommandType(command, input.expectedType)
      assertExactBaseRevision(command, currentRevision)
      let controllablePlacement = actorPlacement(map)
      if (!controllablePlacement) {
        rejectLivePlayCommand('not-found', `Actor placement ${map.intent.placementId} was not found`)
        throw new Error('unreachable')
      }
      if (!actorCanControlMapPlacement({
        role: actor.role,
        profile: actor.playerProfile,
        placement: controllablePlacement,
        linkedTrainerSheets: map.linkedTrainerSheets,
      })) {
        throw new LivePlayResolveMoveCommandUseCaseError(403, controlDeniedMessage(actor.role, actor.playerProfile))
      }
    },
    apply: ({ command, map }) => {
      const application = applyResolveMoveCommand(command, map, deps)
      return {
        status: 'accepted',
        nextMap: application.context,
        previousRevision: application.context.plan?.previousRevision ?? normalizeRevision(map.map.revision),
        revision: application.context.plan?.revision ?? normalizeRevision(map.map.revision),
        patches: application.patches,
      }
    },
    persist: () => {
      throw new Error('resolveMove live-play commands must persist through the accepted-result commit hook')
    },
    commit: ({ actor, command, currentRevision, nextMap, result, recordRealtimeEvents, saveOpResult }) => {
      deps.database.withTransaction(() => {
        const plan = nextMap.plan
        if (!plan || !nextMap.move) {
          throw new LivePlayResolveMoveCommandUseCaseError(409, 'resolveMove accepted without a complete move plan')
        }
        if (plan.previousRevision !== currentRevision) {
          throw new LivePlayResolveMoveCommandUseCaseError(409, 'resolveMove plan revision did not match the command revision context')
        }

        assertConsultedSheetRevisions(plan, deps, currentRevision)

        const persisted = toPersistedMap(
          plan.nextMap,
          plan.nextMap.folder ?? '',
          plan.nextMap.updatedAt ?? deps.now(),
          { revision: plan.revision },
        )
        const mapResult = deps.mapRepository.applyLivePlayUpdate({
          slug: result.mapSlug,
          expectedRevision: plan.previousRevision,
          nextMap: persisted,
        })
        if (mapResult === 'stale') {
          throw new LivePlayResolveMoveCommandUseCaseError(409, `Map ${result.mapSlug} changed before the resolveMove command could be persisted`)
        }

        for (const write of plan.sheetWrites) {
          const nextSheet = sheetPayloadForPersistence(
            write.nextSheet as unknown as Record<string, unknown>,
            write.slug,
            plan.nextMap.updatedAt ?? deps.now(),
          )
          const sheetResult = deps.sheetRepository.applyLivePlayUpdate({
            kind: write.kind,
            slug: write.slug,
            expectedRevision: write.expectedRevision,
            nextSheet,
          })
          if (sheetResult === 'stale') {
            throw new LivePlayResolveMoveCommandUseCaseError(409, `${write.kind} sheet ${write.slug} changed before the resolveMove command could be persisted`)
          }
        }

        const updates: LivePlayResolveMoveCommandSheetUpdate[] = []
        for (const write of plan.sheetWrites) {
          const authoritativeSheet = deps.sheetRepository.getByRef(write.kind, write.slug)
          if (!authoritativeSheet) throw new LivePlayResolveMoveCommandUseCaseError(404, `${write.kind} sheet ${write.slug} not found after resolveMove command`)
          assertCommittedSheetMatchesPlan(authoritativeSheet, write.revision)
          updates.push(sheetUpdateFromPersisted(authoritativeSheet, deps))
        }
        recordRealtimeEvents(livePlaySheetUpdateRealtimeAppendInputs({
          command,
          updates,
          clientId: actor.clientId,
        }))
        saveOpResult()

        const authoritativeMap = deps.mapRepository.getBySlug(result.mapSlug)
        if (!authoritativeMap) throw new LivePlayResolveMoveCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after resolveMove command`)
        assertCommittedMapMatchesPlan(authoritativeMap, plan)

        persistedContext = {
          ...nextMap,
          map: authoritativeMap,
          sheetUpdates: updates,
        }
      })
    },
  })

  const committedContext = persistedContext as ResolvedResolveMoveCommandContext | null
  const accepted = acceptedResult(result)
  const responseContext = committedContext
    ?? (accepted ? currentContextForAcceptedResult(accepted, input.role, deps) : null)
  const move = committedContext?.move ?? responseContext?.move
  return responseFromContext(result, responseContext, input.role, move)
}
