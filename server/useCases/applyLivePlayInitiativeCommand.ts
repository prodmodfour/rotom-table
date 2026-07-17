import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_INITIATIVE_MAX_VALUE,
  LIVE_PLAY_INITIATIVE_MIN_VALUE,
  LIVE_PLAY_PATCH_TYPES,
  type AdvanceInitiativePayload,
  type LivePlayCommandAccepted,
  type LivePlayCommandResult,
  type InitiativeLifecyclePatchPayload,
  type LivePlayInitiativeCommand,
  type LivePlayMapScope,
  type LivePlayPatch,
  type LivePlayScope,
  type NextInitiativeLivePlayCommand,
  type PreviousInitiativeLivePlayCommand,
  type SetInitiativeLivePlayCommand,
  type SetInitiativePayload,
} from '#shared/livePlayCommands'
import type { AuthRole } from '#shared/auth'
import {
  applyAttackOfOpportunityStateUpdate,
  readAttackOfOpportunityState,
  writeAttackOfOpportunityState,
} from '#shared/attackOfOpportunityState'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import { initiativeOrderIds } from '#shared/initiativeOrder'
import type { CharacterSheet } from '~/types/characterSheet'
import type { InitiativeTrackerState, SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
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
  SheetRevisionConflictError,
  sqliteSheetRepository,
  type PersistedSheet,
  type SheetRepository,
} from '../storage/sheetRepository'
import {
  logicalMapResourcePath,
  logicalSheetResourcePath,
} from '../utils/runtimeResourcePaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  initiativeOrderEntriesForPlacements,
  type InitiativeSheetReader,
} from '~/utils/initiativeOrderEntries'
import { expireActiveOrderEffectsForInitiativeAdvanceWithResult } from '~/utils/activeOrderEffects'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import {
  deduplicateAuthoritativeMoveSheetReads,
  type AuthoritativeMoveSheetRead,
} from '../domain/moveAutomation/context'
import {
  encounterModifiedInitiativeScore,
} from '~/utils/encounterInitiative'
import { createMoveAutomationRoomResolver } from '../domain/moveAutomation/rooms'
import { createMoveAutomationItemEffectResolver } from '../domain/moveAutomation/itemEffects'
import { advanceMapGlobalFields } from '../domain/moveAutomation/fieldMapState'
import {
  planInitiativeLifecycle,
  type InitiativeLifecyclePlan,
  type InitiativeLifecycleSheetWrite,
} from '../domain/moveAutomation/planInitiativeLifecycle'
import { encounterLifecyclePatchPayload } from '../domain/moveAutomation/lifecyclePatch'
import type { EncounterLifecycleTriggerHandler } from '../domain/moveAutomation/reduceLifecycle'
import { livePlaySheetUpdateRealtimeAppendInputs } from '../livePlay/sheetUpdateRealtime'
import { toPersistableSheetPayload } from '~/utils/sheets/persistence'
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
  readonly manualOrderIds?: readonly string[]
}

export interface InitiativePatchPayload {
  readonly command: LivePlayInitiativeCommandType
  readonly previous: InitiativeLaneState
  readonly current: InitiativeLaneState
  readonly changedTokenIds: readonly string[]
  readonly logEntry?: InitiativeLogEntry
  readonly lifecycle?: InitiativeLifecyclePatchPayload
}

export interface InitiativeMetadataPatchPayload {
  readonly command:
    | typeof LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE
    | typeof LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE
  readonly previous: Record<string, unknown>
  readonly current: Record<string, unknown>
  readonly clearedAttackOfOpportunityPromptIds: readonly string[]
  readonly expiredOrderEffectIds: readonly string[]
  readonly progressedOrderEffectIds: readonly string[]
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

export interface LivePlayInitiativeCommandSheetUpdate {
  readonly kind: SheetKind
  readonly slug: string
  readonly path: string
  readonly sheet: Record<string, unknown>
}

export interface LivePlayInitiativeCommandResponse {
  readonly result: LivePlayCommandResult
  readonly path?: string
  readonly map?: TabletopMap
  readonly initiative?: InitiativeLaneState
  readonly sheetUpdates?: readonly LivePlayInitiativeCommandSheetUpdate[]
}

export interface LivePlayInitiativeCommandDependencies {
  readonly commandExecutor?: Pick<AuthoritativeLivePlayCommandExecutor, 'execute'>
  readonly mapRepository?: Pick<MapRepository, 'getBySlug' | 'applyLivePlayUpdate'>
  readonly database?: Pick<RotomDatabase, 'withTransaction'>
  readonly sheetRepository?: InitiativeSheetRepository
  readonly readSheet?: InitiativeSheetReader
  readonly now?: () => number
  readonly relativePath?: (path: string) => string
  readonly maxInitiativeLogEntries?: number
  /** Server-owned trigger registry seam; production registrations are never client supplied. */
  readonly lifecycleHandlers?: readonly EncounterLifecycleTriggerHandler[]
}

interface InitiativeCommitPlan {
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly sheetWrites: readonly InitiativeLifecycleSheetWrite[]
  readonly lifecycle?: InitiativeLifecyclePlan
}

interface ResolvedInitiativeContext {
  readonly mapPath: string
  readonly relativePath: string
  readonly map: TabletopMap
  readonly commitPlan?: InitiativeCommitPlan
  readonly sheetUpdates?: readonly LivePlayInitiativeCommandSheetUpdate[]
}

interface InitiativeMetadataSideEffectChange {
  readonly previous: Record<string, unknown>
  readonly current: Record<string, unknown>
  readonly clearedAttackOfOpportunityPromptIds: readonly string[]
  readonly expiredOrderEffectIds: readonly string[]
  readonly progressedOrderEffectIds: readonly string[]
}

interface AppliedInitiativeChange {
  readonly nextMap: TabletopMap
  readonly previous: InitiativeLaneState
  readonly current: InitiativeLaneState
  readonly logEntry?: InitiativeLogEntry
  readonly metadataChange?: InitiativeMetadataSideEffectChange
  readonly commitPlan: InitiativeCommitPlan
}

type UnknownRecord = Record<string, unknown>
type InitiativeSheetRepository = Pick<
  SheetRepository<Record<string, unknown>>,
  'get' | 'getByRef' | 'assertRevisions' | 'applyLivePlayUpdate'
>
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
  return {
    sheet: result.document as Record<string, unknown>,
    revision: result.revision,
  }
}

const actionDependencies = (dependencies: LivePlayInitiativeCommandDependencies) => {
  const sheetRepository = dependencies.sheetRepository ?? (sqliteSheetRepository as InitiativeSheetRepository)
  return {
    commandExecutor: dependencies.commandExecutor ?? livePlayInitiativeCommandExecutor,
    mapRepository: dependencies.mapRepository ?? sqliteMapRepository,
    database: dependencies.database ?? getRotomDatabase(),
    sheetRepository,
    readSheet: dependencies.readSheet ?? initiativeSheetReaderFromRepository(sheetRepository),
    now: dependencies.now ?? Date.now,
    relativePath: dependencies.relativePath ?? ((path: string) => path),
    maxInitiativeLogEntries: dependencies.maxInitiativeLogEntries,
    lifecycleHandlers: dependencies.lifecycleHandlers ?? [],
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
  ...(state.manualOrderIds?.length ? { manualOrderIds: [...state.manualOrderIds] } : {}),
})

const validManualOrderIdsForMap = (map: TabletopMap): readonly string[] | undefined => {
  const rawOrderIds: unknown = map.initiative?.manualOrderIds
  if (!Array.isArray(rawOrderIds)) return undefined

  const placementIds = new Set(map.placements.map((placement) => placement.id))
  const orderedIds: string[] = []
  const usedIds = new Set<string>()
  for (const rawId of rawOrderIds) {
    if (!nonEmptyString(rawId)) continue
    const id = rawId.trim()
    if (!placementIds.has(id) || usedIds.has(id)) continue
    orderedIds.push(id)
    usedIds.add(id)
  }

  return orderedIds.length ? orderedIds : undefined
}

const initiativeStateFromLane = (state: InitiativeLaneState): InitiativeTrackerState => ({
  activeId: state.activeId,
  round: state.round,
  ...(state.manualOrderIds?.length ? { manualOrderIds: [...state.manualOrderIds] } : {}),
})

const initiativeLaneState = (map: TabletopMap): InitiativeLaneState => {
  const placementIds = new Set(map.placements.map((placement) => placement.id))
  const rawActiveId = map.initiative?.activeId ?? null
  const manualOrderIds = validManualOrderIdsForMap(map)
  return {
    activeId: rawActiveId && placementIds.has(rawActiveId) ? rawActiveId : null,
    round: normalizeRound(map.initiative?.round),
    entries: map.placements.map((placement) => ({
      tokenId: placement.id,
      initiative: normalizePlacementInitiative(placement.initiative),
    })),
    ...(manualOrderIds?.length ? { manualOrderIds } : {}),
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

const sameStringArray = (left: readonly string[], right: readonly string[]): boolean => (
  left.length === right.length && left.every((value, index) => value === right[index])
)

const sameOptionalStringArray = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean => {
  if (left === undefined || right === undefined) return left === right
  return sameStringArray(left, right)
}

const initiativeLaneStatesEqual = (left: InitiativeLaneState, right: InitiativeLaneState): boolean => {
  if (left.activeId !== right.activeId || left.round !== right.round) return false
  if (!sameOptionalStringArray(left.manualOrderIds, right.manualOrderIds)) return false
  if (left.entries.length !== right.entries.length) return false
  return left.entries.every((entry, index) => {
    const other = right.entries[index]
    return other !== undefined && entry.tokenId === other.tokenId && entry.initiative === other.initiative
  })
}

const mapPathForDocument = (map: Pick<TabletopMap, 'folder' | 'slug'>): string => logicalMapResourcePath(map)

const initiativeScope = (): LivePlayMapScope => ({ kind: 'map', lane: 'initiative' })
const metadataScope = (): LivePlayMapScope => ({ kind: 'map', lane: 'metadata' })

const commandScopes = (command: LivePlayInitiativeCommand): readonly LivePlayScope[] => (
  command.scopes as readonly LivePlayScope[]
)

const commandHasMapScope = (
  command: LivePlayInitiativeCommand,
  lane: LivePlayMapScope['lane'],
): boolean => commandScopes(command).some((scope) => scope.kind === 'map' && scope.lane === lane)

const unsupportedScopeLabel = (scope: LivePlayScope): string => {
  if (scope.kind === 'map') return `map ${scope.lane}`
  if (scope.kind === 'token') return `token ${scope.placementId} ${scope.field}`
  return `sheet ${scope.sheetKind}:${scope.sheetSlug} ${scope.field}`
}

const expectOnlyMapScopes = (
  command: LivePlayInitiativeCommand,
  allowedLanes: ReadonlySet<LivePlayMapScope['lane']>,
): void => {
  const unsupported = commandScopes(command).find((scope) => scope.kind !== 'map' || !allowedLanes.has(scope.lane))
  if (unsupported) {
    rejectLivePlayCommand('invalid', `${command.type} scopes include unsupported ${unsupportedScopeLabel(unsupported)} scope`)
  }
}

const expectSetInitiativeScopes = (command: LivePlayInitiativeCommand): void => {
  if (!commandHasMapScope(command, 'initiative')) {
    rejectLivePlayCommand('invalid', `${command.type} scopes must include the map initiative scope`)
  }
  expectOnlyMapScopes(command, new Set(['initiative']))
}

const expectAdvanceInitiativeScopes = (command: LivePlayInitiativeCommand): void => {
  if (!commandHasMapScope(command, 'initiative')) {
    rejectLivePlayCommand('invalid', `${command.type} scopes must include the map initiative scope`)
  }
  if (!commandHasMapScope(command, 'metadata')) {
    rejectLivePlayCommand('invalid', `${command.type} scopes must include the map metadata scope`)
  }
  expectOnlyMapScopes(command, new Set(['initiative', 'metadata']))
}

const expectSetInitiativePayload = (payload: unknown): SetInitiativePayload => {
  if (!isRecord(payload)) rejectLivePlayCommand('invalid', 'setInitiative payload must be an object')
  const record = payload as UnknownRecord
  const setsInitiative = hasOwn(record, 'initiative')
  const setsTokenId = hasOwn(record, 'tokenId')
  const setsActive = hasOwn(record, 'activeId')
  const setsRound = hasOwn(record, 'round')
  const setsManualOrder = hasOwn(record, 'manualOrderIds')

  if (!setsInitiative && !setsActive && !setsRound && !setsManualOrder) {
    rejectLivePlayCommand('invalid', 'setInitiative payload must set at least one of initiative, activeId, round, or manualOrderIds')
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

  let manualOrderIds: readonly string[] | null | undefined
  if (setsManualOrder) {
    if (record.manualOrderIds === null) {
      manualOrderIds = null
    } else if (!Array.isArray(record.manualOrderIds)) {
      rejectLivePlayCommand('invalid', 'setInitiative payload.manualOrderIds must be a non-empty array of unique token ID strings, or null')
    } else {
      if (record.manualOrderIds.length === 0) {
        rejectLivePlayCommand('invalid', 'setInitiative payload.manualOrderIds must not be empty; use null to clear manual order')
      }
      const ids: string[] = []
      const seenIds = new Set<string>()
      for (const [index, rawId] of record.manualOrderIds.entries()) {
        if (!nonEmptyString(rawId)) {
          rejectLivePlayCommand('invalid', `setInitiative payload.manualOrderIds[${index}] must be a non-empty token ID string`)
        }
        const id = rawId.trim()
        if (seenIds.has(id)) {
          rejectLivePlayCommand('invalid', `setInitiative payload.manualOrderIds must not contain duplicate token ID ${id}`)
        }
        seenIds.add(id)
        ids.push(id)
      }
      manualOrderIds = ids
    }
  }

  return {
    ...(setsInitiative ? { tokenId, initiative: record.initiative as number | null } : {}),
    ...(setsActive ? { activeId } : {}),
    ...(setsRound ? { round } : {}),
    ...(setsManualOrder ? { manualOrderIds } : {}),
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
  if (command.type === LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE) {
    // setInitiative remains an explicit administrative edit in this phase: it only
    // claims the initiative lane and does not run automatic AoO or Order side effects.
    expectSetInitiativeScopes(command)
    return expectSetInitiativePayload(command.payload)
  }

  // Live initiative advancement owns both the initiative lane and the map metadata
  // lane so turn transitions and their AoO/Order side effects commit atomically.
  expectAdvanceInitiativeScopes(command)
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

const validatedCompleteManualOrderIds = (
  placements: readonly SheetPlacement[],
  manualOrderIds: readonly string[],
): readonly string[] => {
  const placementIds = placements.map((placement) => placement.id)
  const duplicatePlacementId = duplicateString(placementIds)
  if (duplicatePlacementId) {
    rejectLivePlayCommand('conflict', `Placement ${duplicatePlacementId} has duplicate entries on this map`)
  }

  const placementIdSet = new Set(placementIds)
  for (const id of manualOrderIds) {
    if (!placementIdSet.has(id)) {
      rejectLivePlayCommand('not-found', `Manual initiative order contains unknown placement ${id}`)
    }
  }

  if (manualOrderIds.length !== placementIds.length) {
    const submittedIds = new Set(manualOrderIds)
    const missingId = placementIds.find((id) => !submittedIds.has(id))
    rejectLivePlayCommand(
      'invalid',
      missingId
        ? `Manual initiative order must include every placement exactly once; missing placement ${missingId}`
        : 'Manual initiative order must include every placement exactly once',
    )
  }

  return [...manualOrderIds]
}

interface InitiativeOrderPlan {
  readonly orderIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
}

const initiativeOrder = (
  map: TabletopMap,
  readSheet: InitiativeSheetReader,
  manualOrderIds?: readonly string[] | null,
): InitiativeOrderPlan => {
  // A complete GM-authored order is authoritative and bypasses every calculated
  // sheet/effect modifier query. Legacy partial orders still overlay the
  // calculated remainder through the existing deterministic order helper.
  if (manualOrderIds?.length === map.placements.length) {
    return { orderIds: [...manualOrderIds], sheetReads: [] }
  }

  const reads: AuthoritativeMoveSheetRead[] = []
  const trackedReader: InitiativeSheetReader = (kind, slug) => {
    const result = readSheet(kind, slug)
    if (result?.revision !== undefined) {
      reads.push({ kind, slug, revision: normalizeRevision(result.revision) })
    }
    return result
  }
  const placementById = new Map(map.placements.map(placement => [placement.id, placement]))
  const rooms = createMoveAutomationRoomResolver(map)
  const itemEffects = createMoveAutomationItemEffectResolver({
    placements: map.placements,
    rooms,
  })
  const calculatedEntries = initiativeOrderEntriesForPlacements(
    map.placements,
    trackedReader,
    placement => ({
      itemEffectsSuppressed: itemEffects.resolve({
        placementId: placement.id,
        scope: placement.sheetKind === 'pokemon'
          ? 'pokemon-held'
          : 'trainer-accessory',
        timing: 'static',
      }).suppressed,
    }),
  ).map((entry) => {
    const placement = placementById.get(entry.id)
    if (!placement) return entry
    return {
      ...entry,
      initiativeScore: encounterModifiedInitiativeScore({
        map,
        placement,
        calculatedScore: entry.initiativeScore,
      }),
    }
  })

  return {
    orderIds: initiativeOrderIds(
      calculatedEntries,
      manualOrderIds,
      rooms.calculatedInitiativeDirection(),
    ),
    sheetReads: deduplicateAuthoritativeMoveSheetReads(reads),
  }
}

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
): InitiativeOrderPlan => {
  const authoritativeState = initiativeLaneState(context.map)
  const orderPlan = initiativeOrder(context.map, readSheet, authoritativeState.manualOrderIds)
  const authoritativeOrder = orderPlan.orderIds
  const duplicateAuthoritativeId = duplicateString(authoritativeOrder)
  if (duplicateAuthoritativeId) {
    rejectLivePlayCommand('conflict', `Authoritative initiative order contains duplicate placement ID ${duplicateAuthoritativeId}`, {
      currentState: {
        initiative: authoritativeState,
        orderIds: [...authoritativeOrder],
      },
    })
  }

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

  return orderPlan
}

const applySetInitiativePayload = (
  command: SetInitiativeLivePlayCommand,
  payload: SetInitiativePayload,
  context: ResolvedInitiativeContext,
  timestamp: number,
): TabletopMap => {
  let placements = context.map.placements.map((placement) => ({ ...placement }))
  let nextInitiativeState: InitiativeTrackerState = initiativeStateFromLane(initiativeLaneState(context.map))

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

  if (payload.manualOrderIds !== undefined) {
    if (payload.manualOrderIds === null) {
      nextInitiativeState = { ...nextInitiativeState }
      delete nextInitiativeState.manualOrderIds
    } else {
      nextInitiativeState = {
        ...nextInitiativeState,
        manualOrderIds: [...validatedCompleteManualOrderIds(placements, payload.manualOrderIds)],
      }
    }
  }

  return {
    ...context.map,
    placements,
    initiative: nextInitiativeState,
    updatedAt: timestamp,
  }
}

interface AppliedAdvanceInitiativePayload {
  readonly map: TabletopMap
  /** Current visible order used to validate the submitted precondition. */
  readonly order: InitiativeOrderPlan
  /** Orders governing turn-end and turn-start facts when a Room changes at a boundary. */
  readonly lifecycleOrderIds: {
    readonly previous: readonly string[]
    readonly current: readonly string[]
  }
}

const mapAtForwardRoundStart = (
  map: TabletopMap,
  includeRoundEnd: boolean,
): TabletopMap => {
  const afterRoundEnd = includeRoundEnd
    ? advanceMapGlobalFields({ map, event: { kind: 'round-end' } }).map
    : map
  return advanceMapGlobalFields({
    map: afterRoundEnd,
    event: { kind: 'round-start' },
  }).map
}

const applyAdvanceInitiativePayload = (
  command: NextInitiativeLivePlayCommand | PreviousInitiativeLivePlayCommand,
  payload: AdvanceInitiativePayload,
  context: ResolvedInitiativeContext,
  timestamp: number,
  readSheet: InitiativeSheetReader,
): AppliedAdvanceInitiativePayload => {
  const orderPlan = assertAdvancePrecondition(command, payload, context, readSheet)
  const order = orderPlan.orderIds
  if (order.length === 0) {
    rejectLivePlayCommand('conflict', `Map ${command.mapSlug} has no placements in initiative order`, {
      currentState: initiativeLaneState(context.map),
    })
  }

  const previousState = initiativeLaneState(context.map)
  const currentIndex = previousState.activeId ? order.indexOf(previousState.activeId) : -1
  let nextActiveId: string
  let nextRound = previousState.round
  let resultingOrderPlan = orderPlan

  if (command.type === LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE) {
    const startsRound = currentIndex < 0
    const wrapsRound = currentIndex === order.length - 1
    if (startsRound || wrapsRound) {
      resultingOrderPlan = initiativeOrder(
        mapAtForwardRoundStart(context.map, wrapsRound),
        readSheet,
        previousState.manualOrderIds,
      )
      if (resultingOrderPlan.orderIds.length === 0) {
        rejectLivePlayCommand('conflict', `Map ${command.mapSlug} has no placements at the next round boundary`, {
          currentState: initiativeLaneState(context.map),
        })
      }
      if (wrapsRound) nextRound += 1
      nextActiveId = resultingOrderPlan.orderIds[0] as string
    } else {
      nextActiveId = order[currentIndex + 1] as string
    }
  } else {
    const previousIndex = currentIndex > 0 ? currentIndex - 1 : order.length - 1
    if (currentIndex === 0) nextRound = Math.max(1, nextRound - 1)
    nextActiveId = order[previousIndex] as string
  }

  return {
    order: {
      orderIds: orderPlan.orderIds,
      sheetReads: deduplicateAuthoritativeMoveSheetReads([
        ...orderPlan.sheetReads,
        ...resultingOrderPlan.sheetReads,
      ]),
    },
    lifecycleOrderIds: {
      previous: [...orderPlan.orderIds],
      current: [...resultingOrderPlan.orderIds],
    },
    map: {
      ...context.map,
      initiative: {
        ...initiativeStateFromLane(previousState),
        activeId: nextActiveId,
        round: nextRound,
      },
      updatedAt: timestamp,
    },
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

const cloneMetadata = (metadata: Record<string, unknown> | null | undefined): Record<string, unknown> => (
  deepCloneJson(metadata ?? {})
)

const clearPendingAttackOfOpportunityPrompts = (
  metadata: Record<string, unknown> | undefined,
): {
  readonly metadata: Record<string, unknown>
  readonly clearedPromptIds: readonly string[]
} => {
  const previous = readAttackOfOpportunityState(metadata)
  if (previous.prompts.length === 0) return { metadata: metadata ?? {}, clearedPromptIds: [] }

  return {
    metadata: writeAttackOfOpportunityState(
      metadata,
      applyAttackOfOpportunityStateUpdate(previous, { action: 'clear-all' }),
    ),
    clearedPromptIds: previous.prompts.map((prompt) => prompt.id),
  }
}

const applyAdvanceMetadataSideEffects = (
  command: NextInitiativeLivePlayCommand | PreviousInitiativeLivePlayCommand,
  previous: InitiativeLaneState,
  current: InitiativeLaneState,
  metadata: Record<string, unknown> | undefined,
  timestamp: number,
): {
  readonly metadata: Record<string, unknown> | undefined
  readonly change?: InitiativeMetadataSideEffectChange
} => {
  const sideEffectPrevious = cloneMetadata(metadata)
  const attackOfOpportunityUpdate = clearPendingAttackOfOpportunityPrompts(metadata)
  let nextMetadata = attackOfOpportunityUpdate.metadata
  let expiredOrderEffectIds: readonly string[] = []
  let progressedOrderEffectIds: readonly string[] = []

  if (command.type === LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE) {
    const expiration = expireActiveOrderEffectsForInitiativeAdvanceWithResult(nextMetadata, {
      before: {
        activeId: previous.activeId,
        round: previous.round,
      },
      after: {
        activeId: current.activeId,
        round: current.round,
      },
    }, {
      now: () => timestamp,
    })
    nextMetadata = expiration.metadata
    expiredOrderEffectIds = expiration.expiredEffects.map((effect) => effect.id)
    progressedOrderEffectIds = expiration.progressedEffects.map((effect) => effect.id)
  }

  const sideEffectCurrent = cloneMetadata(nextMetadata)
  if (sameJsonValue(sideEffectPrevious, sideEffectCurrent)) {
    return { metadata }
  }

  return {
    metadata: nextMetadata,
    change: {
      previous: sideEffectPrevious,
      current: sideEffectCurrent,
      clearedAttackOfOpportunityPromptIds: attackOfOpportunityUpdate.clearedPromptIds,
      expiredOrderEffectIds,
      progressedOrderEffectIds,
    },
  }
}

const lifecycleSheetSnapshots = (
  map: TabletopMap,
  repository: InitiativeSheetRepository,
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

const applyInitiativeChange = (
  command: LivePlayInitiativeCommand,
  context: ResolvedInitiativeContext,
  dependencies: Pick<
    LivePlayInitiativeDependencySet,
    | 'now'
    | 'maxInitiativeLogEntries'
    | 'readSheet'
    | 'sheetRepository'
    | 'lifecycleHandlers'
  >,
): AppliedInitiativeChange => {
  const previous = initiativeLaneState(context.map)
  const timestamp = dependencies.now()
  const advance = command.type === LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE
    ? null
    : applyAdvanceInitiativePayload(
        command,
        expectAdvanceInitiativePayload(command.payload),
        context,
        timestamp,
        dependencies.readSheet,
      )
  const changedMap = command.type === LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE
    ? applySetInitiativePayload(command, expectSetInitiativePayload(command.payload), context, timestamp)
    : advance!.map
  const current = initiativeLaneState(changedMap)

  if (initiativeLaneStatesEqual(previous, current)) {
    rejectLivePlayCommand('no-op', 'The requested initiative change is already reflected in authoritative state', {
      currentState: previous,
    })
  }

  const metadataSideEffects = command.type === LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE
    ? null
    : applyAdvanceMetadataSideEffects(command, previous, current, changedMap.metadata, timestamp)

  const mapWithSideEffects: TabletopMap = metadataSideEffects
    ? {
        ...changedMap,
        metadata: metadataSideEffects.metadata,
      }
    : changedMap
  const lifecycle = command.type === LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE
    ? planInitiativeLifecycle({
        map: mapWithSideEffects,
        previous,
        current,
        orderIds: advance!.order.orderIds,
        previousOrderIds: advance!.lifecycleOrderIds.previous,
        currentOrderIds: advance!.lifecycleOrderIds.current,
        operationId: command.opId,
        time: timestamp,
        loadSheets: () => lifecycleSheetSnapshots(
          mapWithSideEffects,
          dependencies.sheetRepository,
        ),
        handlers: dependencies.lifecycleHandlers,
      })
    : undefined
  const mapWithLifecycle = lifecycle?.nextMap ?? mapWithSideEffects
  const logEntry = createInitiativeGainLogEntry(command, previous, current, mapWithLifecycle, timestamp)
  const nextMap = mapWithInitiativeLogEntry(mapWithLifecycle, logEntry, dependencies.maxInitiativeLogEntries)
  const sheetReads = deduplicateAuthoritativeMoveSheetReads([
    ...(advance?.order.sheetReads ?? []),
    ...(lifecycle?.sheetReads ?? []),
  ])
  const commitPlan: InitiativeCommitPlan = {
    sheetReads,
    sheetWrites: lifecycle?.sheetWrites ?? [],
    ...(lifecycle === undefined ? {} : { lifecycle }),
  }

  return {
    previous,
    current,
    logEntry,
    ...(metadataSideEffects?.change === undefined
      ? {}
      : {
          metadataChange: {
            ...metadataSideEffects.change,
            current: cloneMetadata(nextMap.metadata),
          },
        }),
    commitPlan,
    nextMap,
  }
}

const lifecyclePatchPayload = (
  lifecycle: InitiativeLifecyclePlan,
): InitiativeLifecyclePatchPayload => encounterLifecyclePatchPayload({
  ...lifecycle,
  reductions: [lifecycle.reduction],
})

const commandPatch = (
  command: LivePlayInitiativeCommand,
  revision: number,
  change: Pick<AppliedInitiativeChange, 'previous' | 'current' | 'logEntry' | 'commitPlan'>,
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
    ...(change.commitPlan.lifecycle === undefined
      ? {}
      : { lifecycle: lifecyclePatchPayload(change.commitPlan.lifecycle) }),
  },
})

const metadataPatch = (
  command: NextInitiativeLivePlayCommand | PreviousInitiativeLivePlayCommand,
  revision: number,
  change: InitiativeMetadataSideEffectChange,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_METADATA, InitiativeMetadataPatchPayload, LivePlayMapScope> => ({
  schemaVersion: command.schemaVersion,
  type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
  mapSlug: command.mapSlug,
  revision,
  scopes: [metadataScope()],
  payload: {
    command: command.type,
    previous: cloneMetadata(change.previous),
    current: cloneMetadata(change.current),
    clearedAttackOfOpportunityPromptIds: [...change.clearedAttackOfOpportunityPromptIds],
    expiredOrderEffectIds: [...change.expiredOrderEffectIds],
    progressedOrderEffectIds: [...change.progressedOrderEffectIds],
  },
})

const acceptedPatches = (
  command: LivePlayInitiativeCommand,
  revision: number,
  change: AppliedInitiativeChange,
): readonly LivePlayPatch[] => {
  const patches: LivePlayPatch[] = [commandPatch(command, revision, change)]
  if (command.type !== LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE && change.metadataChange !== undefined) {
    patches.push(metadataPatch(command, revision, change.metadataChange))
  }
  return patches
}

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

const sheetUpdateFromPersisted = (
  sheet: PersistedSheet,
  dependencies: LivePlayInitiativeDependencySet,
): LivePlayInitiativeCommandSheetUpdate => ({
  kind: sheet.kind,
  slug: sheet.slug,
  path: dependencies.relativePath(logicalSheetResourcePath(sheet.kind, sheet.sheet)),
  sheet: deepCloneJson(sheet.sheet),
})

const lifecycleSheetChangesFromAccepted = (
  result: LivePlayCommandAccepted,
): readonly InitiativeLifecyclePatchPayload['sheetChanges'][number][] => {
  const patch = result.patches.find(candidate => candidate.type === LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE)
  if (!patch || !isRecord(patch.payload) || !isRecord(patch.payload.lifecycle)) return []
  return Array.isArray(patch.payload.lifecycle.sheetChanges)
    ? patch.payload.lifecycle.sheetChanges as InitiativeLifecyclePatchPayload['sheetChanges']
    : []
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
  dependencies: LivePlayInitiativeDependencySet,
): Promise<ResolvedInitiativeContext | null> => {
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
        commitPlan: change.commitPlan,
      }

      return {
        status: 'accepted',
        nextMap,
        previousRevision: currentRevision,
        revision,
        patches: acceptedPatches(command, revision, change),
      }
    },
    persist: () => {
      throw new Error('live-play initiative commands must persist through the accepted-result commit hook')
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
        const plan = nextMap.commitPlan ?? { sheetReads: [], sheetWrites: [] }
        try {
          if (plan.sheetReads.length > 0) {
            deps.sheetRepository.assertRevisions(plan.sheetReads)
          }
        } catch (error) {
          if (error instanceof SheetRevisionConflictError) {
            rejectLivePlayCommand(
              'conflict',
              'A sheet consulted while advancing initiative changed before commit. Refresh and retry.',
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
            `Map ${result.mapSlug} changed before the live-play initiative command could be persisted`,
            { currentRevision },
          )
        }

        for (const write of plan.sheetWrites) {
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
              `${write.kind} sheet ${write.slug} changed before initiative lifecycle effects could be persisted`,
              { currentRevision },
            )
          }
        }

        const sheetUpdates = plan.sheetWrites.map((write) => {
          const sheet = deps.sheetRepository.getByRef(write.kind, write.slug)
          if (!sheet) {
            throw new LivePlayInitiativeCommandUseCaseError(
              404,
              `${write.kind} sheet ${write.slug} not found after initiative lifecycle commit`,
            )
          }
          if (normalizeRevision(sheet.revision) !== write.revision) {
            throw new LivePlayInitiativeCommandUseCaseError(
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
          throw new LivePlayInitiativeCommandUseCaseError(
            404,
            `Map ${result.mapSlug}.json not found after live-play initiative command`,
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
