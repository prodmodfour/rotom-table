import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_INITIATIVE_MAX_VALUE,
  LIVE_PLAY_INITIATIVE_MIN_VALUE,
  LIVE_PLAY_PATCH_TYPES,
  type AdvanceInitiativePayload,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type LivePlayInitiativeCommand,
  type LivePlayMapScope,
  type LivePlayPatch,
  type NextInitiativeLivePlayCommand,
  type PreviousInitiativeLivePlayCommand,
  type SetInitiativeLivePlayCommand,
  type SetInitiativePayload,
} from '#shared/livePlayCommands'
import type { AuthRole } from '#shared/auth'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { InitiativeTrackerState, SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import {
  appendInitiativeLogRecord,
  createInitiativeLogEntry,
  type InitiativeLogEntry,
} from '~/utils/initiativeLog'
import {
  rejectLivePlayCommand,
  type AuthoritativeLivePlayCommandExecutor,
} from '../livePlay/commandExecutor'
import { createSqliteAuthoritativeLivePlayCommandExecutor } from '../livePlay/sqliteCommandExecutor'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'
import {
  sqliteSheetRepository,
  type SheetRepository,
} from '../storage/sheetRepository'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { livePlayCommandAcceptedRealtimeEvent } from '../utils/mapRealtimeEvents'
import { publishRealtime } from '../utils/realtime'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { initiativeOrderIdsForPlacements, type InitiativeSheetReader } from '~/utils/initiativeOrderEntries'
import type { RealtimeEvent } from '#shared/realtime'
import { commitLivePlayMapUpdate } from './livePlayMapPersistence'
import { toPersistedMap } from './saveMap'

export class LivePlayInitiativeCommandUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export type LivePlayInitiativeCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE
  | typeof LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE
  | typeof LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE

export interface InitiativeEntryState {
  readonly tokenId: string
  readonly initiative: number | null
}

export interface InitiativeLaneState {
  readonly activeId: string | null
  readonly round: number
  readonly entries: readonly InitiativeEntryState[]
}

export interface InitiativePatchPayload {
  readonly command: LivePlayInitiativeCommandType
  readonly previous: InitiativeLaneState
  readonly current: InitiativeLaneState
  readonly changedTokenIds: readonly string[]
  readonly logEntry?: InitiativeLogEntry
}

export interface LivePlayInitiativeCommandActor {
  readonly role: AuthRole
  readonly clientId?: string
}

export interface ExecuteLivePlayInitiativeCommandInput {
  readonly role: AuthRole
  readonly command: unknown
  readonly clientId?: string
  readonly expectedType?: LivePlayInitiativeCommandType
}

export interface LivePlayInitiativeCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
  readonly initiative?: InitiativeLaneState
}

export interface LivePlayInitiativeCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly mapRepository?: Pick<MapRepository, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly database?: Pick<RotomDatabase, 'withTransaction'>
  readonly sheetRepository?: InitiativeSheetRepository
  readonly publishRealtimeEvent?: (event: Omit<RealtimeEvent, 'timestamp'>) => void
  readonly readSheet?: InitiativeSheetReader
  readonly now?: () => number
  readonly relativePath?: (path: string) => string
  readonly maxInitiativeLogEntries?: number
}

interface ResolvedInitiativeContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
}

interface AppliedInitiativeChange {
  readonly nextMap: TabletopMap
  readonly previous: InitiativeLaneState
  readonly current: InitiativeLaneState
  readonly logEntry?: InitiativeLogEntry
}

type UnknownRecord = Record<string, unknown>
type InitiativeSheetRepository = Pick<SheetRepository<Record<string, unknown>>, 'get'>
type LivePlayInitiativeDependencySet = ReturnType<typeof actionDependencies>

const livePlayInitiativeCommandExecutor = createSqliteAuthoritativeLivePlayCommandExecutor()

const initiativeCommandTypes = new Set<string>([
  LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
  LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
  LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
])

const initiativeSheetReaderFromRepository = (
  repository: InitiativeSheetRepository,
): InitiativeSheetReader => (kind: SheetKind, slug: string) => {
  const result = repository.get(kind, slug)
  if (result === null) return null
  return { sheet: result.document as Record<string, unknown> }
}

const actionDependencies = (dependencies: LivePlayInitiativeCommandDependencies) => {
  const sheetRepository = dependencies.sheetRepository ?? (sqliteSheetRepository as InitiativeSheetRepository)
  return {
    commandExecutor: dependencies.commandExecutor ?? livePlayInitiativeCommandExecutor,
    mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
    database: dependencies.database ?? getRotomDatabase(),
    sheetRepository,
    publishRealtimeEvent: dependencies.publishRealtimeEvent ?? publishRealtime,
    readSheet: dependencies.readSheet ?? initiativeSheetReaderFromRepository(sheetRepository),
    now: dependencies.now ?? Date.now,
    relativePath: dependencies.relativePath ?? ((path: string) => path),
    maxInitiativeLogEntries: dependencies.maxInitiativeLogEntries,
  }
}

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const nonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const safeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value)
)

const normalizeRound = (value: unknown): number => {
  const n = Math.floor(Number(value ?? 1))
  return Number.isFinite(n) && n > 0 ? n : 1
}

const normalizePlacementInitiative = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

const cloneEntryState = (entry: InitiativeEntryState): InitiativeEntryState => ({
  tokenId: entry.tokenId,
  initiative: entry.initiative,
})

const cloneLaneState = (state: InitiativeLaneState): InitiativeLaneState => ({
  activeId: state.activeId,
  round: state.round,
  entries: state.entries.map(cloneEntryState),
})

const initiativeLaneState = (map: TabletopMap): InitiativeLaneState => {
  const placementIds = new Set(map.placements.map((placement) => placement.id))
  const rawActiveId = map.initiative?.activeId ?? null
  return {
    activeId: rawActiveId && placementIds.has(rawActiveId) ? rawActiveId : null,
    round: normalizeRound(map.initiative?.round),
    entries: map.placements.map((placement) => ({
      tokenId: placement.id,
      initiative: normalizePlacementInitiative(placement.initiative),
    })),
  }
}

const changedTokenIdsBetween = (
  previous: InitiativeLaneState,
  current: InitiativeLaneState,
): readonly string[] => {
  const changed = new Set<string>()
  const previousById = new Map(previous.entries.map((entry) => [entry.tokenId, entry.initiative]))
  const currentById = new Map(current.entries.map((entry) => [entry.tokenId, entry.initiative]))

  for (const [tokenId, previousInitiative] of previousById) {
    if (!currentById.has(tokenId) || currentById.get(tokenId) !== previousInitiative) changed.add(tokenId)
  }
  for (const [tokenId, currentInitiative] of currentById) {
    if (!previousById.has(tokenId) || previousById.get(tokenId) !== currentInitiative) changed.add(tokenId)
  }

  return [...changed].sort((left, right) => left.localeCompare(right))
}

const initiativeLaneStatesEqual = (left: InitiativeLaneState, right: InitiativeLaneState): boolean => {
  if (left.activeId !== right.activeId || left.round !== right.round) return false
  if (left.entries.length !== right.entries.length) return false
  return left.entries.every((entry, index) => {
    const other = right.entries[index]
    return other !== undefined && entry.tokenId === other.tokenId && entry.initiative === other.initiative
  })
}

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => logicalMapResourcePath(map)

const initiativeScope = (): LivePlayMapScope => ({ kind: 'map', lane: 'initiative' })

const commandHasInitiativeScope = (command: LivePlayInitiativeCommand): boolean => command.scopes.some((scope) => (
  scope.kind === 'map' && scope.lane === 'initiative'
))

const expectInitiativeScope = (command: LivePlayInitiativeCommand): void => {
  if (!commandHasInitiativeScope(command)) {
    rejectLivePlayCommand('invalid', `${command.type} scopes must include the map initiative scope`)
  }
}

const expectSetInitiativePayload = (payload: unknown): SetInitiativePayload => {
  if (!isRecord(payload)) rejectLivePlayCommand('invalid', 'setInitiative payload must be an object')
  const record = payload as UnknownRecord
  const setsInitiative = hasOwn(record, 'initiative')
  const setsTokenId = hasOwn(record, 'tokenId')
  const setsActive = hasOwn(record, 'activeId')
  const setsRound = hasOwn(record, 'round')

  if (!setsInitiative && !setsActive && !setsRound) {
    rejectLivePlayCommand('invalid', 'setInitiative payload must set at least one of initiative, activeId, or round')
  }

  let tokenId: string | undefined
  if (setsInitiative) {
    if (!nonEmptyString(record.tokenId)) {
      rejectLivePlayCommand('invalid', 'setInitiative payload.tokenId is required when initiative is provided')
    }
    tokenId = (record.tokenId as string).trim()
    const initiative = record.initiative
    const validInitiative = initiative === null || (
      safeInteger(initiative)
      && initiative >= LIVE_PLAY_INITIATIVE_MIN_VALUE
      && initiative <= LIVE_PLAY_INITIATIVE_MAX_VALUE
    )
    if (!validInitiative) {
      rejectLivePlayCommand(
        'invalid',
        `setInitiative payload.initiative must be an integer from ${LIVE_PLAY_INITIATIVE_MIN_VALUE} to ${LIVE_PLAY_INITIATIVE_MAX_VALUE}, or null`,
      )
    }
  } else if (setsTokenId) {
    rejectLivePlayCommand('invalid', 'setInitiative payload.tokenId is only valid when initiative is provided')
  }

  let activeId: string | null | undefined
  if (setsActive) {
    if (record.activeId !== null && !nonEmptyString(record.activeId)) {
      rejectLivePlayCommand('invalid', 'setInitiative payload.activeId must be a non-empty token ID string or null')
    }
    activeId = record.activeId === null ? null : (record.activeId as string).trim()
  }

  let round: number | undefined
  if (setsRound) {
    if (!safeInteger(record.round) || record.round < 1) {
      rejectLivePlayCommand('invalid', 'setInitiative payload.round must be a safe integer greater than or equal to 1')
    }
    round = record.round as number
  }

  return {
    ...(setsInitiative ? { tokenId, initiative: record.initiative as number | null } : {}),
    ...(setsActive ? { activeId } : {}),
    ...(setsRound ? { round } : {}),
  }
}

const duplicateString = (values: readonly string[]): string | null => {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return null
}

const expectAdvanceInitiativePayload = (payload: unknown): AdvanceInitiativePayload => {
  if (!isRecord(payload)) rejectLivePlayCommand('invalid', 'initiative advance payload must be an object')
  const record = payload as UnknownRecord

  if (!Array.isArray(record.orderIds)) {
    rejectLivePlayCommand('invalid', 'initiative advance payload.orderIds must be the visible initiative order')
  }

  const rawOrderIds = record.orderIds as unknown[]
  const orderIds = rawOrderIds.map((value: unknown, index: number) => {
    if (!nonEmptyString(value)) {
      rejectLivePlayCommand('invalid', `initiative advance payload.orderIds[${index}] must be a non-empty token ID string`)
    }
    return value as string
  })
  const duplicateOrderId = duplicateString(orderIds)
  if (duplicateOrderId) {
    rejectLivePlayCommand('invalid', `initiative advance payload.orderIds must not contain duplicate token ID ${duplicateOrderId}`)
  }

  if (!hasOwn(record, 'activeId')) {
    rejectLivePlayCommand('invalid', 'initiative advance payload.activeId is required')
  }
  if (record.activeId !== null && !nonEmptyString(record.activeId)) {
    rejectLivePlayCommand('invalid', 'initiative advance payload.activeId must be a non-empty token ID string or null')
  }

  if (!safeInteger(record.round) || record.round < 1) {
    rejectLivePlayCommand('invalid', 'initiative advance payload.round must be a safe integer greater than or equal to 1')
  }

  if (hasOwn(record, 'orderFingerprint') && typeof record.orderFingerprint !== 'string') {
    rejectLivePlayCommand('invalid', 'initiative advance payload.orderFingerprint must be a string when provided')
  }

  const orderFingerprint = typeof record.orderFingerprint === 'string'
    ? record.orderFingerprint
    : undefined

  return {
    orderIds,
    activeId: record.activeId === null ? null : (record.activeId as string),
    round: record.round as number,
    ...(orderFingerprint === undefined ? {} : { orderFingerprint }),
  }
}

const assertInitiativeCommandType = (
  command: LivePlayInitiativeCommand,
  expectedType?: LivePlayInitiativeCommandType,
): void => {
  if (expectedType && command.type !== expectedType) {
    rejectLivePlayCommand('invalid', `This route only accepts ${expectedType} commands`)
  }
  if (!initiativeCommandTypes.has(command.type)) {
    rejectLivePlayCommand('invalid', 'Initiative live-play routes support setInitiative, nextInitiative, and previousInitiative commands only')
  }
}

const validateCommandPayloadAndScopes = (command: LivePlayInitiativeCommand): SetInitiativePayload | AdvanceInitiativePayload => {
  expectInitiativeScope(command)
  if (command.type === LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE) return expectSetInitiativePayload(command.payload)
  return expectAdvanceInitiativePayload(command.payload)
}

const uniquePlacement = (
  placements: readonly SheetPlacement[],
  tokenId: string,
): { readonly placement: SheetPlacement; readonly index: number } => {
  const matches = placements
    .map((placement, index) => ({ placement, index }))
    .filter(({ placement }) => placement.id === tokenId)
  if (matches.length === 1) return matches[0] as { readonly placement: SheetPlacement; readonly index: number }
  if (matches.length === 0) return rejectLivePlayCommand('not-found', `Placement ${tokenId} not found`)
  return rejectLivePlayCommand('conflict', `Placement ${tokenId} has duplicate entries on this map`)
}

const initiativeOrder = (
  placements: readonly SheetPlacement[],
  readSheet: InitiativeSheetReader,
): readonly string[] => initiativeOrderIdsForPlacements(placements, readSheet)

const sameStringArray = (left: readonly string[], right: readonly string[]): boolean => (
  left.length === right.length && left.every((value, index) => value === right[index])
)

const rejectStaleAdvancePrecondition = (
  message: string,
  context: ResolvedInitiativeContext,
  orderIds: readonly string[],
): never => rejectLivePlayCommand('stale-revision', message, {
  currentState: {
    initiative: initiativeLaneState(context.map),
    orderIds: [...orderIds],
  },
})

const assertAdvancePrecondition = (
  command: NextInitiativeLivePlayCommand | PreviousInitiativeLivePlayCommand,
  payload: AdvanceInitiativePayload,
  context: ResolvedInitiativeContext,
  readSheet: InitiativeSheetReader,
): readonly string[] => {
  const authoritativeOrder = initiativeOrder(context.map.placements, readSheet)
  const duplicateAuthoritativeId = duplicateString(authoritativeOrder)
  if (duplicateAuthoritativeId) {
    rejectLivePlayCommand('conflict', `Authoritative initiative order contains duplicate placement ID ${duplicateAuthoritativeId}`, {
      currentState: {
        initiative: initiativeLaneState(context.map),
        orderIds: [...authoritativeOrder],
      },
    })
  }

  const authoritativeState = initiativeLaneState(context.map)
  if (!sameStringArray(payload.orderIds, authoritativeOrder)) {
    rejectStaleAdvancePrecondition(
      `${command.type} was based on a stale visible initiative order; refresh before advancing initiative.`,
      context,
      authoritativeOrder,
    )
  }

  if (payload.activeId !== authoritativeState.activeId) {
    rejectStaleAdvancePrecondition(
      `${command.type} was based on stale active initiative state; refresh before advancing initiative.`,
      context,
      authoritativeOrder,
    )
  }

  if (payload.round !== authoritativeState.round) {
    rejectStaleAdvancePrecondition(
      `${command.type} was based on stale initiative round state; refresh before advancing initiative.`,
      context,
      authoritativeOrder,
    )
  }

  return authoritativeOrder
}

const applySetInitiativePayload = (
  command: SetInitiativeLivePlayCommand,
  payload: SetInitiativePayload,
  context: ResolvedInitiativeContext,
  timestamp: number,
): TabletopMap => {
  let placements = context.map.placements.map((placement) => ({ ...placement }))
  let nextInitiativeState: InitiativeTrackerState = {
    activeId: initiativeLaneState(context.map).activeId,
    round: normalizeRound(context.map.initiative?.round),
  }

  if (payload.initiative !== undefined) {
    const tokenId = payload.tokenId as string
    const found = uniquePlacement(placements, tokenId)
    placements = placements.map((placement, index) => {
      if (index !== found.index) return placement
      const nextPlacement = { ...placement }
      if (payload.initiative === null) delete nextPlacement.initiative
      else nextPlacement.initiative = payload.initiative
      return nextPlacement
    })
  }

  if (payload.activeId !== undefined) {
    if (payload.activeId !== null) uniquePlacement(placements, payload.activeId)
    nextInitiativeState = { ...nextInitiativeState, activeId: payload.activeId }
  }

  if (payload.round !== undefined) {
    nextInitiativeState = { ...nextInitiativeState, round: payload.round }
  }

  return {
    ...context.map,
    placements,
    initiative: nextInitiativeState,
    updatedAt: timestamp,
  }
}

const applyAdvanceInitiativePayload = (
  command: NextInitiativeLivePlayCommand | PreviousInitiativeLivePlayCommand,
  payload: AdvanceInitiativePayload,
  context: ResolvedInitiativeContext,
  timestamp: number,
  readSheet: InitiativeSheetReader,
): TabletopMap => {
  const order = assertAdvancePrecondition(command, payload, context, readSheet)
  if (order.length === 0) {
    rejectLivePlayCommand('conflict', `Map ${command.mapSlug} has no placements in initiative order`, {
      currentState: initiativeLaneState(context.map),
    })
  }

  const previousState = initiativeLaneState(context.map)
  const currentIndex = previousState.activeId ? order.indexOf(previousState.activeId) : -1
  let nextActiveId: string
  let nextRound = previousState.round

  if (command.type === LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE) {
    const nextIndex = currentIndex >= 0 && currentIndex < order.length - 1 ? currentIndex + 1 : 0
    if (currentIndex === order.length - 1) nextRound += 1
    nextActiveId = order[nextIndex] as string
  } else {
    const previousIndex = currentIndex > 0 ? currentIndex - 1 : order.length - 1
    if (currentIndex === 0) nextRound = Math.max(1, nextRound - 1)
    nextActiveId = order[previousIndex] as string
  }

  return {
    ...context.map,
    initiative: {
      activeId: nextActiveId,
      round: nextRound,
    },
    updatedAt: timestamp,
  }
}

const commandGrantsInitiative = (
  command: LivePlayInitiativeCommand,
  previous: InitiativeLaneState,
  current: InitiativeLaneState,
): boolean => {
  if (!current.activeId) return false
  if (command.type === LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE) {
    return command.payload.activeId !== undefined && current.activeId !== previous.activeId
  }
  return current.activeId !== previous.activeId || current.round !== previous.round
}

const placementDisplayName = (placement: Pick<SheetPlacement, 'sheetSlug'>): string => placement.sheetSlug

const createInitiativeGainLogEntry = (
  command: LivePlayInitiativeCommand,
  previous: InitiativeLaneState,
  current: InitiativeLaneState,
  document: TabletopMap,
  timestamp: number,
): InitiativeLogEntry | undefined => {
  if (!commandGrantsInitiative(command, previous, current)) return undefined
  if (!current.activeId) return undefined

  const placement = document.placements.find((candidate) => candidate.id === current.activeId)
  if (!placement) return undefined

  return createInitiativeLogEntry({
    userId: current.activeId,
    userName: placementDisplayName(placement),
  }, {
    now: () => timestamp,
  })
}

const mapWithInitiativeLogEntry = (
  map: TabletopMap,
  logEntry: InitiativeLogEntry | undefined,
  maxLogEntries: number | undefined,
): TabletopMap => {
  if (logEntry === undefined) return map
  return {
    ...map,
    metadata: appendInitiativeLogRecord(
      map.metadata,
      logEntry,
      maxLogEntries === undefined ? {} : { maxLogEntries },
    ),
  }
}

const applyInitiativeChange = (
  command: LivePlayInitiativeCommand,
  context: ResolvedInitiativeContext,
  dependencies: Pick<LivePlayInitiativeDependencySet, 'now' | 'maxInitiativeLogEntries' | 'readSheet'>,
): AppliedInitiativeChange => {
  const previous = initiativeLaneState(context.map)
  const timestamp = dependencies.now()
  const changedMap = command.type === LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE
    ? applySetInitiativePayload(command, expectSetInitiativePayload(command.payload), context, timestamp)
    : applyAdvanceInitiativePayload(
        command,
        expectAdvanceInitiativePayload(command.payload),
        context,
        timestamp,
        dependencies.readSheet,
      )
  const current = initiativeLaneState(changedMap)

  if (initiativeLaneStatesEqual(previous, current)) {
    rejectLivePlayCommand('no-op', 'The requested initiative change is already reflected in authoritative state', {
      currentState: previous,
    })
  }

  const logEntry = createInitiativeGainLogEntry(command, previous, current, changedMap, timestamp)
  return {
    previous,
    current,
    logEntry,
    nextMap: mapWithInitiativeLogEntry(changedMap, logEntry, dependencies.maxInitiativeLogEntries),
  }
}

const commandPatch = (
  command: LivePlayInitiativeCommand,
  revision: number,
  change: Pick<AppliedInitiativeChange, 'previous' | 'current' | 'logEntry'>,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE, InitiativePatchPayload, LivePlayMapScope> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE,
  mapSlug: command.mapSlug,
  revision,
  scopes: [initiativeScope()],
  payload: {
    command: command.type,
    previous: cloneLaneState(change.previous),
    current: cloneLaneState(change.current),
    changedTokenIds: changedTokenIdsBetween(change.previous, change.current),
    ...(change.logEntry === undefined ? {} : { logEntry: change.logEntry }),
  },
})

const resolveContext = async (
  command: LivePlayInitiativeCommand,
  dependencies: LivePlayInitiativeDependencySet,
): Promise<ResolvedInitiativeContext> => {
  const map = await dependencies.mapRepository.getBySlug(command.mapSlug)
  if (!map) throw new LivePlayInitiativeCommandUseCaseError(404, `Map ${command.mapSlug}.json not found`)
  const mapPath = mapPathForDocument(map)
  return {
    mapPath,
    relativePath: dependencies.relativePath(mapPath),
    map,
  }
}

const responseFromContext = (
  result: LivePlayCommandResult,
  context: ResolvedInitiativeContext | null,
): LivePlayInitiativeCommandResponse => ({
  result,
  ...(context ? {
    path: context.relativePath,
    map: context.map,
    initiative: initiativeLaneState(context.map),
  } : {}),
})

const isAcceptedResult = (result: LivePlayCommandResult): result is LivePlayCommandAccepted => (
  result.ok === true && !('duplicate' in result)
)

const currentContextForAcceptedResult = async (
  result: LivePlayCommandAccepted,
  dependencies: LivePlayInitiativeDependencySet,
): Promise<ResolvedInitiativeContext | null> => {
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

export const executeLivePlayInitiativeCommandUseCase = async (
  input: ExecuteLivePlayInitiativeCommandInput,
  dependencies: LivePlayInitiativeCommandDependencies = {},
): Promise<LivePlayInitiativeCommandResponse> => {
  const deps = actionDependencies(dependencies)
  let persistedContext: ResolvedInitiativeContext | null = null

  const result = await deps.commandExecutor.execute<LivePlayInitiativeCommand, ResolvedInitiativeContext, LivePlayInitiativeCommandActor>({
    command: input.command,
    actor: {
      role: input.role,
      clientId: input.clientId,
    },
    readMap: ({ command }) => resolveContext(command, deps),
    getMapRevision: (context) => normalizeRevision(context.map.revision),
    authorize: ({ command, actor }) => {
      assertInitiativeCommandType(command, input.expectedType)
      validateCommandPayloadAndScopes(command)
      if (actor.role !== 'gm') {
        rejectLivePlayCommand('unauthorized', 'Only GMs can manage initiative')
      }
    },
    apply: ({ command, map, currentRevision }) => {
      const change = applyInitiativeChange(command, map, deps)
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
    persist: () => {
      throw new Error('live-play initiative commands must persist through the accepted-result commit hook')
    },
    commit: ({ actor, currentRevision, nextMap, result, saveOpResult }) => {
      const persisted = toPersistedMap(nextMap.map, nextMap.map.folder ?? '', deps.now(), { revision: result.revision })
      const authoritativeMap = commitLivePlayMapUpdate({
        database: deps.database,
        mapRepository: deps.mapRepository,
        mapSlug: result.mapSlug,
        expectedRevision: currentRevision,
        nextMap: persisted,
        staleError: () => new LivePlayInitiativeCommandUseCaseError(409, `Map ${result.mapSlug} changed before the live-play initiative command could be persisted`),
        missingMapError: () => new LivePlayInitiativeCommandUseCaseError(404, `Map ${result.mapSlug}.json not found after live-play initiative command`),
        saveOpResult,
      })
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
