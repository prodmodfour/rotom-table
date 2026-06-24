import {
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  type SessionCommandConflictRejection,
  type SessionCommandDuplicateResult,
  type SessionCommandInvalidRejection,
  type SessionCommandRejectedResult,
  type SessionCommandResultMetadata,
  type SessionCommandStaleRejection,
  type SessionCommandUnauthorizedRejection,
  type SessionCommandValidationIssue,
} from '#shared/sessionCommandResults'
import { type SessionCommandScope } from '#shared/sessionCommands'
import { validateSessionCommandEnvelope } from '#shared/sessionCommandValidation'
import type { SessionId } from '#shared/sessionIdentity'
import type {
  PermissionDenied,
  SessionSheetResourceRef,
  SessionTokenResourceRef,
} from '#shared/sessionPermissions'
import { compareSessionRevisions, type MapRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  getSessionMapState,
  type AuthoritativeSessionMapState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import {
  USE_MOVE_COMMAND_SCOPE_FIELD,
  USE_MOVE_COMMAND_TYPE,
  validateUseMoveCommand,
  type UseMoveCommand,
  type UseMoveCommandPayload,
} from '#shared/sessionTableActionCommands'
import { findMove } from '~~/data/ptuReference'
import type { SheetKind, SheetPlacement, TabletopMapV2 } from '~/types/map'
import type { SheetMoveUsageState } from '~/types/moveUsage'
import { moveUsageKey, type MoveFrequencyKind } from '~/utils/moveUsage'
import { assertSessionHostEnabled, type SessionHostRuntimeEnv } from '../utils/sessionHosting'
import {
  sessionOperationTracker,
  type InMemorySessionOperationTracker,
  type SessionOperationRecord,
} from '../utils/sessionOperationTracker'
import {
  applyAcceptedSessionCommandEffect,
  type AcceptedSessionCommandPatchEvent,
  type ApplyAcceptedSessionCommandEffectResult,
} from '../utils/sessionRevisionApplication'
import {
  writeSessionSnapshot,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '../utils/sessionSnapshots'
import {
  sessionStore,
  type InMemorySessionStore,
  type SessionStoreRecord,
  type SessionStoreStatus,
} from '../utils/sessionStore'
import {
  stripDerivedSheetRuntimeFields as stripDerivedSheetFields,
  toNextRevisionSheetPayload,
} from '~/utils/sheets/persistence'
import { readRuntimeSheet, writeRuntimeSheet } from '../utils/sqliteSheetRuntimeHelpers'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import {
  isMoveUsageTransitionError,
  planMoveUsageTransition,
  type PlannedMoveUsageTransition,
  type UseMoveTracking,
  type UseMoveUsageSummary,
} from '../domain/planMoveUsageTransition'

export class ApplyUseMoveCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const USE_MOVE_PATCH_EVENT_TYPE = 'moveUsed' as const

export type { UseMoveTracking, UseMoveUsageSummary } from '../domain/planMoveUsageTransition'

export interface UseMoveCurrentState {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly moveName: string
  readonly moveKey: string
  readonly usage: UseMoveUsageSummary
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
}

export interface UseMovePatchPayload {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly moveName: string
  readonly moveKey: string
  readonly frequency: string
  readonly frequencyKind: MoveFrequencyKind
  readonly tracking: UseMoveTracking
  readonly previousUsage: UseMoveUsageSummary
  readonly usage: UseMoveUsageSummary
}

export type UseMovePatchEvent = AcceptedSessionCommandPatchEvent<
  typeof USE_MOVE_PATCH_EVENT_TYPE,
  UseMovePatchPayload
>

export type UseMoveAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  typeof USE_MOVE_COMMAND_TYPE,
  UseMoveCommandPayload,
  TabletopMapV2,
  typeof USE_MOVE_PATCH_EVENT_TYPE,
  UseMovePatchPayload
>

export type UseMoveRejectedResult = SessionCommandRejectedResult<
  typeof USE_MOVE_COMMAND_TYPE,
  UseMoveCurrentState | null,
  SessionRevision
>

export type UseMoveDuplicateResult = SessionCommandDuplicateResult<
  typeof USE_MOVE_COMMAND_TYPE,
  SessionRevision
>

export interface ApplyUseMoveCommandInput {
  readonly command?: unknown
}

export type ApplyUseMoveCommandClock = () => string
export type ApplyUseMoveCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export type UseMoveSheetReader = (
  kind: SheetKind,
  slug: string,
) => { readonly path: string; readonly sheet: Record<string, unknown> } | null

export type UseMoveSheetWriter = (path: string, sheet: Record<string, unknown>) => void

export interface ApplyUseMoveCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplyUseMoveCommandClock
  readonly writeSnapshot?: ApplyUseMoveCommandSnapshotWriter
  readonly readSheet?: UseMoveSheetReader
  readonly writeSheet?: UseMoveSheetWriter
}

export interface AppliedUseMoveSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedUseMoveSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplyUseMoveAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedUseMoveSessionDetails
  readonly command: UseMoveCommand
  readonly result: UseMoveAcceptedApplication['result']
  readonly patchEvent: UseMovePatchEvent
  readonly eventLogEntry: UseMoveAcceptedApplication['eventLogEntry']
  readonly move: UseMoveCurrentState
  readonly previousMove: UseMoveCurrentState
  readonly snapshot: AppliedUseMoveSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: UseMoveAcceptedApplication['mapRevisionChanges']
}

export interface ApplyUseMoveRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedUseMoveSessionDetails
  readonly command: UseMoveCommand
  readonly result: UseMoveRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplyUseMoveDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedUseMoveSessionDetails
  readonly command: UseMoveCommand
  readonly result: UseMoveDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplyUseMoveCommandUseCaseResult =
  | ApplyUseMoveAcceptedResult
  | ApplyUseMoveRejectedResult
  | ApplyUseMoveDuplicateResult

type UseMoveSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedUseMoveTarget = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
  readonly placement: SheetPlacement
  readonly tokenResource: SessionTokenResourceRef
  readonly sheetResource?: SessionSheetResourceRef
}

type ResolvedUseMoveSheet = {
  readonly path: string
  readonly original: Record<string, unknown>
  readonly move: ResolvedSheetMove
}

type UseMoveApplicationPlan = {
  readonly previousUsage: UseMoveUsageSummary
  readonly usage: UseMoveUsageSummary
  readonly mapDocument?: TabletopMapV2
  readonly sheetPath?: string
  readonly originalSheet?: Record<string, unknown>
  readonly sheetToWrite?: Record<string, unknown>
}

interface SheetMoveRecord {
  readonly name: string
  readonly frequency?: string
}

interface ResolvedSheetMove {
  readonly moveName: string
  readonly moveKey: string
  readonly frequency: string
}

const defaultClock: ApplyUseMoveCommandClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const metadataForResult = (
  command: UseMoveCommand,
  processedAt: string,
): SessionCommandResultMetadata => ({
  serverProcessedAt: processedAt,
  ...(command.metadata?.traceId === undefined ? {} : { traceId: command.metadata.traceId }),
})

const issueSummary = (issues: readonly SessionCommandValidationIssue[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const nonEmptyString = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

const cloneTokenResource = (resource: SessionTokenResourceRef): SessionTokenResourceRef => ({
  ...resource,
})

const cloneUsageSummary = (usage: UseMoveUsageSummary): UseMoveUsageSummary => ({
  moveName: usage.moveName,
  moveKey: usage.moveKey,
  frequency: usage.frequency,
  frequencyKind: usage.frequencyKind,
  tracking: usage.tracking,
  uses: usage.uses,
  ...(usage.maxUses === undefined ? {} : { maxUses: usage.maxUses }),
  ...(usage.remainingUses === undefined ? {} : { remainingUses: usage.remainingUses }),
  ...(usage.sceneUses === undefined ? {} : { sceneUses: usage.sceneUses }),
  ...(usage.sceneMaxUses === undefined ? {} : { sceneMaxUses: usage.sceneMaxUses }),
  ...(usage.sceneRemainingUses === undefined ? {} : { sceneRemainingUses: usage.sceneRemainingUses }),
  ...(usage.sceneAvailable === undefined ? {} : { sceneAvailable: usage.sceneAvailable }),
  ...(usage.lastUsedRound === undefined ? {} : { lastUsedRound: usage.lastUsedRound }),
  ...(usage.nextAvailableRound === undefined ? {} : { nextAvailableRound: usage.nextAvailableRound }),
  available: usage.available,
})

const sheetMoves = (sheet: Record<string, unknown>): SheetMoveRecord[] => {
  const movelist = sheet.movelist
  if (!Array.isArray(movelist)) return []
  return movelist.flatMap((move): SheetMoveRecord[] => {
    if (typeof move !== 'object' || move === null || Array.isArray(move)) return []
    const record = move as Record<string, unknown>
    const name = nonEmptyString(record.name)
    if (!name) return []
    const frequency = nonEmptyString(record.frequency)
    return [{ name, ...(frequency ? { frequency } : {}) }]
  })
}

const resolveSheetMove = (
  sheet: Record<string, unknown>,
  requestedMoveName: string,
): ResolvedSheetMove | null => {
  const requestedKey = moveUsageKey(requestedMoveName)
  if (!requestedKey) return null

  for (const move of sheetMoves(sheet)) {
    const reference = findMove(move.name)
    const canonicalName = reference?.name ?? move.name
    const candidateKeys = new Set([
      moveUsageKey(move.name),
      moveUsageKey(canonicalName),
    ])
    if (!candidateKeys.has(requestedKey)) continue

    const frequency = nonEmptyString(reference?.frequency) ?? nonEmptyString(move.frequency)
    return {
      moveName: canonicalName,
      moveKey: moveUsageKey(canonicalName) || requestedKey,
      frequency: frequency ?? '',
    }
  }

  return null
}

const useMoveStateFromUsage = (
  target: ResolvedUseMoveTarget,
  revision: SessionRevision,
  usage: UseMoveUsageSummary,
): UseMoveCurrentState => ({
  tokenId: target.placement.id,
  mapSlug: target.mapSlug,
  sheetKind: target.placement.sheetKind,
  sheetSlug: target.placement.sheetSlug,
  moveName: usage.moveName,
  moveKey: usage.moveKey,
  usage: cloneUsageSummary(usage),
  revision,
  mapRevision: target.mapState.revision,
})

const defaultReadSheet: UseMoveSheetReader = (kind, slug) => {
  const result = readRuntimeSheet<Record<string, unknown>>(kind, slug)
  if (result === null) return null
  return {
    path: result.path,
    sheet: result.sheet,
  }
}

const getActiveUseMoveRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<UseMoveCommand, 'sessionId'>,
): UseMoveSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplyUseMoveCommandUseCaseError(
      404,
      'No live session was found for the supplied useMove command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplyUseMoveCommandUseCaseError(
      409,
      'The live session must be active before useMove commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplyUseMoveCommandUseCaseError(
      500,
      'The live session has no authoritative state available for useMove commands',
    )
  }

  return record as UseMoveSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedUseMoveSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: UseMoveCommand,
  record: UseMoveSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<typeof USE_MOVE_COMMAND_TYPE, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'invalid',
  message: issueSummary(issues) || 'useMove command is invalid.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: USE_MOVE_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  issues,
  metadata: metadataForResult(command, processedAt),
})

const createUnauthorizedRejection = (
  command: UseMoveCommand,
  record: UseMoveSessionRecord,
  permission: PermissionDenied | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  typeof USE_MOVE_COMMAND_TYPE,
  UseMoveCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'Only the GM or a player assigned to the target token or sheet can use a move in a live session.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: USE_MOVE_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  ...(permission === undefined ? {} : { permission }),
  metadata: metadataForResult(command, processedAt),
})

const createConflictRejection = (
  command: UseMoveCommand,
  record: UseMoveSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly conflictingScopes?: UseMoveCommand['scopes']
    readonly currentState?: UseMoveCurrentState | null
  } = {},
): SessionCommandConflictRejection<
  typeof USE_MOVE_COMMAND_TYPE,
  UseMoveCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'conflict',
  message,
  retryable: options.retryable ?? true,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: USE_MOVE_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  conflictingScopes: options.conflictingScopes ?? command.scopes,
  ...(options.currentState === undefined ? {} : { currentState: options.currentState }),
  metadata: metadataForResult(command, processedAt),
})

const createStaleRejection = (
  command: UseMoveCommand,
  record: UseMoveSessionRecord,
  message: string,
  processedAt: string,
  currentState: UseMoveCurrentState | null,
  changedScopes: readonly SessionCommandScope[] = command.scopes,
): SessionCommandStaleRejection<
  typeof USE_MOVE_COMMAND_TYPE,
  UseMoveCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'stale',
  message,
  retryable: true,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: USE_MOVE_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  baseRevision: command.baseRevision,
  changedScopes,
  currentState,
  metadata: metadataForResult(command, processedAt),
})

const rejectionOutcome = (
  command: UseMoveCommand,
  record: UseMoveSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: UseMoveRejectedResult,
): ApplyUseMoveRejectedResult => ({
  status: 'rejected',
  session: sessionDetailsFor(record),
  command,
  result,
  record,
  state,
})

const resolveMapSlug = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  resource: SessionTokenResourceRef,
): SessionMapSlug | undefined => resource.mapSlug ?? state.selectedMapSlug ?? undefined

const findTokenPlacement = (
  mapState: AuthoritativeSessionMapState<TabletopMapV2>,
  tokenId: string,
): SheetPlacement | undefined => {
  const matches = mapState.document.placements.filter((placement) => placement.id === tokenId)
  return matches.length === 1 ? matches[0] : undefined
}

const countTokenPlacements = (
  mapState: AuthoritativeSessionMapState<TabletopMapV2>,
  tokenId: string,
): number => mapState.document.placements.filter((placement) => placement.id === tokenId).length

const placementMatchesTokenResource = (
  placement: SheetPlacement,
  resource: SessionTokenResourceRef,
): boolean => {
  if (resource.sheetKind !== undefined && placement.sheetKind !== resource.sheetKind) return false
  if (resource.sheetSlug !== undefined && placement.sheetSlug !== resource.sheetSlug) return false
  return true
}

const placementMatchesSheetResource = (
  placement: SheetPlacement,
  resource: SessionSheetResourceRef | undefined,
): boolean => {
  if (resource === undefined) return true
  return placement.sheetKind === resource.sheetKind && placement.sheetSlug === resource.sheetSlug
}

const resolveUseMoveTarget = (
  command: UseMoveCommand,
  record: UseMoveSessionRecord,
  tokenResource: SessionTokenResourceRef,
  sheetResource: SessionSheetResourceRef | undefined,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedUseMoveTarget }
  | { readonly ok: false; readonly result: UseMoveRejectedResult } => {
  const mapSlug = resolveMapSlug(record.state, tokenResource)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        'useMove commands must identify a map or the session must have a selected map.',
        processedAt,
        { retryable: false },
      ),
    }
  }

  const mapState = getSessionMapState(record.state, mapSlug)
  if (mapState === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Map ${mapSlug} is not available in the authoritative session state.`,
        processedAt,
        { retryable: true },
      ),
    }
  }

  const placementCount = countTokenPlacements(mapState, command.payload.tokenId)
  if (placementCount !== 1) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        placementCount === 0
          ? `Token ${command.payload.tokenId} is not present on map ${mapSlug}.`
          : `Token ${command.payload.tokenId} has duplicate placements on map ${mapSlug}.`,
        processedAt,
        { retryable: placementCount === 0, currentState: null },
      ),
    }
  }

  const placement = findTokenPlacement(mapState, command.payload.tokenId)
  if (placement === undefined) {
    throw new ApplyUseMoveCommandUseCaseError(
      500,
      'useMove target placement count and lookup disagreed',
    )
  }

  if (!placementMatchesTokenResource(placement, tokenResource)) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Token ${command.payload.tokenId} does not match the requested token sheet resource identity.`,
        processedAt,
        { retryable: false, currentState: null },
      ),
    }
  }

  if (!placementMatchesSheetResource(placement, sheetResource)) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Token ${command.payload.tokenId} does not match the requested sheet move-usage scope.`,
        processedAt,
        { retryable: false, currentState: null },
      ),
    }
  }

  return {
    ok: true,
    target: {
      mapSlug,
      mapState,
      placement,
      tokenResource: cloneTokenResource(tokenResource),
      ...(sheetResource === undefined ? {} : { sheetResource }),
    },
  }
}

const resolveUseMoveSheet = (
  command: UseMoveCommand,
  record: UseMoveSessionRecord,
  target: ResolvedUseMoveTarget,
  processedAt: string,
  readSheet: UseMoveSheetReader,
):
  | { readonly ok: true; readonly sheet: ResolvedUseMoveSheet }
  | { readonly ok: false; readonly result: UseMoveRejectedResult } => {
  const sheetResult = readSheet(target.placement.sheetKind, target.placement.sheetSlug)
  if (sheetResult === null) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Sheet ${target.placement.sheetKind}/${target.placement.sheetSlug} could not be loaded for useMove.`,
        processedAt,
        { retryable: true, currentState: null },
      ),
    }
  }

  const move = resolveSheetMove(sheetResult.sheet, command.payload.moveName)
  if (move === null) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Move ${command.payload.moveName} is not present on sheet ${target.placement.sheetSlug}.`,
        processedAt,
        { retryable: false, currentState: null },
      ),
    }
  }

  return {
    ok: true,
    sheet: {
      path: sheetResult.path,
      original: sheetResult.sheet,
      move,
    },
  }
}

const acceptedOperationAfterBase = (
  operation: SessionOperationRecord,
  baseRevision: SessionRevision,
): boolean => operation.result.status === 'accepted' &&
  compareSessionRevisions(baseRevision, operation.result.currentRevision) === -1

const scopeTouchesTokenMoveUsage = (
  scope: SessionCommandScope,
  tokenId: string,
  mapSlug: SessionMapSlug,
): boolean => {
  const resource = scope.resource
  if (scope.lane !== 'token') return false
  if (scope.field !== USE_MOVE_COMMAND_SCOPE_FIELD) return false
  if (resource?.kind !== 'token') return false
  if (resource.tokenId !== tokenId) return false

  const scopedMapSlug = resource.mapSlug ?? scope.mapSlug
  return scopedMapSlug === undefined || scopedMapSlug === mapSlug
}

const scopeTouchesSheetMoveUsage = (
  scope: SessionCommandScope,
  placement: SheetPlacement,
): boolean => {
  const resource = scope.resource
  return scope.lane === 'sheet' &&
    scope.field === USE_MOVE_COMMAND_SCOPE_FIELD &&
    resource?.kind === 'sheet' &&
    resource.sheetKind === placement.sheetKind &&
    resource.sheetSlug === placement.sheetSlug
}

const operationTouchesUseMoveTarget = (
  operation: SessionOperationRecord,
  target: ResolvedUseMoveTarget,
): boolean => operation.commandType === USE_MOVE_COMMAND_TYPE &&
  operation.scopes.some((scope) =>
    scopeTouchesTokenMoveUsage(scope, target.placement.id, target.mapSlug) ||
    scopeTouchesSheetMoveUsage(scope, target.placement),
  )

const staleUseMoveRejection = (
  command: UseMoveCommand,
  record: UseMoveSessionRecord,
  target: ResolvedUseMoveTarget,
  currentState: UseMoveCurrentState,
  processedAt: string,
  tracker: InMemorySessionOperationTracker | false,
): UseMoveRejectedResult | undefined => {
  if (compareSessionRevisions(command.baseRevision, record.revision) !== -1) return undefined

  if (tracker === false) {
    return createStaleRejection(
      command,
      record,
      `Move usage for token ${command.payload.tokenId} may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before using it again.`,
      processedAt,
      currentState,
    )
  }

  const acceptedSinceBase = tracker
    .list(command.sessionId)
    .filter((operation) => acceptedOperationAfterBase(operation, command.baseRevision))

  const matchingUsageChange = acceptedSinceBase.find((operation) =>
    operationTouchesUseMoveTarget(operation, target),
  )
  if (matchingUsageChange !== undefined) {
    return createStaleRejection(
      command,
      record,
      `Move usage for token ${command.payload.tokenId} changed after revision ${command.baseRevision}.`,
      processedAt,
      currentState,
      matchingUsageChange.scopes,
    )
  }

  const revisionGap = record.revision - command.baseRevision
  if (acceptedSinceBase.length === 0 || revisionGap > tracker.maxRecordsPerSession) {
    return createStaleRejection(
      command,
      record,
      `Move usage for token ${command.payload.tokenId} may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before using it again.`,
      processedAt,
      currentState,
    )
  }

  return undefined
}

const touchedMapDocument = (
  map: TabletopMapV2,
  processedAt: string,
): TabletopMapV2 => {
  const updatedAtMs = Date.parse(processedAt)
  return {
    ...map,
    ...(Number.isFinite(updatedAtMs) ? { updatedAt: updatedAtMs } : {}),
  }
}

const legacyUseMoveMessage = (message: string): string =>
  message.endsWith('.') ? message : `${message}.`

const planUseMoveApplication = (
  command: UseMoveCommand,
  record: UseMoveSessionRecord,
  target: ResolvedUseMoveTarget,
  sheet: ResolvedUseMoveSheet,
  processedAt: string,
):
  | { readonly ok: true; readonly plan: UseMoveApplicationPlan }
  | { readonly ok: false; readonly result: UseMoveRejectedResult; readonly currentUsage?: UseMoveUsageSummary } => {
  const parsedAt = Date.parse(processedAt)
  let transition: PlannedMoveUsageTransition
  try {
    transition = planMoveUsageTransition({
      map: target.mapState.document,
      sheetMoveUsage: sheet.original.moveUsage as SheetMoveUsageState | undefined,
      placementId: target.placement.id,
      move: sheet.move,
      usedAt: Number.isFinite(parsedAt) ? parsedAt : undefined,
    })
  } catch (error) {
    if (!isMoveUsageTransitionError(error)) throw error
    const currentUsage = error.currentUsage
    return {
      ok: false,
      ...(currentUsage === undefined ? {} : { currentUsage }),
      result: createConflictRejection(
        command,
        record,
        legacyUseMoveMessage(error.message),
        processedAt,
        {
          retryable: error.reason === 'conflict',
          ...(currentUsage === undefined
            ? {}
            : { currentState: useMoveStateFromUsage(target, record.revision, currentUsage) }),
        },
      ),
    }
  }

  const mapDocument = transition.nextMapMoveUsage === undefined
    ? undefined
    : touchedMapDocument({ ...target.mapState.document, moveUsage: transition.nextMapMoveUsage }, processedAt)
  const sheetToWrite = transition.nextSheetMoveUsage === undefined
    ? undefined
    : toNextRevisionSheetPayload(stripDerivedSheetFields({ ...sheet.original, moveUsage: transition.nextSheetMoveUsage }))

  return {
    ok: true,
    plan: {
      previousUsage: transition.previousUsage,
      usage: transition.usage,
      ...(mapDocument === undefined ? {} : { mapDocument }),
      ...(sheetToWrite === undefined ? {} : {
        sheetPath: sheet.path,
        originalSheet: sheet.original,
        sheetToWrite,
      }),
    },
  }
}

const rememberRejectedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: UseMoveCommand,
  result: UseMoveRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: UseMoveCommand,
  result: UseMoveAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForUseMove = (commandInput: unknown): UseMoveCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<UseMoveCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (envelopeValidation.command.type !== USE_MOVE_COMMAND_TYPE) {
      throw new ApplyUseMoveCommandUseCaseError(
        400,
        'applyUseMoveCommandUseCase only handles useMove command envelopes',
      )
    }

    return envelopeValidation.command
  }

  throw new ApplyUseMoveCommandUseCaseError(
    400,
    `useMove command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

const rollbackWrittenSheet = (
  writeSheet: UseMoveSheetWriter,
  path: string,
  original: Record<string, unknown>,
): void => {
  writeSheet(path, stripDerivedSheetFields(original))
}

export const applyUseMoveCommandUseCase = (
  input: ApplyUseMoveCommandInput = {},
  dependencies: ApplyUseMoveCommandDependencies = {},
): ApplyUseMoveCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot
  const readSheet = dependencies.readSheet ?? defaultReadSheet
  const writeSheet = dependencies.writeSheet ?? writeRuntimeSheet

  const envelope = validateEnvelopeForUseMove(input.command)
  const record = getActiveUseMoveRecord(activeStore, envelope)
  const processedAt = clock()

  if (tracker !== false) {
    const duplicateCheck = tracker.check(envelope, {
      currentRevision: record.revision,
      processedAt,
    })

    if (duplicateCheck.status === 'duplicate') {
      return {
        status: 'duplicate',
        session: sessionDetailsFor(record),
        command: envelope,
        result: duplicateCheck.result as UseMoveDuplicateResult,
        record,
        state: record.state,
      }
    }

    if (duplicateCheck.status === 'mismatched-opId') {
      const result = createConflictRejection(
        envelope,
        record,
        duplicateCheck.message,
        processedAt,
        { retryable: false },
      )
      return rejectionOutcome(envelope, record, record.state, result)
    }
  }

  const commandValidation = validateUseMoveCommand(envelope, {
    assignments: record.state.assignments,
  })

  if (!commandValidation.valid) {
    const result = commandValidation.permission?.allowed === false
      ? createUnauthorizedRejection(envelope, record, commandValidation.permission, processedAt)
      : createInvalidRejection(envelope, record, commandValidation.issues, processedAt)

    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const targetResult = resolveUseMoveTarget(
    commandValidation.command,
    record,
    commandValidation.tokenResource,
    commandValidation.sheetResource,
    processedAt,
  )
  if (!targetResult.ok) {
    rememberRejectedResult(tracker, envelope, targetResult.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, targetResult.result)
  }

  const sheetResult = resolveUseMoveSheet(
    commandValidation.command,
    record,
    targetResult.target,
    processedAt,
    readSheet,
  )
  if (!sheetResult.ok) {
    rememberRejectedResult(tracker, envelope, sheetResult.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, sheetResult.result)
  }

  const planned = planUseMoveApplication(
    commandValidation.command,
    record,
    targetResult.target,
    sheetResult.sheet,
    processedAt,
  )

  if (!planned.ok) {
    rememberRejectedResult(tracker, envelope, planned.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, planned.result)
  }

  const currentState = useMoveStateFromUsage(
    targetResult.target,
    record.revision,
    planned.plan.previousUsage,
  )

  const staleRejection = staleUseMoveRejection(
    commandValidation.command,
    record,
    targetResult.target,
    currentState,
    processedAt,
    tracker,
  )
  if (staleRejection !== undefined) {
    rememberRejectedResult(tracker, envelope, staleRejection, processedAt)
    return rejectionOutcome(envelope, record, record.state, staleRejection)
  }

  const applied = applyAcceptedSessionCommandEffect({
    state: record.state,
    command: commandValidation.command,
    eventType: USE_MOVE_PATCH_EVENT_TYPE,
    eventPayload: {
      tokenId: targetResult.target.placement.id,
      mapSlug: targetResult.target.mapSlug,
      sheetKind: targetResult.target.placement.sheetKind,
      sheetSlug: targetResult.target.placement.sheetSlug,
      moveName: planned.plan.usage.moveName,
      moveKey: planned.plan.usage.moveKey,
      frequency: planned.plan.usage.frequency,
      frequencyKind: planned.plan.usage.frequencyKind,
      tracking: planned.plan.usage.tracking,
      previousUsage: cloneUsageSummary(planned.plan.previousUsage),
      usage: cloneUsageSummary(planned.plan.usage),
    },
    mapEffects: planned.plan.mapDocument === undefined
      ? []
      : [
          {
            mapSlug: targetResult.target.mapSlug,
            document: planned.plan.mapDocument,
          },
        ],
  }, {
    processedAt,
  })

  if (planned.plan.sheetPath !== undefined && planned.plan.sheetToWrite !== undefined) {
    try {
      writeSheet(planned.plan.sheetPath, planned.plan.sheetToWrite)
    } catch (error) {
      throw new ApplyUseMoveCommandUseCaseError(
        500,
        `Failed to write useMove sheet update: ${messageFromError(error)}`,
      )
    }
  }

  const updatedRecord = activeStore.setState(record.sessionId, applied.state, {
    revision: applied.currentRevision,
    updatedAt: applied.processedAt,
  })
  if (updatedRecord === undefined) {
    if (planned.plan.sheetPath !== undefined && planned.plan.originalSheet !== undefined) {
      rollbackWrittenSheet(writeSheet, planned.plan.sheetPath, planned.plan.originalSheet)
    }
    throw new ApplyUseMoveCommandUseCaseError(
      409,
      'The live session ended before useMove could apply',
    )
  }

  let snapshot: WriteSessionSnapshotResult<TabletopMapV2>
  try {
    snapshot = snapshotWriter(applied.state, { clock: () => applied.processedAt })
  } catch (error) {
    activeStore.setState(record.sessionId, record.state, {
      revision: record.revision,
      updatedAt: record.updatedAt,
    })
    if (planned.plan.sheetPath !== undefined && planned.plan.originalSheet !== undefined) {
      try {
        rollbackWrittenSheet(writeSheet, planned.plan.sheetPath, planned.plan.originalSheet)
      } catch (rollbackError) {
        throw new ApplyUseMoveCommandUseCaseError(
          500,
          `Failed to write useMove session snapshot and failed to roll back sheet update: ${messageFromError(error)}; rollback: ${messageFromError(rollbackError)}`,
        )
      }
    }
    throw new ApplyUseMoveCommandUseCaseError(
      500,
      `Failed to write useMove session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  const currentMapState = getSessionMapState(applied.state, targetResult.target.mapSlug)
  const currentPlacement = currentMapState?.document.placements.find(
    (placement) => placement.id === commandValidation.payload.tokenId,
  )
  if (currentMapState === undefined || currentPlacement === undefined) {
    throw new ApplyUseMoveCommandUseCaseError(
      500,
      'useMove applied but the target token could not be found in next authoritative state',
    )
  }

  const targetAfter: ResolvedUseMoveTarget = {
    ...targetResult.target,
    mapState: currentMapState,
    placement: currentPlacement,
  }

  return {
    status: 'accepted',
    session: sessionDetailsFor(updatedRecord),
    command: commandValidation.command,
    result: applied.result,
    patchEvent: applied.patchEvent,
    eventLogEntry: applied.eventLogEntry,
    move: useMoveStateFromUsage(targetAfter, applied.currentRevision, planned.plan.usage),
    previousMove: useMoveStateFromUsage(targetResult.target, record.revision, planned.plan.previousUsage),
    snapshot: {
      writtenAt: snapshot.snapshot.writtenAt,
      revision: snapshot.snapshot.revision,
    },
    record: updatedRecord,
    state: applied.state,
    mapRevisionChanges: applied.mapRevisionChanges,
  }
}
