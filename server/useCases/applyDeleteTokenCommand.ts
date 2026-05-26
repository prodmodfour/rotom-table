import {
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  type SessionCommandConflictRejection,
  type SessionCommandDuplicateResult,
  type SessionCommandInvalidRejection,
  type SessionCommandRejectedResult,
  type SessionCommandResultMetadata,
  type SessionCommandUnauthorizedRejection,
  type SessionCommandValidationIssue,
} from '#shared/sessionCommandResults'
import { validateSessionCommandEnvelope } from '#shared/sessionCommandValidation'
import type { SessionId } from '#shared/sessionIdentity'
import type { PermissionDenied, SessionTokenResourceRef } from '#shared/sessionPermissions'
import type { MapRevision, SessionRevision } from '#shared/sessionRevisions'
import {
  getSessionMapState,
  type AuthoritativeSessionMapState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import {
  DELETE_TOKEN_COMMAND_TYPE,
  validateDeleteTokenCommand,
  type DeleteTokenCommand,
  type DeleteTokenCommandPayload,
  type MoveTokenPosition,
} from '#shared/sessionTokenCommands'
import type { SheetPlacement, TabletopMapV2 } from '~/types/map'
import { assertSessionHostEnabled, type SessionHostRuntimeEnv } from '../utils/sessionHosting'
import {
  sessionOperationTracker,
  type InMemorySessionOperationTracker,
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

export class ApplyDeleteTokenCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const DELETE_TOKEN_PATCH_EVENT_TYPE = 'tokenDeleted' as const

export interface DeleteTokenCurrentState {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly placement: SheetPlacement
  readonly position: MoveTokenPosition
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
  readonly sheetKind: SheetPlacement['sheetKind']
  readonly sheetSlug: string
}

export interface DeleteTokenPatchPayload {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly placement: SheetPlacement
  readonly sheetKind: SheetPlacement['sheetKind']
  readonly sheetSlug: string
  readonly position: MoveTokenPosition
  readonly clearedActiveInitiative: boolean
}

export type DeleteTokenPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof DELETE_TOKEN_PATCH_EVENT_TYPE,
  DeleteTokenPatchPayload
>

export type DeleteTokenAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  typeof DELETE_TOKEN_COMMAND_TYPE,
  DeleteTokenCommandPayload,
  TabletopMapV2,
  typeof DELETE_TOKEN_PATCH_EVENT_TYPE,
  DeleteTokenPatchPayload
>

export type DeleteTokenRejectedResult = SessionCommandRejectedResult<
  typeof DELETE_TOKEN_COMMAND_TYPE,
  DeleteTokenCurrentState | null,
  SessionRevision
>

export type DeleteTokenDuplicateResult = SessionCommandDuplicateResult<
  typeof DELETE_TOKEN_COMMAND_TYPE,
  SessionRevision
>

export interface ApplyDeleteTokenCommandInput {
  readonly command?: unknown
}

export type ApplyDeleteTokenCommandClock = () => string
export type ApplyDeleteTokenCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export interface ApplyDeleteTokenCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplyDeleteTokenCommandClock
  readonly writeSnapshot?: ApplyDeleteTokenCommandSnapshotWriter
}

export interface AppliedDeleteTokenSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedDeleteTokenSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplyDeleteTokenAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedDeleteTokenSessionDetails
  readonly command: DeleteTokenCommand
  readonly result: DeleteTokenAcceptedApplication['result']
  readonly patchEvent: DeleteTokenPatchEvent
  readonly eventLogEntry: DeleteTokenAcceptedApplication['eventLogEntry']
  readonly token: DeleteTokenCurrentState
  readonly snapshot: AppliedDeleteTokenSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: DeleteTokenAcceptedApplication['mapRevisionChanges']
}

export interface ApplyDeleteTokenRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedDeleteTokenSessionDetails
  readonly command: DeleteTokenCommand
  readonly result: DeleteTokenRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplyDeleteTokenDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedDeleteTokenSessionDetails
  readonly command: DeleteTokenCommand
  readonly result: DeleteTokenDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplyDeleteTokenCommandUseCaseResult =
  | ApplyDeleteTokenAcceptedResult
  | ApplyDeleteTokenRejectedResult
  | ApplyDeleteTokenDuplicateResult

type DeleteTokenSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedDeleteTokenTarget = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
  readonly placement: SheetPlacement
  readonly placementIndex: number
}

const defaultClock: ApplyDeleteTokenCommandClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const clonePosition = (position: MoveTokenPosition): MoveTokenPosition => ({
  x: position.x,
  y: position.y,
  z: position.z,
})

const clonePlacement = (placement: SheetPlacement): SheetPlacement => ({
  ...placement,
  position: clonePosition(placement.position),
})

const metadataForResult = (
  command: DeleteTokenCommand,
  processedAt: string,
): SessionCommandResultMetadata => ({
  serverProcessedAt: processedAt,
  ...(command.metadata?.traceId === undefined ? {} : { traceId: command.metadata.traceId }),
})

const issueSummary = (issues: readonly SessionCommandValidationIssue[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const tokenStateFromPlacement = (
  mapSlug: SessionMapSlug,
  mapRevision: MapRevision,
  sessionRevision: SessionRevision,
  placement: SheetPlacement,
): DeleteTokenCurrentState => ({
  tokenId: placement.id,
  mapSlug,
  placement: clonePlacement(placement),
  position: clonePosition(placement.position),
  revision: sessionRevision,
  mapRevision,
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
})

const getActiveDeleteTokenRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<DeleteTokenCommand, 'sessionId'>,
): DeleteTokenSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplyDeleteTokenCommandUseCaseError(
      404,
      'No Track 2 table session was found for the supplied deleteToken command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplyDeleteTokenCommandUseCaseError(
      409,
      'The Track 2 table session must be active before deleteToken commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplyDeleteTokenCommandUseCaseError(
      500,
      'The Track 2 table session has no authoritative state available for deleteToken commands',
    )
  }

  return record as DeleteTokenSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedDeleteTokenSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: DeleteTokenCommand,
  record: DeleteTokenSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<typeof DELETE_TOKEN_COMMAND_TYPE, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'invalid',
  message: issueSummary(issues) || 'deleteToken command is invalid.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: DELETE_TOKEN_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  issues,
  metadata: metadataForResult(command, processedAt),
})

const createUnauthorizedRejection = (
  command: DeleteTokenCommand,
  record: DeleteTokenSessionRecord,
  permission: PermissionDenied | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  typeof DELETE_TOKEN_COMMAND_TYPE,
  DeleteTokenCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'Only the GM can delete tokens in a Track 2 table session.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: DELETE_TOKEN_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  ...(permission === undefined ? {} : { permission }),
  metadata: metadataForResult(command, processedAt),
})

const createConflictRejection = (
  command: DeleteTokenCommand,
  record: DeleteTokenSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly currentState?: DeleteTokenCurrentState | null
  } = {},
): SessionCommandConflictRejection<
  typeof DELETE_TOKEN_COMMAND_TYPE,
  DeleteTokenCurrentState | null,
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
  commandType: DELETE_TOKEN_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  conflictingScopes: command.scopes,
  ...(options.currentState === undefined ? {} : { currentState: options.currentState }),
  metadata: metadataForResult(command, processedAt),
})

const rejectionOutcome = (
  command: DeleteTokenCommand,
  record: DeleteTokenSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: DeleteTokenRejectedResult,
): ApplyDeleteTokenRejectedResult => ({
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

const placementMatchesResource = (
  placement: SheetPlacement,
  resource: SessionTokenResourceRef,
): boolean => {
  if (resource.sheetKind !== undefined && placement.sheetKind !== resource.sheetKind) return false
  if (resource.sheetSlug !== undefined && placement.sheetSlug !== resource.sheetSlug) return false
  return true
}

const findTokenPlacements = (
  mapState: AuthoritativeSessionMapState<TabletopMapV2>,
  tokenId: string,
): ReadonlyArray<{ readonly placement: SheetPlacement; readonly index: number }> =>
  mapState.document.placements
    .map((placement, index) => ({ placement, index }))
    .filter(({ placement }) => placement.id === tokenId)

const resolveDeleteTokenTarget = (
  command: DeleteTokenCommand,
  record: DeleteTokenSessionRecord,
  resource: SessionTokenResourceRef,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedDeleteTokenTarget }
  | { readonly ok: false; readonly result: DeleteTokenRejectedResult } => {
  const mapSlug = resolveMapSlug(record.state, resource)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        'deleteToken commands must identify a map or the session must have a selected map.',
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

  const matches = findTokenPlacements(mapState, command.payload.tokenId)
  if (matches.length !== 1) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        matches.length === 0
          ? `Token ${command.payload.tokenId} is not present on map ${mapSlug}.`
          : `Token ${command.payload.tokenId} has duplicate placements on map ${mapSlug}.`,
        processedAt,
        { retryable: matches.length === 0, currentState: null },
      ),
    }
  }

  const found = matches[0]
  if (!placementMatchesResource(found.placement, resource)) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Token ${command.payload.tokenId} does not match the requested sheet resource identity.`,
        processedAt,
        {
          retryable: false,
          currentState: tokenStateFromPlacement(
            mapSlug,
            mapState.revision,
            record.revision,
            found.placement,
          ),
        },
      ),
    }
  }

  return {
    ok: true,
    target: {
      mapSlug,
      mapState,
      placement: found.placement,
      placementIndex: found.index,
    },
  }
}

const deletedMapDocument = (
  map: TabletopMapV2,
  target: ResolvedDeleteTokenTarget,
  processedAt: string,
): TabletopMapV2 => {
  const updatedAtMs = Date.parse(processedAt)
  const nextInitiative = map.initiative?.activeId === target.placement.id
    ? { ...map.initiative, activeId: null }
    : map.initiative

  return {
    ...map,
    placements: map.placements.filter((_, index) => index !== target.placementIndex),
    ...(nextInitiative === undefined ? {} : { initiative: nextInitiative }),
    ...(Number.isFinite(updatedAtMs) ? { updatedAt: updatedAtMs } : {}),
  }
}

const rememberRejectedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: DeleteTokenCommand,
  result: DeleteTokenRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: DeleteTokenCommand,
  result: DeleteTokenAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForDeleteToken = (commandInput: unknown): DeleteTokenCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<DeleteTokenCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (envelopeValidation.command.type !== DELETE_TOKEN_COMMAND_TYPE) {
      throw new ApplyDeleteTokenCommandUseCaseError(
        400,
        'applyDeleteTokenCommandUseCase only handles deleteToken command envelopes',
      )
    }
    return envelopeValidation.command
  }

  throw new ApplyDeleteTokenCommandUseCaseError(
    400,
    `deleteToken command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

export const applyDeleteTokenCommandUseCase = (
  input: ApplyDeleteTokenCommandInput = {},
  dependencies: ApplyDeleteTokenCommandDependencies = {},
): ApplyDeleteTokenCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot

  const envelope = validateEnvelopeForDeleteToken(input.command)
  const record = getActiveDeleteTokenRecord(activeStore, envelope)
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
        result: duplicateCheck.result as DeleteTokenDuplicateResult,
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

  const commandValidation = validateDeleteTokenCommand(envelope)

  if (!commandValidation.valid) {
    const result = commandValidation.permission?.allowed === false
      ? createUnauthorizedRejection(envelope, record, commandValidation.permission, processedAt)
      : createInvalidRejection(envelope, record, commandValidation.issues, processedAt)

    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const targetResult = resolveDeleteTokenTarget(
    commandValidation.command,
    record,
    commandValidation.resource,
    processedAt,
  )
  if (!targetResult.ok) {
    rememberRejectedResult(tracker, envelope, targetResult.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, targetResult.result)
  }

  const previousToken = tokenStateFromPlacement(
    targetResult.target.mapSlug,
    targetResult.target.mapState.revision,
    record.revision,
    targetResult.target.placement,
  )
  const nextDocument = deletedMapDocument(
    targetResult.target.mapState.document,
    targetResult.target,
    processedAt,
  )
  const clearedActiveInitiative = targetResult.target.mapState.document.initiative?.activeId === targetResult.target.placement.id
  const applied = applyAcceptedSessionCommandEffect({
    state: record.state,
    command: commandValidation.command,
    eventType: DELETE_TOKEN_PATCH_EVENT_TYPE,
    eventPayload: {
      tokenId: targetResult.target.placement.id,
      mapSlug: targetResult.target.mapSlug,
      placement: clonePlacement(targetResult.target.placement),
      sheetKind: targetResult.target.placement.sheetKind,
      sheetSlug: targetResult.target.placement.sheetSlug,
      position: clonePosition(targetResult.target.placement.position),
      clearedActiveInitiative,
    },
    mapEffects: [
      {
        mapSlug: targetResult.target.mapSlug,
        document: nextDocument,
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
    throw new ApplyDeleteTokenCommandUseCaseError(
      409,
      'The Track 2 table session ended before deleteToken could apply',
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
    throw new ApplyDeleteTokenCommandUseCaseError(
      500,
      `Failed to write deleteToken session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  return {
    status: 'accepted',
    session: sessionDetailsFor(updatedRecord),
    command: commandValidation.command,
    result: applied.result,
    patchEvent: applied.patchEvent,
    eventLogEntry: applied.eventLogEntry,
    token: previousToken,
    snapshot: {
      writtenAt: snapshot.snapshot.writtenAt,
      revision: snapshot.snapshot.revision,
    },
    record: updatedRecord,
    state: applied.state,
    mapRevisionChanges: applied.mapRevisionChanges,
  }
}
