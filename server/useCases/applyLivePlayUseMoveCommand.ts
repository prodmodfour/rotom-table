import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayPatch,
  type LivePlayScope,
  type LivePlaySheetScope,
  type LivePlayTokenScope,
  type UseMoveLivePlayCommand,
  type UseMovePayload,
} from '#shared/livePlayCommands'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { SheetMoveUsageState } from '~/types/moveUsage'
import { parseMoveFrequency, type ParsedMoveFrequency } from '~/utils/moveUsage'
import { appendMoveLogEntry, buildMoveUseLogLines, type MoveLogEntry } from '~/utils/moveLog'
import { toPersistableSheetPayload } from '~/utils/sheets/persistence'
import { resolveSheetMoveForUsage, type ResolvedSheetMove } from '~/utils/moveUsageResolution'
import {
  isMoveUsageTransitionError,
  planMoveUsageTransition,
  type UseMoveUsageSummary,
} from '../domain/planMoveUsageTransition'
import {
  actorCanControlMapPlacement,
  playerProfileLinkedTrainerSheetsForTokenControlAsync,
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
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import {
  sqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { redactSheetUpdatesForPlayer } from '../utils/sheetPrivacy'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { toPersistedMap } from './saveMap'

export class LivePlayUseMoveCommandUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export type { UseMoveTracking, UseMoveUsageSummary } from '../domain/planMoveUsageTransition'

export interface LivePlayUseMoveCommandActor {
  readonly role: AuthRole
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
}

export interface ExecuteLivePlayUseMoveCommandInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
  readonly playerProfile?: PlayerProfile | null
  readonly expectedType?: typeof LIVE_PLAY_COMMAND_TYPES.USE_MOVE
}

export interface LivePlayUseMoveCommandSheetUpdate {
  readonly kind: PersistedSheet['kind']
  readonly slug: string
  readonly sheet: Record<string, unknown>
}

export interface LivePlayUseMoveCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
  readonly placement?: SheetPlacement
  readonly usage?: UseMoveUsageSummary
  readonly sheetUpdates?: LivePlayUseMoveCommandSheetUpdate[]
}

export interface LivePlayUseMoveCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly mapRepository?: Pick<MapRepository, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'applyLivePlayUpdate'>
  readonly database?: Pick<RotomDatabase, 'withTransaction'>
  readonly now?: () => number
  readonly relativePath?: (path: string) => string
  readonly maxMoveLogEntries?: number
}

interface ResolvedUseMoveContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: PersistedSheet
  readonly linkedTrainerSheets: readonly ServerTokenControlLinkedTrainerSheet[]
}

interface AcceptedUseMoveContext extends ResolvedUseMoveContext {
  readonly move: ResolvedSheetMove
  readonly frequency: ParsedMoveFrequency
  readonly previousUsage: UseMoveUsageSummary
  readonly usage: UseMoveUsageSummary
  readonly moveLogEntry?: MoveLogEntry
  readonly nextSheet?: Record<string, unknown>
  readonly sheetUpdate?: LivePlayUseMoveCommandSheetUpdate
}

interface AppliedUseMoveChange {
  readonly nextContext: AcceptedUseMoveContext
  readonly patches: readonly LivePlayPatch[]
}

type UnknownRecord = Record<string, unknown>

type LivePlayUseMoveDependencySet = ReturnType<typeof actionDependencies>

const livePlayUseMoveCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const useMoveCommandTypes = new Set<string>([LIVE_PLAY_COMMAND_TYPES.USE_MOVE])

const actionDependencies = (dependencies: LivePlayUseMoveCommandDependencies) => ({
  commandExecutor: dependencies.commandExecutor ?? livePlayUseMoveCommandExecutor,
  mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
  sheetRepository: dependencies.sheetRepository ?? sqliteSheetRepository,
  database: dependencies.database ?? getRotomDatabase(),
  now: dependencies.now ?? Date.now,
  relativePath: dependencies.relativePath ?? ((path: string) => path),
  maxMoveLogEntries: dependencies.maxMoveLogEntries,
})

const tokenControlTrainerSheet = (sheet: PersistedSheet): ServerTokenControlLinkedTrainerSheet => ({
  slug: sheet.slug,
  ...(Array.isArray(sheet.sheet.currentTeam) ? { currentTeam: sheet.sheet.currentTeam } : {}),
  ...(Array.isArray(sheet.sheet.boxedPokemon) ? { boxedPokemon: sheet.sheet.boxedPokemon } : {}),
})

const linkedTrainerSheetsForActor = async (
  actor: LivePlayUseMoveCommandActor,
  dependencies: LivePlayUseMoveDependencySet,
) => playerProfileLinkedTrainerSheetsForTokenControlAsync(
  actor.playerProfile,
  async (slug) => {
    const sheet = await dependencies.sheetRepository.getByRef('trainer', slug)
    return sheet ? tokenControlTrainerSheet(sheet) : null
  },
)

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const nonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const optionalText = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => logicalMapResourcePath(map)

const controlDeniedMessage = (role: AuthRole, profile: PlayerProfile | null | undefined): string => (
  role === 'player' && !profile
    ? 'Select a player profile to control linked map tokens'
    : 'Token is not linked to selected player profile'
)

const expectUseMovePayload = (payload: unknown): UseMovePayload => {
  if (!isRecord(payload)) rejectLivePlayCommand('invalid', 'useMove payload must be an object')
  const record = payload as UnknownRecord
  if (!nonEmptyString(record.placementId)) {
    rejectLivePlayCommand('invalid', 'useMove payload.placementId is required')
  }
  if (!nonEmptyString(record.moveName)) {
    rejectLivePlayCommand('invalid', 'useMove payload.moveName is required')
  }

  const placementId = (record.placementId as string).trim()
  const moveName = (record.moveName as string).trim()
  if (placementId.length > 120) rejectLivePlayCommand('invalid', 'useMove payload.placementId must be at most 120 characters')
  if (moveName.length > 120) rejectLivePlayCommand('invalid', 'useMove payload.moveName must be at most 120 characters')

  return { placementId, moveName }
}

const tokenScopeMatches = (
  scopes: readonly LivePlayScope[],
  placementId: string,
  field: Extract<LivePlayTokenScope['field'], 'moveUsage' | 'action'>,
): boolean => scopes.some((scope) => (
  scope.kind === 'token' && scope.placementId === placementId && scope.field === field
))

const useMoveTokenScopeMatches = (
  scopes: readonly LivePlayScope[],
  placementId: string,
): boolean => tokenScopeMatches(scopes, placementId, 'moveUsage') || tokenScopeMatches(scopes, placementId, 'action')

const sheetMoveUsageScopeMatches = (
  scopes: readonly LivePlayScope[],
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): boolean => scopes.some((scope) => (
  scope.kind === 'sheet'
  && scope.sheetKind === placement.sheetKind
  && scope.sheetSlug === placement.sheetSlug
  && scope.field === 'moveUsage'
))

const mismatchedSheetScope = (
  scopes: readonly LivePlayScope[],
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): LivePlaySheetScope | null => (
  scopes.find((scope): scope is LivePlaySheetScope => (
    scope.kind === 'sheet'
    && (scope.sheetKind !== placement.sheetKind || scope.sheetSlug !== placement.sheetSlug)
  )) ?? null
)

const sheetScopesForPatch = (
  command: UseMoveLivePlayCommand,
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): readonly LivePlaySheetScope[] => {
  const scopes = command.scopes.filter((scope): scope is LivePlaySheetScope => (
    scope.kind === 'sheet'
    && scope.sheetKind === placement.sheetKind
    && scope.sheetSlug === placement.sheetSlug
    && scope.field === 'moveUsage'
  ))
  return scopes.length > 0
    ? scopes
    : [{ kind: 'sheet', sheetKind: placement.sheetKind, sheetSlug: placement.sheetSlug, field: 'moveUsage' }]
}

const scopesForPatch = (
  command: UseMoveLivePlayCommand,
  placementId: string,
  field: Extract<LivePlayTokenScope['field'], 'moveUsage' | 'action'>,
): readonly LivePlayTokenScope[] => {
  const scopes = command.scopes.filter((scope): scope is LivePlayTokenScope => (
    scope.kind === 'token' && scope.placementId === placementId && scope.field === field
  ))
  return scopes.length > 0 ? scopes : [{ kind: 'token', placementId, field }]
}

const assertUseMoveCommandType = (
  command: UseMoveLivePlayCommand,
  expectedType?: typeof LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
): void => {
  if (expectedType && command.type !== expectedType) {
    rejectLivePlayCommand('invalid', `This route only accepts ${expectedType} commands`)
  }
  if (!useMoveCommandTypes.has(command.type)) {
    rejectLivePlayCommand('invalid', 'This route only accepts useMove commands')
  }
}

const validateCommandPayloadAndScopes = (command: UseMoveLivePlayCommand): UseMovePayload => {
  const payload = expectUseMovePayload(command.payload)
  if (!useMoveTokenScopeMatches(command.scopes, payload.placementId)) {
    rejectLivePlayCommand('invalid', 'useMove scopes must include the token moveUsage or action scope for payload.placementId')
  }
  return payload
}

const validateUseMoveSheetScopeIdentity = (
  command: UseMoveLivePlayCommand,
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): void => {
  const badSheetScope = mismatchedSheetScope(command.scopes, placement)
  if (!badSheetScope) return
  rejectLivePlayCommand(
    'invalid',
    `useMove sheet scope ${badSheetScope.sheetKind}/${badSheetScope.sheetSlug} does not match placement ${placement.sheetKind}/${placement.sheetSlug}`,
  )
}

const validateDailyUseMoveSheetScope = (
  command: UseMoveLivePlayCommand,
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): void => {
  if (sheetMoveUsageScopeMatches(command.scopes, placement)) return
  rejectLivePlayCommand('invalid', 'Daily useMove scopes must include the backing sheet moveUsage scope')
}

const resolveContext = async (
  command: UseMoveLivePlayCommand,
  actor: LivePlayUseMoveCommandActor,
  dependencies: LivePlayUseMoveDependencySet,
): Promise<ResolvedUseMoveContext> => {
  const payload = expectUseMovePayload(command.payload)
  const map = await dependencies.mapRepository.getBySlug(command.mapSlug)
  if (!map) throw new LivePlayUseMoveCommandUseCaseError(404, `Map ${command.mapSlug}.json not found`)

  if (!canAccessMapForRole(actor.role, map)) {
    throw new LivePlayUseMoveCommandUseCaseError(403, 'Map is not player visible')
  }

  const placement = map.placements.find((candidate) => candidate.id === payload.placementId)
  if (!placement) throw new LivePlayUseMoveCommandUseCaseError(404, `Placement ${payload.placementId} not found`)

  const sheet = await dependencies.sheetRepository.getByRef(placement.sheetKind, placement.sheetSlug)
  if (!sheet) {
    throw new LivePlayUseMoveCommandUseCaseError(404, `Sheet ${placement.sheetKind}/${placement.sheetSlug} not found`)
  }

  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
    placement,
    sheet,
    linkedTrainerSheets: await linkedTrainerSheetsForActor(actor, dependencies),
  }
}

const sheetDisplayName = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  sheet: Record<string, unknown>,
): string => {
  if (placement.sheetKind === 'pokemon') {
    return optionalText(sheet.nickname)
      ?? optionalText(sheet.species)
      ?? placement.sheetSlug
  }

  return optionalText(sheet.name) ?? placement.sheetSlug
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

const sheetUpdateFromPersisted = (sheet: PersistedSheet): LivePlayUseMoveCommandSheetUpdate => ({
  kind: sheet.kind,
  slug: sheet.slug,
  sheet: sheet.sheet,
})

const usagePatchPayload = (
  context: AcceptedUseMoveContext,
): Record<string, unknown> => ({
  placementId: context.placement.id,
  sheetKind: context.placement.sheetKind,
  sheetSlug: context.placement.sheetSlug,
  moveName: context.usage.moveName,
  moveKey: context.usage.moveKey,
  frequency: context.usage.frequency,
  frequencyKind: context.usage.frequencyKind,
  tracking: context.usage.tracking,
  previousUsage: context.previousUsage,
  usage: context.usage,
  ...(context.sheetUpdate === undefined ? {} : { sheetRevision: normalizeRevision(context.sheetUpdate.sheet.revision) }),
  ...(context.moveLogEntry === undefined ? {} : { moveLogEntry: context.moveLogEntry }),
})

const useMovePatch = (
  command: UseMoveLivePlayCommand,
  context: AcceptedUseMoveContext,
): LivePlayPatch => {
  const field = context.usage.tracking === 'none' ? 'action' : 'moveUsage'
  return {
    schemaVersion: command.schemaVersion,
    type: context.usage.tracking === 'none'
      ? LIVE_PLAY_PATCH_TYPES.TOKEN_ACTION
      : LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE,
    mapSlug: command.mapSlug,
    revision: normalizeRevision(context.map.revision),
    scopes: scopesForPatch(command, context.placement.id, field),
    payload: usagePatchPayload(context),
  }
}

const sheetMoveUsagePatch = (
  command: UseMoveLivePlayCommand,
  context: AcceptedUseMoveContext,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.SHEET_FIELD> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.SHEET_FIELD,
  mapSlug: command.mapSlug,
  revision: normalizeRevision(context.map.revision),
  scopes: sheetScopesForPatch(command, context.placement),
  payload: {
    field: 'moveUsage',
    ...usagePatchPayload(context),
  },
})

const moveLogEntryFromMetadata = (
  metadata: Record<string, unknown> | undefined,
): MoveLogEntry | undefined => {
  const entries = metadata?.moveLog
  if (!Array.isArray(entries)) return undefined
  const entry = entries.at(-1)
  return isRecord(entry) ? entry as unknown as MoveLogEntry : undefined
}

const appendMoveUseLog = (
  context: ResolvedUseMoveContext,
  move: ResolvedSheetMove,
  frequency: ParsedMoveFrequency,
  usedAt: number,
  dependencies: Pick<LivePlayUseMoveDependencySet, 'maxMoveLogEntries'>,
): { readonly metadata: Record<string, unknown>; readonly moveLogEntry?: MoveLogEntry } => {
  const userName = sheetDisplayName(context.placement, context.sheet.sheet)
  const metadata = appendMoveLogEntry(
    context.map.metadata,
    {
      userId: context.placement.id,
      userName,
      moveName: move.moveName,
      lines: buildMoveUseLogLines(userName, move.moveName, frequency.raw),
    },
    {
      now: () => usedAt,
      maxLogEntries: dependencies.maxMoveLogEntries,
    },
  )
  const moveLogEntry = moveLogEntryFromMetadata(metadata)

  return {
    metadata,
    ...(moveLogEntry === undefined ? {} : { moveLogEntry }),
  }
}

const acceptedContext = (
  base: ResolvedUseMoveContext,
  input: {
    readonly map: TabletopMap
    readonly move: ResolvedSheetMove
    readonly frequency: ParsedMoveFrequency
    readonly previousUsage: UseMoveUsageSummary
    readonly usage: UseMoveUsageSummary
    readonly moveLogEntry?: MoveLogEntry
    readonly nextSheet?: Record<string, unknown>
    readonly sheetUpdate?: LivePlayUseMoveCommandSheetUpdate
  },
): AcceptedUseMoveContext => ({
  ...base,
  map: input.map,
  move: input.move,
  frequency: input.frequency,
  previousUsage: input.previousUsage,
  usage: input.usage,
  ...(input.moveLogEntry === undefined ? {} : { moveLogEntry: input.moveLogEntry }),
  ...(input.nextSheet === undefined ? {} : { nextSheet: input.nextSheet }),
  ...(input.sheetUpdate === undefined ? {} : { sheetUpdate: input.sheetUpdate }),
})

const applyUseMove = (
  command: UseMoveLivePlayCommand,
  context: ResolvedUseMoveContext,
  currentRevision: number,
  dependencies: LivePlayUseMoveDependencySet,
): AppliedUseMoveChange | { readonly status: 'rejected'; readonly reason: 'invalid' | 'conflict'; readonly message: string; readonly currentState?: unknown } => {
  const payload = validateCommandPayloadAndScopes(command)
  const move = resolveSheetMoveForUsage(context.sheet.sheet, payload.moveName)
  if (!move) {
    throw new LivePlayUseMoveCommandUseCaseError(404, `Move ${payload.moveName} not found on ${context.placement.sheetSlug}`)
  }

  if (parseMoveFrequency(move.frequency).kind === 'daily') {
    validateDailyUseMoveSheetScope(command, context.placement)
  }

  const updatedAt = dependencies.now()
  const transition = (() => {
    try {
      return planMoveUsageTransition({
        map: context.map,
        sheetMoveUsage: context.sheet.sheet.moveUsage as SheetMoveUsageState | undefined,
        placementId: context.placement.id,
        move,
        usedAt: updatedAt,
      })
    } catch (error) {
      if (isMoveUsageTransitionError(error)) {
        return {
          status: 'rejected' as const,
          reason: error.reason,
          message: error.message,
          currentState: error.currentUsage,
        }
      }
      throw error
    }
  })()
  if ('status' in transition) return transition

  const revision = nextRevision(currentRevision)
  const log = appendMoveUseLog(context, move, transition.frequency, updatedAt, dependencies)
  const nextMap: TabletopMap = {
    ...context.map,
    ...(transition.nextMapMoveUsage === undefined ? {} : { moveUsage: transition.nextMapMoveUsage }),
    metadata: log.metadata,
    revision,
    updatedAt,
  }
  const nextSheet = transition.nextSheetMoveUsage === undefined
    ? undefined
    : sheetPayloadForPersistence(
        { ...context.sheet.sheet, moveUsage: transition.nextSheetMoveUsage },
        context.sheet.slug,
        updatedAt,
      )
  const sheetRevision = nextSheet === undefined ? undefined : nextRevision(context.sheet.revision)
  const nextContext = acceptedContext(context, {
    map: nextMap,
    move,
    frequency: transition.frequency,
    previousUsage: transition.previousUsage,
    usage: transition.usage,
    ...(log.moveLogEntry === undefined ? {} : { moveLogEntry: log.moveLogEntry }),
    ...(nextSheet === undefined ? {} : { nextSheet }),
    ...(nextSheet === undefined || sheetRevision === undefined
      ? {}
      : {
          sheetUpdate: {
            kind: context.sheet.kind,
            slug: context.sheet.slug,
            sheet: { ...nextSheet, revision: sheetRevision },
          },
        }),
  })

  return {
    nextContext,
    patches: nextSheet === undefined
      ? [useMovePatch(command, nextContext)]
      : [useMovePatch(command, nextContext), sheetMoveUsagePatch(command, nextContext)],
  }
}

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const placementIdFromAcceptedResult = (result: LivePlayCommandAccepted): string | null => (
  result.patches[0]?.scopes.find((scope): scope is LivePlayTokenScope => scope.kind === 'token')?.placementId ?? null
)

const acceptedResultTouchesSheet = (result: LivePlayCommandAccepted): boolean => result.patches.some((patch) => (
  patch.type === LIVE_PLAY_PATCH_TYPES.SHEET_FIELD || patch.scopes.some((scope) => scope.kind === 'sheet')
))

const sheetUpdatesForResponse = (
  result: LivePlayCommandResult,
  context: AcceptedUseMoveContext | ResolvedUseMoveContext | null,
): LivePlayUseMoveCommandSheetUpdate[] | undefined => {
  if (!context || !isAcceptedResult(result) || !acceptedResultTouchesSheet(result)) return undefined
  if ('sheetUpdate' in context && context.sheetUpdate) return [context.sheetUpdate]
  return [sheetUpdateFromPersisted(context.sheet)]
}

const responseFromContext = (
  result: LivePlayCommandResult,
  context: AcceptedUseMoveContext | ResolvedUseMoveContext | null,
  role: AuthRole,
): LivePlayUseMoveCommandResponse => {
  const sheetUpdates = sheetUpdatesForResponse(result, context)
  return {
    result,
    ...(context ? {
      path: context.relativePath,
      map: context.map,
      placement: context.placement,
    } : {}),
    ...((context && 'usage' in context) ? { usage: context.usage } : {}),
    ...(sheetUpdates === undefined ? {} : {
      sheetUpdates: role === 'player'
        ? (redactSheetUpdatesForPlayer(sheetUpdates) ?? [])
        : sheetUpdates,
    }),
  }
}

const currentContextForAcceptedResult = async (
  result: LivePlayCommandAccepted,
  role: AuthRole,
  playerProfile: PlayerProfile | null | undefined,
  dependencies: LivePlayUseMoveDependencySet,
): Promise<ResolvedUseMoveContext | null> => {
  const placementId = placementIdFromAcceptedResult(result)
  if (!placementId) return null

  try {
    const command = {
      schemaVersion: 1,
      opId: result.opId,
      mapSlug: result.mapSlug,
      baseRevision: result.revision,
      type: LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
      scopes: [{ kind: 'token', placementId, field: 'moveUsage' }],
      payload: { placementId, moveName: 'unknown' },
    } as const satisfies UseMoveLivePlayCommand
    return await resolveContext(command, { role, playerProfile }, dependencies)
  } catch {
    return null
  }
}

export const executeLivePlayUseMoveCommandUseCase = async (
  input: ExecuteLivePlayUseMoveCommandInput,
  dependencies: LivePlayUseMoveCommandDependencies = {},
): Promise<LivePlayUseMoveCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: AcceptedUseMoveContext | null = null

  const result = await deps.commandExecutor.execute<UseMoveLivePlayCommand, ResolvedUseMoveContext, LivePlayUseMoveCommandActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
      playerProfile: input.playerProfile,
    },
    readMap: ({ command, actor }) => resolveContext(command, actor, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    authorize: ({ command, actor, map }) => {
      assertUseMoveCommandType(command, input.expectedType)
      const payload = validateCommandPayloadAndScopes(command)
      if (payload.placementId !== map.placement.id) {
        rejectLivePlayCommand('invalid', 'useMove payload.placementId must match the resolved placement')
      }
      validateUseMoveSheetScopeIdentity(command, map.placement)
      if (!actorCanControlMapPlacement({
        role: actor.role,
        profile: actor.playerProfile,
        placement: map.placement,
        linkedTrainerSheets: map.linkedTrainerSheets,
      })) {
        throw new LivePlayUseMoveCommandUseCaseError(403, controlDeniedMessage(actor.role, actor.playerProfile))
      }
    },
    apply: ({ command, map, currentRevision }) => {
      const change = applyUseMove(command, map, currentRevision, deps)
      if ('status' in change) {
        return {
          status: 'rejected',
          reason: change.reason,
          message: change.message,
          currentRevision,
          currentState: change.currentState,
        }
      }

      return {
        status: 'accepted',
        nextMap: change.nextContext,
        previousRevision: currentRevision,
        revision: normalizeRevision(change.nextContext.map.revision),
        patches: change.patches,
      }
    },
    persist: () => {
      throw new Error('live-play useMove commands must persist through the accepted-result commit hook')
    },
    commit: ({ actor, command, currentRevision, nextMap, result, recordRealtimeEvents, saveOpResult }) => {
      const acceptedNextMap = nextMap as AcceptedUseMoveContext
      deps.database.withTransaction(() => {
        const persisted = toPersistedMap(
          acceptedNextMap.map,
          acceptedNextMap.map.folder ?? '',
          acceptedNextMap.map.updatedAt ?? deps.now(),
          { revision: result.revision },
        )
        const updateResult = deps.mapRepository.applyLivePlayUpdate({
          slug: result.mapSlug,
          expectedRevision: currentRevision,
          nextMap: persisted,
        })
        if (updateResult === 'stale') {
          throw new LivePlayUseMoveCommandUseCaseError(409, `Map ${result.mapSlug} changed before the live-play useMove command could be persisted`)
        }

        if (acceptedNextMap.nextSheet) {
          const sheetResult = deps.sheetRepository.applyLivePlayUpdate({
            kind: acceptedNextMap.sheet.kind,
            slug: acceptedNextMap.sheet.slug,
            expectedRevision: acceptedNextMap.sheet.revision,
            nextSheet: acceptedNextMap.nextSheet,
          })
          if (sheetResult === 'stale') {
            throw new LivePlayUseMoveCommandUseCaseError(409, `Sheet ${acceptedNextMap.sheet.kind}/${acceptedNextMap.sheet.slug} changed before the live-play useMove command could be persisted`)
          }
        }

        const authoritativeSheet = acceptedNextMap.nextSheet
          ? deps.sheetRepository.getByRef(acceptedNextMap.sheet.kind, acceptedNextMap.sheet.slug)
          : null
        if (acceptedNextMap.nextSheet && !authoritativeSheet) {
          throw new LivePlayUseMoveCommandUseCaseError(404, `Sheet ${acceptedNextMap.sheet.kind}/${acceptedNextMap.sheet.slug} not found after live-play useMove command`)
        }
        const sheetUpdate = authoritativeSheet ? sheetUpdateFromPersisted(authoritativeSheet) : undefined
        recordRealtimeEvents(livePlaySheetUpdateRealtimeAppendInputs({
          command,
          updates: sheetUpdate ? [sheetUpdate] : [],
          clientId: actor.clientId,
        }))
        saveOpResult()

        const authoritativeMap = deps.mapRepository.getBySlug(result.mapSlug)
        if (!authoritativeMap) throw new LivePlayUseMoveCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after live-play useMove command`)
        const authoritativePlacement = authoritativeMap.placements.find((candidate) => candidate.id === acceptedNextMap.placement.id)
        if (!authoritativePlacement) throw new LivePlayUseMoveCommandUseCaseError(404, `Placement ${acceptedNextMap.placement.id} not found after live-play useMove command`)
        persistedContext = {
          ...acceptedNextMap,
          map: authoritativeMap,
          placement: authoritativePlacement,
          ...(authoritativeSheet && sheetUpdate ? {
            sheet: authoritativeSheet,
            sheetUpdate,
          } : {}),
        }
      })
    },
  })

  const responseContext = persistedContext
    ?? (isAcceptedResult(result)
      ? await currentContextForAcceptedResult(result, input.role, input.playerProfile, deps)
      : null)
  return responseFromContext(result, responseContext, input.role)
}
