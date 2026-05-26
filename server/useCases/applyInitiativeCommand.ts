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
import type { PermissionDenied } from '#shared/sessionPermissions'
import { compareSessionRevisions, type MapRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  getSessionMapState,
  type AuthoritativeSessionMapState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import {
  INITIATIVE_COMMAND_SCOPE_FIELD,
  NEXT_INITIATIVE_COMMAND_TYPE,
  PREVIOUS_INITIATIVE_COMMAND_TYPE,
  SET_INITIATIVE_COMMAND_TYPE,
  validateInitiativeCommand,
  type InitiativeCommand,
  type InitiativeCommandPayload,
  type InitiativeCommandType,
  type SetInitiativeCommandPayload,
} from '#shared/sessionInitiativeCommands'
import type { InitiativeTrackerState, SheetPlacement, TabletopMapV2 } from '~/types/map'
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

export class ApplyInitiativeCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const INITIATIVE_PATCH_EVENT_TYPE = 'initiativeUpdated' as const

export interface InitiativeEntryState {
  readonly tokenId: string
  readonly initiative: number | null
}

export interface InitiativeLaneState {
  readonly activeId: string | null
  readonly round: number
  readonly entries: readonly InitiativeEntryState[]
}

export interface InitiativeCurrentState {
  readonly mapSlug: SessionMapSlug
  readonly initiative: InitiativeLaneState
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
}

export interface InitiativePatchPayload {
  readonly mapSlug: SessionMapSlug
  readonly command: InitiativeCommandType
  readonly previous: InitiativeLaneState
  readonly current: InitiativeLaneState
  readonly changedTokenIds: readonly string[]
}

export type InitiativePatchEvent = AcceptedSessionCommandPatchEvent<
  typeof INITIATIVE_PATCH_EVENT_TYPE,
  InitiativePatchPayload
>

export type InitiativeAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  InitiativeCommandType,
  InitiativeCommandPayload,
  TabletopMapV2,
  typeof INITIATIVE_PATCH_EVENT_TYPE,
  InitiativePatchPayload
>

export type InitiativeRejectedResult = SessionCommandRejectedResult<
  InitiativeCommandType,
  InitiativeCurrentState | null,
  SessionRevision
>

export type InitiativeDuplicateResult = SessionCommandDuplicateResult<
  InitiativeCommandType,
  SessionRevision
>

export interface ApplyInitiativeCommandInput {
  readonly command?: unknown
}

export type ApplyInitiativeCommandClock = () => string
export type ApplyInitiativeCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export interface ApplyInitiativeCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplyInitiativeCommandClock
  readonly writeSnapshot?: ApplyInitiativeCommandSnapshotWriter
}

export interface AppliedInitiativeSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedInitiativeSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplyInitiativeAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedInitiativeSessionDetails
  readonly command: InitiativeCommand
  readonly result: InitiativeAcceptedApplication['result']
  readonly patchEvent: InitiativePatchEvent
  readonly eventLogEntry: InitiativeAcceptedApplication['eventLogEntry']
  readonly initiative: InitiativeCurrentState
  readonly previousInitiative: InitiativeCurrentState
  readonly snapshot: AppliedInitiativeSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: InitiativeAcceptedApplication['mapRevisionChanges']
}

export interface ApplyInitiativeRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedInitiativeSessionDetails
  readonly command: InitiativeCommand
  readonly result: InitiativeRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplyInitiativeDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedInitiativeSessionDetails
  readonly command: InitiativeCommand
  readonly result: InitiativeDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplyInitiativeCommandUseCaseResult =
  | ApplyInitiativeAcceptedResult
  | ApplyInitiativeRejectedResult
  | ApplyInitiativeDuplicateResult

type InitiativeSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedInitiativeMap = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
}

const defaultClock: ApplyInitiativeCommandClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const metadataForResult = (
  command: InitiativeCommand,
  processedAt: string,
): SessionCommandResultMetadata => ({
  serverProcessedAt: processedAt,
  ...(command.metadata?.traceId === undefined ? {} : { traceId: command.metadata.traceId }),
})

const issueSummary = (issues: readonly SessionCommandValidationIssue[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const normalizeRound = (round: unknown): number => {
  const value = Math.floor(Number(round ?? 1))
  return Number.isFinite(value) && value > 0 ? value : 1
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

const currentInitiativeState = (
  mapSlug: SessionMapSlug,
  mapState: AuthoritativeSessionMapState<TabletopMapV2>,
  sessionRevision: SessionRevision,
): InitiativeCurrentState => {
  const placementIds = new Set(mapState.document.placements.map((placement) => placement.id))
  const rawActiveId = mapState.document.initiative?.activeId ?? null
  const activeId = rawActiveId && placementIds.has(rawActiveId) ? rawActiveId : null

  return {
    mapSlug,
    initiative: {
      activeId,
      round: normalizeRound(mapState.document.initiative?.round),
      entries: mapState.document.placements.map((placement) => ({
        tokenId: placement.id,
        initiative: normalizePlacementInitiative(placement.initiative),
      })),
    },
    revision: sessionRevision,
    mapRevision: mapState.revision,
  }
}

const initiativeLaneStatesEqual = (left: InitiativeLaneState, right: InitiativeLaneState): boolean => {
  if (left.activeId !== right.activeId || left.round !== right.round) return false
  if (left.entries.length !== right.entries.length) return false
  return left.entries.every((entry, index) => {
    const other = right.entries[index]
    return other !== undefined && entry.tokenId === other.tokenId && entry.initiative === other.initiative
  })
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

const getActiveInitiativeRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<InitiativeCommand, 'sessionId'>,
): InitiativeSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplyInitiativeCommandUseCaseError(
      404,
      'No Track 2 table session was found for the supplied initiative command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplyInitiativeCommandUseCaseError(
      409,
      'The Track 2 table session must be active before initiative commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplyInitiativeCommandUseCaseError(
      500,
      'The Track 2 table session has no authoritative state available for initiative commands',
    )
  }

  return record as InitiativeSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedInitiativeSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: InitiativeCommand,
  record: InitiativeSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<InitiativeCommandType, SessionRevision> => ({
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
  command: InitiativeCommand,
  record: InitiativeSessionRecord,
  permission: PermissionDenied | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  InitiativeCommandType,
  InitiativeCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'The actor is not authorized to manage initiative.',
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
  command: InitiativeCommand,
  record: InitiativeSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly conflictingScopes?: InitiativeCommand['scopes']
    readonly currentState?: InitiativeCurrentState | null
  } = {},
): SessionCommandConflictRejection<
  InitiativeCommandType,
  InitiativeCurrentState | null,
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
  command: InitiativeCommand,
  record: InitiativeSessionRecord,
  message: string,
  processedAt: string,
  currentState: InitiativeCurrentState | null,
  changedScopes: readonly SessionCommandScope[] = command.scopes,
): SessionCommandStaleRejection<
  InitiativeCommandType,
  InitiativeCurrentState | null,
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
  command: InitiativeCommand,
  record: InitiativeSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: InitiativeRejectedResult,
): ApplyInitiativeRejectedResult => ({
  status: 'rejected',
  session: sessionDetailsFor(record),
  command,
  result,
  record,
  state,
})

const mapSlugFromCommand = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  command: InitiativeCommand,
  validationMapSlug: string | undefined,
): SessionMapSlug | undefined => {
  if (validationMapSlug !== undefined) return validationMapSlug
  const payloadMapSlug = command.payload.mapSlug
  if (payloadMapSlug !== undefined) return payloadMapSlug
  const scopedMapSlug = command.scopes.find(
    (scope) => scope.lane === 'initiative' && scope.field === INITIATIVE_COMMAND_SCOPE_FIELD,
  )?.mapSlug
  return scopedMapSlug ?? state.selectedMapSlug ?? undefined
}

const resolveInitiativeMap = (
  command: InitiativeCommand,
  record: InitiativeSessionRecord,
  validationMapSlug: string | undefined,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedInitiativeMap }
  | { readonly ok: false; readonly result: InitiativeRejectedResult } => {
  const mapSlug = mapSlugFromCommand(record.state, command, validationMapSlug)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        'Initiative commands must identify a map or the session must have a selected map.',
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

const scopeTouchesInitiative = (
  scope: SessionCommandScope,
  mapSlug: SessionMapSlug,
): boolean => {
  if (scope.lane !== 'initiative') return false
  if (scope.field !== undefined && scope.field !== INITIATIVE_COMMAND_SCOPE_FIELD) return false
  return scope.mapSlug === undefined || scope.mapSlug === mapSlug
}

const operationTouchesInitiativeTarget = (
  operation: SessionOperationRecord,
  target: ResolvedInitiativeMap,
): boolean => operation.scopes.some((scope) => scopeTouchesInitiative(scope, target.mapSlug))

const staleInitiativeRejection = (
  command: InitiativeCommand,
  record: InitiativeSessionRecord,
  target: ResolvedInitiativeMap,
  processedAt: string,
  tracker: InMemorySessionOperationTracker | false,
): InitiativeRejectedResult | undefined => {
  if (compareSessionRevisions(command.baseRevision, record.revision) !== -1) return undefined

  const currentState = currentInitiativeState(target.mapSlug, target.mapState, record.revision)

  if (tracker === false) {
    return createStaleRejection(
      command,
      record,
      `Initiative may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before changing the turn order.`,
      processedAt,
      currentState,
    )
  }

  const acceptedSinceBase = tracker
    .list(command.sessionId)
    .filter((operation) => acceptedOperationAfterBase(operation, command.baseRevision))

  const matchingInitiativeChange = acceptedSinceBase.find((operation) =>
    operationTouchesInitiativeTarget(operation, target),
  )
  if (matchingInitiativeChange !== undefined) {
    return createStaleRejection(
      command,
      record,
      `Initiative changed after revision ${command.baseRevision}.`,
      processedAt,
      currentState,
      matchingInitiativeChange.scopes,
    )
  }

  const revisionGap = record.revision - command.baseRevision
  if (acceptedSinceBase.length === 0 || revisionGap > tracker.maxRecordsPerSession) {
    return createStaleRejection(
      command,
      record,
      `Initiative may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before changing the turn order.`,
      processedAt,
      currentState,
    )
  }

  return undefined
}

const findPlacement = (
  placements: readonly SheetPlacement[],
  tokenId: string,
): { readonly placement: SheetPlacement; readonly index: number } | undefined => {
  const matches = placements
    .map((placement, index) => ({ placement, index }))
    .filter(({ placement }) => placement.id === tokenId)
  return matches.length === 1 ? matches[0] : undefined
}

const placementCount = (
  placements: readonly SheetPlacement[],
  tokenId: string,
): number => placements.filter((placement) => placement.id === tokenId).length

const initiativeOrder = (placements: readonly SheetPlacement[]): readonly string[] =>
  [...placements]
    .sort((left, right) => {
      const leftInitiative = normalizePlacementInitiative(left.initiative)
      const rightInitiative = normalizePlacementInitiative(right.initiative)
      const leftHasInitiative = leftInitiative !== null
      const rightHasInitiative = rightInitiative !== null
      if (leftHasInitiative !== rightHasInitiative) return leftHasInitiative ? -1 : 1
      if (leftInitiative !== rightInitiative) return (rightInitiative ?? 0) - (leftInitiative ?? 0)
      const leftLabel = `${left.sheetKind}:${left.sheetSlug}:${left.id}`
      const rightLabel = `${right.sheetKind}:${right.sheetSlug}:${right.id}`
      return leftLabel.localeCompare(rightLabel)
    })
    .map((placement) => placement.id)

const mapWithUpdatedAt = (map: TabletopMapV2, processedAt: string): TabletopMapV2 => {
  const updatedAtMs = Date.parse(processedAt)
  return Number.isFinite(updatedAtMs) ? { ...map, updatedAt: updatedAtMs } : { ...map }
}

const applySetInitiativePayload = (
  command: InitiativeCommand,
  payload: SetInitiativeCommandPayload,
  record: InitiativeSessionRecord,
  target: ResolvedInitiativeMap,
  processedAt: string,
):
  | { readonly ok: true; readonly document: TabletopMapV2 }
  | { readonly ok: false; readonly result: InitiativeRejectedResult } => {
  let placements = target.mapState.document.placements.map((placement) => ({ ...placement }))
  let nextInitiativeState: InitiativeTrackerState = {
    activeId: target.mapState.document.initiative?.activeId ?? null,
    round: normalizeRound(target.mapState.document.initiative?.round),
  }

  if (payload.initiative !== undefined) {
    const tokenId = payload.tokenId as string
    const count = placementCount(placements, tokenId)
    if (count !== 1) {
      return {
        ok: false,
        result: createConflictRejection(
          command,
          record,
          count === 0
            ? `Token ${tokenId} is not present on map ${target.mapSlug}.`
            : `Token ${tokenId} has duplicate placements on map ${target.mapSlug}.`,
          processedAt,
          {
            retryable: count === 0,
            currentState: currentInitiativeState(target.mapSlug, target.mapState, record.revision),
          },
        ),
      }
    }

    const found = findPlacement(placements, tokenId)
    if (found === undefined) {
      throw new ApplyInitiativeCommandUseCaseError(
        500,
        'setInitiative target placement count and lookup disagreed',
      )
    }

    placements = placements.map((placement, index) => {
      if (index !== found.index) return placement
      const nextPlacement = { ...placement }
      if (payload.initiative === null) delete nextPlacement.initiative
      else nextPlacement.initiative = payload.initiative
      return nextPlacement
    })
  }

  if (payload.activeId !== undefined) {
    if (payload.activeId !== null && placementCount(placements, payload.activeId) !== 1) {
      return {
        ok: false,
        result: createConflictRejection(
          command,
          record,
          `Active initiative token ${payload.activeId} is not present exactly once on map ${target.mapSlug}.`,
          processedAt,
          {
            retryable: true,
            currentState: currentInitiativeState(target.mapSlug, target.mapState, record.revision),
          },
        ),
      }
    }
    nextInitiativeState = { ...nextInitiativeState, activeId: payload.activeId }
  }

  if (payload.round !== undefined) {
    nextInitiativeState = { ...nextInitiativeState, round: payload.round }
  }

  return {
    ok: true,
    document: mapWithUpdatedAt({
      ...target.mapState.document,
      placements,
      initiative: nextInitiativeState,
    }, processedAt),
  }
}

const applyAdvanceInitiativePayload = (
  command: InitiativeCommand,
  record: InitiativeSessionRecord,
  target: ResolvedInitiativeMap,
  processedAt: string,
):
  | { readonly ok: true; readonly document: TabletopMapV2 }
  | { readonly ok: false; readonly result: InitiativeRejectedResult } => {
  const order = initiativeOrder(target.mapState.document.placements)
  if (order.length === 0) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Map ${target.mapSlug} has no placements in initiative order.`,
        processedAt,
        {
          retryable: true,
          currentState: currentInitiativeState(target.mapSlug, target.mapState, record.revision),
        },
      ),
    }
  }

  const previousState = currentInitiativeState(target.mapSlug, target.mapState, record.revision).initiative
  const ids = [...order]
  const currentIndex = previousState.activeId ? ids.indexOf(previousState.activeId) : -1
  let nextActiveId: string
  let nextRound = previousState.round

  if (command.type === NEXT_INITIATIVE_COMMAND_TYPE) {
    const nextIndex = currentIndex >= 0 && currentIndex < ids.length - 1 ? currentIndex + 1 : 0
    if (currentIndex === ids.length - 1) nextRound += 1
    nextActiveId = ids[nextIndex] as string
  } else {
    const previousIndex = currentIndex > 0 ? currentIndex - 1 : ids.length - 1
    if (currentIndex === 0) nextRound = Math.max(1, nextRound - 1)
    nextActiveId = ids[previousIndex] as string
  }

  return {
    ok: true,
    document: mapWithUpdatedAt({
      ...target.mapState.document,
      initiative: {
        activeId: nextActiveId,
        round: nextRound,
      },
    }, processedAt),
  }
}

const applyInitiativeChange = (
  command: InitiativeCommand,
  record: InitiativeSessionRecord,
  target: ResolvedInitiativeMap,
  processedAt: string,
):
  | { readonly ok: true; readonly document: TabletopMapV2 }
  | { readonly ok: false; readonly result: InitiativeRejectedResult } => {
  if (command.type === SET_INITIATIVE_COMMAND_TYPE) {
    return applySetInitiativePayload(
      command,
      command.payload,
      record,
      target,
      processedAt,
    )
  }

  return applyAdvanceInitiativePayload(command, record, target, processedAt)
}

const rememberRejectedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: InitiativeCommand,
  result: InitiativeRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: InitiativeCommand,
  result: InitiativeAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForInitiative = (commandInput: unknown): InitiativeCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<InitiativeCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (
      envelopeValidation.command.type !== SET_INITIATIVE_COMMAND_TYPE &&
      envelopeValidation.command.type !== NEXT_INITIATIVE_COMMAND_TYPE &&
      envelopeValidation.command.type !== PREVIOUS_INITIATIVE_COMMAND_TYPE
    ) {
      throw new ApplyInitiativeCommandUseCaseError(
        400,
        'applyInitiativeCommandUseCase only handles setInitiative, nextInitiative, and previousInitiative command envelopes',
      )
    }
    return envelopeValidation.command
  }

  throw new ApplyInitiativeCommandUseCaseError(
    400,
    `initiative command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

export const applyInitiativeCommandUseCase = (
  input: ApplyInitiativeCommandInput = {},
  dependencies: ApplyInitiativeCommandDependencies = {},
): ApplyInitiativeCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot

  const envelope = validateEnvelopeForInitiative(input.command)
  const record = getActiveInitiativeRecord(activeStore, envelope)
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
        result: duplicateCheck.result as InitiativeDuplicateResult,
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

  const commandValidation = validateInitiativeCommand(envelope)
  if (!commandValidation.valid) {
    const result = commandValidation.permission?.allowed === false
      ? createUnauthorizedRejection(envelope, record, commandValidation.permission, processedAt)
      : createInvalidRejection(envelope, record, commandValidation.issues, processedAt)

    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const targetResult = resolveInitiativeMap(
    commandValidation.command,
    record,
    commandValidation.mapSlug,
    processedAt,
  )
  if (!targetResult.ok) {
    rememberRejectedResult(tracker, envelope, targetResult.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, targetResult.result)
  }

  const staleRejection = staleInitiativeRejection(
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

  const previousInitiative = currentInitiativeState(
    targetResult.target.mapSlug,
    targetResult.target.mapState,
    record.revision,
  )
  const change = applyInitiativeChange(
    commandValidation.command,
    record,
    targetResult.target,
    processedAt,
  )
  if (!change.ok) {
    rememberRejectedResult(tracker, envelope, change.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, change.result)
  }

  const previewMapState = {
    ...targetResult.target.mapState,
    document: change.document,
  }
  const currentPreview = currentInitiativeState(
    targetResult.target.mapSlug,
    previewMapState,
    record.revision,
  )
  if (initiativeLaneStatesEqual(previousInitiative.initiative, currentPreview.initiative)) {
    const result = createConflictRejection(
      commandValidation.command,
      record,
      'The requested initiative change is already reflected in authoritative state.',
      processedAt,
      { retryable: false, currentState: previousInitiative },
    )
    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const applied = applyAcceptedSessionCommandEffect({
    state: record.state,
    command: commandValidation.command,
    eventType: INITIATIVE_PATCH_EVENT_TYPE,
    eventPayload: {
      mapSlug: targetResult.target.mapSlug,
      command: commandValidation.command.type,
      previous: cloneLaneState(previousInitiative.initiative),
      current: cloneLaneState(currentPreview.initiative),
      changedTokenIds: changedTokenIdsBetween(previousInitiative.initiative, currentPreview.initiative),
    },
    mapEffects: [
      {
        mapSlug: targetResult.target.mapSlug,
        document: change.document,
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
    throw new ApplyInitiativeCommandUseCaseError(
      409,
      'The Track 2 table session ended before initiative could apply',
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
    throw new ApplyInitiativeCommandUseCaseError(
      500,
      `Failed to write initiative session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  const currentMapState = getSessionMapState(applied.state, targetResult.target.mapSlug)
  if (currentMapState === undefined) {
    throw new ApplyInitiativeCommandUseCaseError(
      500,
      'initiative applied but the target map could not be found in next authoritative state',
    )
  }

  return {
    status: 'accepted',
    session: sessionDetailsFor(updatedRecord),
    command: commandValidation.command,
    result: applied.result,
    patchEvent: applied.patchEvent,
    eventLogEntry: applied.eventLogEntry,
    previousInitiative,
    initiative: currentInitiativeState(
      targetResult.target.mapSlug,
      currentMapState,
      applied.currentRevision,
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
