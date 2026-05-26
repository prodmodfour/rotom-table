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
import {
  HAZARD_COMMAND_SCOPE_FIELD,
  PLACE_HAZARD_COMMAND_TYPE,
  REMOVE_HAZARD_COMMAND_TYPE,
  validateHazardCommand,
  type HazardCommand,
  type HazardCommandPayload,
  type HazardCommandType,
  type PlaceHazardCommand,
  type PlaceHazardCommandPayload,
  type RemoveHazardCommandPayload,
  type SessionHazardCell,
  type SessionHazardPlacement,
} from '#shared/sessionHazardCommands'
import type { SessionId } from '#shared/sessionIdentity'
import type { PermissionDenied } from '#shared/sessionPermissions'
import { compareSessionRevisions, type MapRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  getSessionMapState,
  type AuthoritativeSessionMapState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import type { MapHazardKind, MapHazardV2, TabletopMapV2 } from '~/types/map'
import {
  hazardInBounds,
  mapHazardKey,
  normalizeMapHazardLayer,
} from '~/utils/mapHazards'
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
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class ApplyHazardCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const HAZARDS_UPDATED_PATCH_EVENT_TYPE = 'hazardsUpdated' as const

export interface HazardCellState {
  readonly mapSlug: SessionMapSlug
  readonly cell: SessionHazardCell
  readonly hazards: readonly MapHazardV2[]
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
}

export interface HazardPatchPayload {
  readonly mapSlug: SessionMapSlug
  readonly command: HazardCommandType
  readonly cell: SessionHazardCell
  readonly previous: readonly MapHazardV2[]
  readonly current: readonly MapHazardV2[]
  readonly placed?: MapHazardV2
  readonly removed: readonly MapHazardV2[]
}

export type HazardPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof HAZARDS_UPDATED_PATCH_EVENT_TYPE,
  HazardPatchPayload
>

export type HazardAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  HazardCommandType,
  HazardCommandPayload,
  TabletopMapV2,
  typeof HAZARDS_UPDATED_PATCH_EVENT_TYPE,
  HazardPatchPayload
>

export type HazardRejectedResult = SessionCommandRejectedResult<
  HazardCommandType,
  HazardCellState | null,
  SessionRevision
>

export type HazardDuplicateResult = SessionCommandDuplicateResult<
  HazardCommandType,
  SessionRevision
>

export interface ApplyHazardCommandInput {
  readonly command?: unknown
}

export type ApplyHazardCommandClock = () => string
export type ApplyHazardCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export interface ApplyHazardCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplyHazardCommandClock
  readonly writeSnapshot?: ApplyHazardCommandSnapshotWriter
}

export interface AppliedHazardSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedHazardSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplyHazardAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedHazardSessionDetails
  readonly command: HazardCommand
  readonly result: HazardAcceptedApplication['result']
  readonly patchEvent: HazardPatchEvent
  readonly eventLogEntry: HazardAcceptedApplication['eventLogEntry']
  readonly previousHazards: HazardCellState
  readonly hazards: HazardCellState
  readonly snapshot: AppliedHazardSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: HazardAcceptedApplication['mapRevisionChanges']
}

export interface ApplyHazardRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedHazardSessionDetails
  readonly command: HazardCommand
  readonly result: HazardRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplyHazardDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedHazardSessionDetails
  readonly command: HazardCommand
  readonly result: HazardDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplyHazardCommandUseCaseResult =
  | ApplyHazardAcceptedResult
  | ApplyHazardRejectedResult
  | ApplyHazardDuplicateResult

type HazardSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedHazardMap = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
}

type HazardMapChange = {
  readonly document: TabletopMapV2
  readonly cell: SessionHazardCell
  readonly previous: readonly MapHazardV2[]
  readonly current: readonly MapHazardV2[]
  readonly placed?: MapHazardV2
  readonly removed: readonly MapHazardV2[]
}

const defaultClock: ApplyHazardCommandClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const metadataForResult = (
  command: HazardCommand,
  processedAt: string,
): SessionCommandResultMetadata => ({
  serverProcessedAt: processedAt,
  ...(command.metadata?.traceId === undefined ? {} : { traceId: command.metadata.traceId }),
})

const issueSummary = (issues: readonly SessionCommandValidationIssue[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const cloneCell = (cell: SessionHazardCell): SessionHazardCell => ({
  x: cell.x,
  y: cell.y,
  z: cell.z,
})

const cloneHazard = (hazard: MapHazardV2): MapHazardV2 => ({
  kind: hazard.kind,
  x: hazard.x,
  y: hazard.y,
  z: hazard.z,
  ...(hazard.layer === undefined ? {} : { layer: hazard.layer }),
  ...(hazard.owner === undefined ? {} : { owner: hazard.owner }),
})

const cellMatchesHazard = (
  hazard: Pick<MapHazardV2, 'x' | 'y' | 'z'>,
  cell: Pick<SessionHazardCell, 'x' | 'y' | 'z'>,
): boolean => hazard.x === cell.x && hazard.y === cell.y && hazard.z === cell.z

const hazardsAtCell = (
  mapState: AuthoritativeSessionMapState<TabletopMapV2>,
  cell: SessionHazardCell,
): readonly MapHazardV2[] =>
  (mapState.document.hazards ?? [])
    .filter((hazard) => cellMatchesHazard(hazard, cell))
    .map(cloneHazard)

const currentHazardState = (
  mapSlug: SessionMapSlug,
  mapState: AuthoritativeSessionMapState<TabletopMapV2>,
  sessionRevision: SessionRevision,
  cell: SessionHazardCell,
): HazardCellState => ({
  mapSlug,
  cell: cloneCell(cell),
  hazards: hazardsAtCell(mapState, cell),
  revision: sessionRevision,
  mapRevision: mapState.revision,
})

const getActiveHazardRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<HazardCommand, 'sessionId'>,
): HazardSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplyHazardCommandUseCaseError(
      404,
      'No live session was found for the supplied hazard command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplyHazardCommandUseCaseError(
      409,
      'The live session must be active before hazard commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplyHazardCommandUseCaseError(
      500,
      'The live session has no authoritative state available for hazard commands',
    )
  }

  return record as HazardSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedHazardSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: HazardCommand,
  record: HazardSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<HazardCommandType, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'invalid',
  message: issueSummary(issues) || `${command.type} command is invalid.`,
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: command.type,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  issues,
  metadata: metadataForResult(command, processedAt),
})

const createUnauthorizedRejection = (
  command: HazardCommand,
  record: HazardSessionRecord,
  permission: PermissionDenied | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  HazardCommandType,
  HazardCellState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'Only the GM can manage hazards in a live session.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: command.type,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  ...(permission === undefined ? {} : { permission }),
  metadata: metadataForResult(command, processedAt),
})

const createConflictRejection = (
  command: HazardCommand,
  record: HazardSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly currentState?: HazardCellState | null
    readonly conflictingScopes?: HazardCommand['scopes']
  } = {},
): SessionCommandConflictRejection<
  HazardCommandType,
  HazardCellState | null,
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
  commandType: command.type,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  conflictingScopes: options.conflictingScopes ?? command.scopes,
  ...(options.currentState === undefined ? {} : { currentState: options.currentState }),
  metadata: metadataForResult(command, processedAt),
})

const createStaleRejection = (
  command: HazardCommand,
  record: HazardSessionRecord,
  message: string,
  processedAt: string,
  currentState: HazardCellState | null,
  changedScopes: readonly SessionCommandScope[] = command.scopes,
): SessionCommandStaleRejection<
  HazardCommandType,
  HazardCellState | null,
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
  commandType: command.type,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  baseRevision: command.baseRevision,
  changedScopes,
  currentState,
  metadata: metadataForResult(command, processedAt),
})

const rejectionOutcome = (
  command: HazardCommand,
  record: HazardSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: HazardRejectedResult,
): ApplyHazardRejectedResult => ({
  status: 'rejected',
  session: sessionDetailsFor(record),
  command,
  result,
  record,
  state,
})

const mapSlugFromCommand = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  command: HazardCommand,
  validationMapSlug: string | undefined,
): SessionMapSlug | undefined => {
  if (validationMapSlug !== undefined) return validationMapSlug
  if (command.payload.mapSlug !== undefined) return command.payload.mapSlug
  const scopedMapSlug = command.scopes.find(
    (scope) => scope.lane === 'hazard' && scope.field === HAZARD_COMMAND_SCOPE_FIELD,
  )?.mapSlug
  return scopedMapSlug ?? state.selectedMapSlug ?? undefined
}

const commandCell = (command: HazardCommand): SessionHazardCell => {
  if (command.type === PLACE_HAZARD_COMMAND_TYPE) return cloneCell(command.payload.hazard)
  return cloneCell(command.payload.cell)
}

const resolveHazardMap = (
  command: HazardCommand,
  record: HazardSessionRecord,
  validationMapSlug: string | undefined,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedHazardMap }
  | { readonly ok: false; readonly result: HazardRejectedResult } => {
  const mapSlug = mapSlugFromCommand(record.state, command, validationMapSlug)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        'Hazard commands must identify a map or the session must have a selected map.',
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

  return { ok: true, target: { mapSlug, mapState } }
}

const acceptedOperationAfterBase = (
  operation: SessionOperationRecord,
  baseRevision: SessionRevision,
): boolean => operation.result.status === 'accepted' &&
  compareSessionRevisions(baseRevision, operation.result.currentRevision) === -1

const scopeTouchesHazardMap = (
  scope: SessionCommandScope,
  mapSlug: SessionMapSlug,
): boolean => {
  if (scope.lane !== 'hazard') return false
  if (scope.field !== undefined && scope.field !== HAZARD_COMMAND_SCOPE_FIELD) return false
  return scope.mapSlug === undefined || scope.mapSlug === mapSlug
}

const operationTouchesHazardTarget = (
  operation: SessionOperationRecord,
  target: ResolvedHazardMap,
): boolean => operation.scopes.some((scope) => scopeTouchesHazardMap(scope, target.mapSlug))

const staleHazardRejection = (
  command: HazardCommand,
  record: HazardSessionRecord,
  target: ResolvedHazardMap,
  processedAt: string,
  tracker: InMemorySessionOperationTracker | false,
): HazardRejectedResult | undefined => {
  if (compareSessionRevisions(command.baseRevision, record.revision) !== -1) return undefined

  const currentState = currentHazardState(
    target.mapSlug,
    target.mapState,
    record.revision,
    commandCell(command),
  )

  if (tracker === false) {
    return createStaleRejection(
      command,
      record,
      `Hazards may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before changing hazards.`,
      processedAt,
      currentState,
    )
  }

  const acceptedSinceBase = tracker
    .list(command.sessionId)
    .filter((operation) => acceptedOperationAfterBase(operation, command.baseRevision))

  const matchingHazardChange = acceptedSinceBase.find((operation) =>
    operationTouchesHazardTarget(operation, target),
  )
  if (matchingHazardChange !== undefined) {
    return createStaleRejection(
      command,
      record,
      `Hazards changed after revision ${command.baseRevision}.`,
      processedAt,
      currentState,
      matchingHazardChange.scopes,
    )
  }

  const revisionGap = record.revision - command.baseRevision
  if (acceptedSinceBase.length === 0 || revisionGap > tracker.maxRecordsPerSession) {
    return createStaleRejection(
      command,
      record,
      `Hazards may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before changing hazards.`,
      processedAt,
      currentState,
    )
  }

  return undefined
}

const mapWithUpdatedAt = (map: TabletopMapV2, processedAt: string): TabletopMapV2 => {
  const updatedAtMs = Date.parse(processedAt)
  return Number.isFinite(updatedAtMs) ? { ...map, updatedAt: updatedAtMs } : { ...map }
}

const normalizedHazard = (hazard: SessionHazardPlacement): MapHazardV2 => {
  const kind = hazard.kind as MapHazardKind
  const out: MapHazardV2 = {
    kind,
    x: hazard.x,
    y: hazard.y,
    z: hazard.z,
  }
  const layer = normalizeMapHazardLayer(kind, hazard.layer)
  if (layer !== undefined) out.layer = layer
  if (typeof hazard.owner === 'string' && hazard.owner.trim()) out.owner = hazard.owner.trim()
  return out
}

const cellFromPlacement = (hazard: SessionHazardPlacement): SessionHazardCell => ({
  x: hazard.x,
  y: hazard.y,
  z: hazard.z,
})

const hazardCellKeyEquals = (
  left: MapHazardV2,
  right: Pick<MapHazardV2, 'kind' | 'x' | 'y' | 'z'>,
): boolean => mapHazardKey(left) === mapHazardKey(right)

const placeHazardOnMap = (
  command: HazardCommand,
  payload: PlaceHazardCommandPayload,
  record: HazardSessionRecord,
  target: ResolvedHazardMap,
  processedAt: string,
):
  | { readonly ok: true; readonly change: HazardMapChange }
  | { readonly ok: false; readonly result: HazardRejectedResult } => {
  const hazard = normalizedHazard(payload.hazard)
  const cell = cellFromPlacement(payload.hazard)
  const previous = hazardsAtCell(target.mapState, cell)

  if (!hazardInBounds(hazard, target.mapState.document.dimensions)) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Hazard ${hazard.kind} cannot be placed at ${hazard.x},${hazard.y},${hazard.z}; the cell is outside map ${target.mapSlug}.`,
        processedAt,
        {
          retryable: true,
          currentState: currentHazardState(target.mapSlug, target.mapState, record.revision, cell),
        },
      ),
    }
  }

  let placed: MapHazardV2 | undefined
  let changed = false
  const hazards = (target.mapState.document.hazards ?? []).map(cloneHazard)
  const nextHazards = hazards.map((existing) => {
    if (!hazardCellKeyEquals(existing, hazard)) return existing
    if (hazard.kind !== 'toxic-spikes') {
      placed = cloneHazard(existing)
      return existing
    }

    const nextLayer = Math.min(2, Math.max(existing.layer ?? 1, hazard.layer ?? 1) + 1)
    placed = { ...existing, layer: nextLayer }
    if (nextLayer !== (existing.layer ?? 1)) changed = true
    return cloneHazard(placed)
  })

  if (placed === undefined) {
    placed = cloneHazard(hazard)
    nextHazards.push(cloneHazard(hazard))
    changed = true
  }

  if (!changed) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        hazard.kind === 'toxic-spikes'
          ? `Toxic Spikes at ${hazard.x},${hazard.y},${hazard.z} already has the maximum layer count.`
          : `Hazard ${hazard.kind} is already present at ${hazard.x},${hazard.y},${hazard.z}.`,
        processedAt,
        {
          retryable: false,
          currentState: currentHazardState(target.mapSlug, target.mapState, record.revision, cell),
        },
      ),
    }
  }

  const nextMapState: AuthoritativeSessionMapState<TabletopMapV2> = {
    ...target.mapState,
    document: {
      ...target.mapState.document,
      hazards: nextHazards,
    },
  }
  const current = hazardsAtCell(nextMapState, cell)
  return {
    ok: true,
    change: {
      cell,
      previous,
      current,
      placed: cloneHazard(placed),
      removed: [],
      document: mapWithUpdatedAt(nextMapState.document, processedAt),
    },
  }
}

const removeHazardFromMap = (
  command: HazardCommand,
  payload: RemoveHazardCommandPayload,
  record: HazardSessionRecord,
  target: ResolvedHazardMap,
  processedAt: string,
):
  | { readonly ok: true; readonly change: HazardMapChange }
  | { readonly ok: false; readonly result: HazardRejectedResult } => {
  const cell = cloneCell(payload.cell)
  const previous = hazardsAtCell(target.mapState, cell)

  if (!hazardInBounds(cell, target.mapState.document.dimensions)) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Hazards cannot be removed at ${cell.x},${cell.y},${cell.z}; the cell is outside map ${target.mapSlug}.`,
        processedAt,
        {
          retryable: true,
          currentState: currentHazardState(target.mapSlug, target.mapState, record.revision, cell),
        },
      ),
    }
  }

  const removed: MapHazardV2[] = []
  const nextHazards = (target.mapState.document.hazards ?? [])
    .map(cloneHazard)
    .filter((hazard) => {
      const sameCell = cellMatchesHazard(hazard, cell)
      const sameKind = payload.cell.kind === undefined || hazard.kind === payload.cell.kind
      if (sameCell && sameKind) {
        removed.push(cloneHazard(hazard))
        return false
      }
      return true
    })

  if (removed.length === 0) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        payload.cell.kind === undefined
          ? `No hazards are present at ${cell.x},${cell.y},${cell.z}.`
          : `Hazard ${payload.cell.kind} is not present at ${cell.x},${cell.y},${cell.z}.`,
        processedAt,
        {
          retryable: true,
          currentState: currentHazardState(target.mapSlug, target.mapState, record.revision, cell),
        },
      ),
    }
  }

  const nextMapState: AuthoritativeSessionMapState<TabletopMapV2> = {
    ...target.mapState,
    document: {
      ...target.mapState.document,
      hazards: nextHazards,
    },
  }
  const current = hazardsAtCell(nextMapState, cell)
  return {
    ok: true,
    change: {
      cell,
      previous,
      current,
      removed,
      document: mapWithUpdatedAt(nextMapState.document, processedAt),
    },
  }
}

const applyHazardChange = (
  command: HazardCommand,
  record: HazardSessionRecord,
  target: ResolvedHazardMap,
  processedAt: string,
):
  | { readonly ok: true; readonly change: HazardMapChange }
  | { readonly ok: false; readonly result: HazardRejectedResult } => {
  if (command.type === PLACE_HAZARD_COMMAND_TYPE) {
    return placeHazardOnMap(command, command.payload, record, target, processedAt)
  }
  return removeHazardFromMap(command, command.payload, record, target, processedAt)
}

const rememberRejectedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: HazardCommand,
  result: HazardRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: HazardCommand,
  result: HazardAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForHazard = (commandInput: unknown): HazardCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<HazardCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (
      envelopeValidation.command.type !== PLACE_HAZARD_COMMAND_TYPE &&
      envelopeValidation.command.type !== REMOVE_HAZARD_COMMAND_TYPE
    ) {
      throw new ApplyHazardCommandUseCaseError(
        400,
        'applyHazardCommandUseCase only handles placeHazard and removeHazard command envelopes',
      )
    }
    return envelopeValidation.command
  }

  throw new ApplyHazardCommandUseCaseError(
    400,
    `hazard command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

export const applyHazardCommandUseCase = (
  input: ApplyHazardCommandInput = {},
  dependencies: ApplyHazardCommandDependencies = {},
): ApplyHazardCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot

  const envelope = validateEnvelopeForHazard(input.command)
  const record = getActiveHazardRecord(activeStore, envelope)
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
        result: duplicateCheck.result as HazardDuplicateResult,
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

  const commandValidation = validateHazardCommand(envelope)
  if (!commandValidation.valid) {
    const result = commandValidation.permission?.allowed === false
      ? createUnauthorizedRejection(envelope, record, commandValidation.permission, processedAt)
      : createInvalidRejection(envelope, record, commandValidation.issues, processedAt)

    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const targetResult = resolveHazardMap(
    commandValidation.command,
    record,
    commandValidation.mapSlug,
    processedAt,
  )
  if (!targetResult.ok) {
    rememberRejectedResult(tracker, envelope, targetResult.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, targetResult.result)
  }

  const staleRejection = staleHazardRejection(
    commandValidation.command,
    record,
    targetResult.target,
    processedAt,
    tracker,
  )
  if (staleRejection !== undefined) {
    rememberRejectedResult(tracker, envelope, staleRejection, processedAt)
    return rejectionOutcome(envelope, record, record.state, staleRejection)
  }

  const previousHazards = currentHazardState(
    targetResult.target.mapSlug,
    targetResult.target.mapState,
    record.revision,
    commandCell(commandValidation.command),
  )
  const change = applyHazardChange(
    commandValidation.command,
    record,
    targetResult.target,
    processedAt,
  )
  if (!change.ok) {
    rememberRejectedResult(tracker, envelope, change.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, change.result)
  }

  const applied = applyAcceptedSessionCommandEffect<
    HazardCommandType,
    HazardCommandPayload,
    TabletopMapV2,
    typeof HAZARDS_UPDATED_PATCH_EVENT_TYPE,
    HazardPatchPayload
  >({
    state: record.state,
    command: commandValidation.command,
    eventType: HAZARDS_UPDATED_PATCH_EVENT_TYPE,
    eventPayload: {
      mapSlug: targetResult.target.mapSlug,
      command: commandValidation.command.type,
      cell: cloneCell(change.change.cell),
      previous: change.change.previous.map(cloneHazard),
      current: change.change.current.map(cloneHazard),
      ...(change.change.placed === undefined ? {} : { placed: cloneHazard(change.change.placed) }),
      removed: change.change.removed.map(cloneHazard),
    },
    mapEffects: [
      {
        mapSlug: targetResult.target.mapSlug,
        document: change.change.document,
      },
    ],
  }, {
    processedAt,
  })

  const updatedRecord = activeStore.setState(record.sessionId, applied.state, {
    revision: applied.currentRevision,
    updatedAt: applied.processedAt,
  })
  if (updatedRecord === undefined) {
    throw new ApplyHazardCommandUseCaseError(
      409,
      'The live session ended before hazards could apply',
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
    throw new ApplyHazardCommandUseCaseError(
      500,
      `Failed to write hazard session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  const currentMapState = getSessionMapState(applied.state, targetResult.target.mapSlug)
  if (currentMapState === undefined) {
    throw new ApplyHazardCommandUseCaseError(
      500,
      'hazard command applied but the target map could not be found in next authoritative state',
    )
  }

  return {
    status: 'accepted',
    session: sessionDetailsFor(updatedRecord),
    command: commandValidation.command,
    result: applied.result,
    patchEvent: applied.patchEvent,
    eventLogEntry: applied.eventLogEntry,
    previousHazards,
    hazards: currentHazardState(
      targetResult.target.mapSlug,
      currentMapState,
      applied.currentRevision,
      change.change.cell,
    ),
    snapshot: {
      writtenAt: snapshot.snapshot.writtenAt,
      revision: snapshot.snapshot.revision,
    },
    record: updatedRecord,
    state: applied.state,
    mapRevisionChanges: applied.mapRevisionChanges,
  }
}
