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
  TURN_TOKEN_COMMAND_TYPE,
  TURN_TOKEN_COMMAND_SCOPE_FIELD,
  validateTurnTokenCommand,
  type SessionTokenFacingDirection,
  type TurnTokenCommand,
  type TurnTokenCommandPayload,
} from '#shared/sessionTokenCommands'
import type { GridAnchor, SheetPlacement, TabletopMapV2 } from '~/types/map'
import {
  setTokenFacingOnPlacement,
  tokenFacingForPlacement,
  tokenFacingStoresLegacyTurned,
} from '~/utils/tokenFacing'
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

export class ApplyTurnTokenCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const TURN_TOKEN_PATCH_EVENT_TYPE = 'tokenTurned' as const

export interface TurnTokenCurrentState {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly position: GridAnchor
  readonly facing: SessionTokenFacingDirection
  readonly turned: boolean
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
  readonly sheetKind?: SheetPlacement['sheetKind']
  readonly sheetSlug?: string
}

export interface TurnTokenPatchPayload {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly from: SessionTokenFacingDirection
  readonly to: SessionTokenFacingDirection
  readonly turned: boolean
  readonly sheetKind?: SheetPlacement['sheetKind']
  readonly sheetSlug?: string
}

export type TurnTokenPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof TURN_TOKEN_PATCH_EVENT_TYPE,
  TurnTokenPatchPayload
>

export type TurnTokenAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  typeof TURN_TOKEN_COMMAND_TYPE,
  TurnTokenCommandPayload,
  TabletopMapV2,
  typeof TURN_TOKEN_PATCH_EVENT_TYPE,
  TurnTokenPatchPayload
>

export type TurnTokenRejectedResult = SessionCommandRejectedResult<
  typeof TURN_TOKEN_COMMAND_TYPE,
  TurnTokenCurrentState | null,
  SessionRevision
>

export type TurnTokenDuplicateResult = SessionCommandDuplicateResult<
  typeof TURN_TOKEN_COMMAND_TYPE,
  SessionRevision
>

export interface ApplyTurnTokenCommandInput {
  readonly command?: unknown
}

export type ApplyTurnTokenCommandClock = () => string
export type ApplyTurnTokenCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export interface ApplyTurnTokenCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplyTurnTokenCommandClock
  readonly writeSnapshot?: ApplyTurnTokenCommandSnapshotWriter
}

export interface AppliedTurnTokenSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedTurnTokenSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplyTurnTokenAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedTurnTokenSessionDetails
  readonly command: TurnTokenCommand
  readonly result: TurnTokenAcceptedApplication['result']
  readonly patchEvent: TurnTokenPatchEvent
  readonly eventLogEntry: TurnTokenAcceptedApplication['eventLogEntry']
  readonly token: TurnTokenCurrentState
  readonly previousToken: TurnTokenCurrentState
  readonly snapshot: AppliedTurnTokenSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: TurnTokenAcceptedApplication['mapRevisionChanges']
}

export interface ApplyTurnTokenRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedTurnTokenSessionDetails
  readonly command: TurnTokenCommand
  readonly result: TurnTokenRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplyTurnTokenDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedTurnTokenSessionDetails
  readonly command: TurnTokenCommand
  readonly result: TurnTokenDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplyTurnTokenCommandUseCaseResult =
  | ApplyTurnTokenAcceptedResult
  | ApplyTurnTokenRejectedResult
  | ApplyTurnTokenDuplicateResult

type TurnTokenSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedTurnTokenTarget = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
  readonly placement: SheetPlacement
  readonly placementIndex: number
  readonly resource: SessionTokenResourceRef
}

const defaultClock: ApplyTurnTokenCommandClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const clonePosition = (position: GridAnchor): GridAnchor => ({
  x: position.x,
  y: position.y,
  z: position.z,
})

const metadataForResult = (
  command: TurnTokenCommand,
  processedAt: string,
): SessionCommandResultMetadata => ({
  serverProcessedAt: processedAt,
  ...(command.metadata?.traceId === undefined ? {} : { traceId: command.metadata.traceId }),
})

const issueSummary = (issues: readonly SessionCommandValidationIssue[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const cloneResource = (resource: SessionTokenResourceRef): SessionTokenResourceRef => ({
  ...resource,
})

const tokenStateFromPlacement = (
  mapSlug: SessionMapSlug,
  mapRevision: MapRevision,
  sessionRevision: SessionRevision,
  placement: SheetPlacement,
): TurnTokenCurrentState => {
  const facing = tokenFacingForPlacement(placement)
  return {
    tokenId: placement.id,
    mapSlug,
    position: clonePosition(placement.position),
    facing,
    turned: tokenFacingStoresLegacyTurned(facing),
    revision: sessionRevision,
    mapRevision,
    sheetKind: placement.sheetKind,
    sheetSlug: placement.sheetSlug,
  }
}

const getActiveTurnTokenRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<TurnTokenCommand, 'sessionId'>,
): TurnTokenSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplyTurnTokenCommandUseCaseError(
      404,
      'No live session was found for the supplied turnToken command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplyTurnTokenCommandUseCaseError(
      409,
      'The live session must be active before turnToken commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplyTurnTokenCommandUseCaseError(
      500,
      'The live session has no authoritative state available for turnToken commands',
    )
  }

  return record as TurnTokenSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedTurnTokenSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: TurnTokenCommand,
  record: TurnTokenSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<typeof TURN_TOKEN_COMMAND_TYPE, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'invalid',
  message: issueSummary(issues) || 'turnToken command is invalid.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: TURN_TOKEN_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  issues,
  metadata: metadataForResult(command, processedAt),
})

const createUnauthorizedRejection = (
  command: TurnTokenCommand,
  record: TurnTokenSessionRecord,
  permission: PermissionDenied | undefined,
  resource: SessionTokenResourceRef | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  typeof TURN_TOKEN_COMMAND_TYPE,
  TurnTokenCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'The actor is not authorized to turn this token.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: TURN_TOKEN_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  ...(permission === undefined ? {} : { permission }),
  ...(resource === undefined ? {} : { resource: cloneResource(resource) }),
  metadata: metadataForResult(command, processedAt),
})

const createConflictRejection = (
  command: TurnTokenCommand,
  record: TurnTokenSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly conflictingScopes?: TurnTokenCommand['scopes']
    readonly currentState?: TurnTokenCurrentState | null
  } = {},
): SessionCommandConflictRejection<
  typeof TURN_TOKEN_COMMAND_TYPE,
  TurnTokenCurrentState | null,
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
  commandType: TURN_TOKEN_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  conflictingScopes: options.conflictingScopes ?? command.scopes,
  ...(options.currentState === undefined ? {} : { currentState: options.currentState }),
  metadata: metadataForResult(command, processedAt),
})

const createStaleRejection = (
  command: TurnTokenCommand,
  record: TurnTokenSessionRecord,
  message: string,
  processedAt: string,
  currentState: TurnTokenCurrentState | null,
  changedScopes: readonly SessionCommandScope[] = command.scopes,
): SessionCommandStaleRejection<
  typeof TURN_TOKEN_COMMAND_TYPE,
  TurnTokenCurrentState | null,
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
  commandType: TURN_TOKEN_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  baseRevision: command.baseRevision,
  changedScopes,
  currentState,
  metadata: metadataForResult(command, processedAt),
})

const rejectionOutcome = (
  command: TurnTokenCommand,
  record: TurnTokenSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: TurnTokenRejectedResult,
): ApplyTurnTokenRejectedResult => ({
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
): { readonly placement: SheetPlacement; readonly index: number } | undefined => {
  const matches = mapState.document.placements
    .map((placement, index) => ({ placement, index }))
    .filter(({ placement }) => placement.id === tokenId)

  return matches.length === 1 ? matches[0] : undefined
}

const countTokenPlacements = (
  mapState: AuthoritativeSessionMapState<TabletopMapV2>,
  tokenId: string,
): number => mapState.document.placements.filter((placement) => placement.id === tokenId).length

const placementMatchesResource = (
  placement: SheetPlacement,
  resource: SessionTokenResourceRef,
): boolean => {
  if (resource.sheetKind !== undefined && placement.sheetKind !== resource.sheetKind) return false
  if (resource.sheetSlug !== undefined && placement.sheetSlug !== resource.sheetSlug) return false
  return true
}

const resolveTurnTokenTarget = (
  command: TurnTokenCommand,
  record: TurnTokenSessionRecord,
  resource: SessionTokenResourceRef,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedTurnTokenTarget }
  | { readonly ok: false; readonly result: TurnTokenRejectedResult } => {
  const mapSlug = resolveMapSlug(record.state, resource)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        'turnToken commands must identify a map or the session must have a selected map.',
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

  const found = findTokenPlacement(mapState, command.payload.tokenId)
  if (found === undefined) {
    throw new ApplyTurnTokenCommandUseCaseError(
      500,
      'turnToken target placement count and lookup disagreed',
    )
  }

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
      resource,
    },
  }
}

const acceptedOperationAfterBase = (
  operation: SessionOperationRecord,
  baseRevision: SessionRevision,
): boolean => operation.result.status === 'accepted' &&
  compareSessionRevisions(baseRevision, operation.result.currentRevision) === -1

const scopeTouchesTokenFacing = (
  scope: SessionCommandScope,
  tokenId: string,
  mapSlug: SessionMapSlug,
): boolean => {
  const resource = scope.resource
  if (scope.lane !== 'token') return false
  if (scope.field !== TURN_TOKEN_COMMAND_SCOPE_FIELD) return false
  if (resource?.kind !== 'token') return false
  if (resource.tokenId !== tokenId) return false

  const scopedMapSlug = resource.mapSlug ?? scope.mapSlug
  return scopedMapSlug === undefined || scopedMapSlug === mapSlug
}

const operationTouchesTurnTokenTarget = (
  operation: SessionOperationRecord,
  target: ResolvedTurnTokenTarget,
): boolean => operation.commandType === TURN_TOKEN_COMMAND_TYPE &&
  operation.scopes.some((scope) => scopeTouchesTokenFacing(
    scope,
    target.placement.id,
    target.mapSlug,
  ))

const staleTurnTokenRejection = (
  command: TurnTokenCommand,
  record: TurnTokenSessionRecord,
  target: ResolvedTurnTokenTarget,
  processedAt: string,
  tracker: InMemorySessionOperationTracker | false,
): TurnTokenRejectedResult | undefined => {
  if (compareSessionRevisions(command.baseRevision, record.revision) !== -1) return undefined

  const currentToken = tokenStateFromPlacement(
    target.mapSlug,
    target.mapState.revision,
    record.revision,
    target.placement,
  )

  if (tracker === false) {
    return createStaleRejection(
      command,
      record,
      `Token ${command.payload.tokenId} facing may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before turning it again.`,
      processedAt,
      currentToken,
    )
  }

  const acceptedSinceBase = tracker
    .list(command.sessionId)
    .filter((operation) => acceptedOperationAfterBase(operation, command.baseRevision))

  const matchingTokenChange = acceptedSinceBase.find((operation) =>
    operationTouchesTurnTokenTarget(operation, target),
  )
  if (matchingTokenChange !== undefined) {
    return createStaleRejection(
      command,
      record,
      `Token ${command.payload.tokenId} facing changed after revision ${command.baseRevision}.`,
      processedAt,
      currentToken,
      matchingTokenChange.scopes,
    )
  }

  const revisionGap = record.revision - command.baseRevision
  if (acceptedSinceBase.length === 0 || revisionGap > tracker.maxRecordsPerSession) {
    return createStaleRejection(
      command,
      record,
      `Token ${command.payload.tokenId} facing may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before turning it again.`,
      processedAt,
      currentToken,
    )
  }

  return undefined
}

const validateTurnDestination = (
  command: TurnTokenCommand,
  record: TurnTokenSessionRecord,
  target: ResolvedTurnTokenTarget,
  processedAt: string,
): TurnTokenRejectedResult | undefined => {
  const currentToken = tokenStateFromPlacement(
    target.mapSlug,
    target.mapState.revision,
    record.revision,
    target.placement,
  )

  if (currentToken.facing === command.payload.facing) {
    return createConflictRejection(
      command,
      record,
      `Token ${command.payload.tokenId} is already facing ${command.payload.facing}.`,
      processedAt,
      { retryable: false, currentState: currentToken },
    )
  }

  return undefined
}

const turnedMapDocument = (
  map: TabletopMapV2,
  placementIndex: number,
  facing: SessionTokenFacingDirection,
  processedAt: string,
): TabletopMapV2 => {
  const updatedAtMs = Date.parse(processedAt)
  const placements = map.placements.map((placement, index) => {
    if (index !== placementIndex) return placement
    const nextPlacement: SheetPlacement = { ...placement }
    setTokenFacingOnPlacement(nextPlacement, facing)
    return nextPlacement
  })

  return {
    ...map,
    placements,
    ...(Number.isFinite(updatedAtMs) ? { updatedAt: updatedAtMs } : {}),
  }
}

const rememberRejectedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: TurnTokenCommand,
  result: TurnTokenRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: TurnTokenCommand,
  result: TurnTokenAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForTurnToken = (commandInput: unknown): TurnTokenCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<TurnTokenCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (envelopeValidation.command.type !== TURN_TOKEN_COMMAND_TYPE) {
      throw new ApplyTurnTokenCommandUseCaseError(
        400,
        'applyTurnTokenCommandUseCase only handles turnToken command envelopes',
      )
    }
    return envelopeValidation.command
  }

  throw new ApplyTurnTokenCommandUseCaseError(
    400,
    `turnToken command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

export const applyTurnTokenCommandUseCase = (
  input: ApplyTurnTokenCommandInput = {},
  dependencies: ApplyTurnTokenCommandDependencies = {},
): ApplyTurnTokenCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot

  const envelope = validateEnvelopeForTurnToken(input.command)
  const record = getActiveTurnTokenRecord(activeStore, envelope)
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
        result: duplicateCheck.result as TurnTokenDuplicateResult,
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

  const commandValidation = validateTurnTokenCommand(envelope, {
    assignments: record.state.assignments,
  })

  if (!commandValidation.valid) {
    const result = commandValidation.permission?.allowed === false
      ? createUnauthorizedRejection(
        envelope,
        record,
        commandValidation.permission,
        commandValidation.permission.resource?.kind === 'token'
          ? commandValidation.permission.resource
          : undefined,
        processedAt,
      )
      : createInvalidRejection(envelope, record, commandValidation.issues, processedAt)

    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const targetResult = resolveTurnTokenTarget(
    commandValidation.command,
    record,
    commandValidation.resource,
    processedAt,
  )
  if (!targetResult.ok) {
    rememberRejectedResult(tracker, envelope, targetResult.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, targetResult.result)
  }

  const staleRejection = staleTurnTokenRejection(
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

  const destinationRejection = validateTurnDestination(
    commandValidation.command,
    record,
    targetResult.target,
    processedAt,
  )
  if (destinationRejection !== undefined) {
    rememberRejectedResult(tracker, envelope, destinationRejection, processedAt)
    return rejectionOutcome(envelope, record, record.state, destinationRejection)
  }

  const previousToken = tokenStateFromPlacement(
    targetResult.target.mapSlug,
    targetResult.target.mapState.revision,
    record.revision,
    targetResult.target.placement,
  )
  const nextDocument = turnedMapDocument(
    targetResult.target.mapState.document,
    targetResult.target.placementIndex,
    commandValidation.payload.facing,
    processedAt,
  )
  const applied = applyAcceptedSessionCommandEffect({
    state: record.state,
    command: commandValidation.command,
    eventType: TURN_TOKEN_PATCH_EVENT_TYPE,
    eventPayload: {
      tokenId: commandValidation.payload.tokenId,
      mapSlug: targetResult.target.mapSlug,
      from: previousToken.facing,
      to: commandValidation.payload.facing,
      turned: tokenFacingStoresLegacyTurned(commandValidation.payload.facing),
      sheetKind: targetResult.target.placement.sheetKind,
      sheetSlug: targetResult.target.placement.sheetSlug,
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
    throw new ApplyTurnTokenCommandUseCaseError(
      409,
      'The live session ended before turnToken could apply',
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
    throw new ApplyTurnTokenCommandUseCaseError(
      500,
      `Failed to write turnToken session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  const currentMapState = getSessionMapState(applied.state, targetResult.target.mapSlug)
  const currentPlacement = currentMapState?.document.placements.find(
    (placement) => placement.id === commandValidation.payload.tokenId,
  )
  if (currentMapState === undefined || currentPlacement === undefined) {
    throw new ApplyTurnTokenCommandUseCaseError(
      500,
      'turnToken applied but the turned token could not be found in next authoritative state',
    )
  }

  return {
    status: 'accepted',
    session: sessionDetailsFor(updatedRecord),
    command: commandValidation.command,
    result: applied.result,
    patchEvent: applied.patchEvent,
    eventLogEntry: applied.eventLogEntry,
    previousToken,
    token: tokenStateFromPlacement(
      targetResult.target.mapSlug,
      currentMapState.revision,
      applied.currentRevision,
      currentPlacement,
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
