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
import {
  type SessionId,
} from '#shared/sessionIdentity'
import type {
  PermissionDenied,
  SessionTokenResourceRef,
} from '#shared/sessionPermissions'
import type { MapRevision, SessionRevision } from '#shared/sessionRevisions'
import {
  getSessionMapState,
  type AuthoritativeSessionMapState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import {
  MOVE_TOKEN_COMMAND_TYPE,
  validateMoveTokenCommand,
  type MoveTokenCommand,
  type MoveTokenCommandPayload,
  type MoveTokenPosition,
} from '#shared/sessionTokenCommands'
import type { GridAnchor, SheetPlacement, TabletopMapV2 } from '~/types/map'
import { canPlacePokemon } from '~/utils/gridPlacement'
import type { GridFootprint, PositionedGridFootprint } from '~/utils/gridGeometry'
import { buildVoxelOccupancy } from '~/utils/voxelOccupancy'
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

export class ApplyMoveTokenCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const MOVE_TOKEN_PATCH_EVENT_TYPE = 'tokenMoved' as const

export interface MoveTokenCurrentState {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly position: MoveTokenPosition
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
  readonly sheetKind?: SheetPlacement['sheetKind']
  readonly sheetSlug?: string
}

export interface MoveTokenPatchPayload {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly from: MoveTokenPosition
  readonly to: MoveTokenPosition
  readonly sheetKind?: SheetPlacement['sheetKind']
  readonly sheetSlug?: string
}

export type MoveTokenPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof MOVE_TOKEN_PATCH_EVENT_TYPE,
  MoveTokenPatchPayload
>

export type MoveTokenAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  typeof MOVE_TOKEN_COMMAND_TYPE,
  MoveTokenCommandPayload,
  TabletopMapV2,
  typeof MOVE_TOKEN_PATCH_EVENT_TYPE,
  MoveTokenPatchPayload
>

export type MoveTokenRejectedResult = SessionCommandRejectedResult<
  typeof MOVE_TOKEN_COMMAND_TYPE,
  MoveTokenCurrentState | null,
  SessionRevision
>

export type MoveTokenDuplicateResult = SessionCommandDuplicateResult<
  typeof MOVE_TOKEN_COMMAND_TYPE,
  SessionRevision
>

export interface ApplyMoveTokenCommandInput {
  readonly command?: unknown
}

export type ApplyMoveTokenCommandClock = () => string
export type ApplyMoveTokenCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export type MoveTokenFootprintResolver = (input: {
  readonly placement: SheetPlacement
  readonly map: TabletopMapV2
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}) => GridFootprint

export interface ApplyMoveTokenCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplyMoveTokenCommandClock
  readonly writeSnapshot?: ApplyMoveTokenCommandSnapshotWriter
  readonly resolveFootprint?: MoveTokenFootprintResolver
}

export interface AppliedMoveTokenSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedMoveTokenSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplyMoveTokenAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedMoveTokenSessionDetails
  readonly command: MoveTokenCommand
  readonly result: MoveTokenAcceptedApplication['result']
  readonly patchEvent: MoveTokenPatchEvent
  readonly eventLogEntry: MoveTokenAcceptedApplication['eventLogEntry']
  readonly token: MoveTokenCurrentState
  readonly previousToken: MoveTokenCurrentState
  readonly snapshot: AppliedMoveTokenSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: MoveTokenAcceptedApplication['mapRevisionChanges']
}

export interface ApplyMoveTokenRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedMoveTokenSessionDetails
  readonly command: MoveTokenCommand
  readonly result: MoveTokenRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplyMoveTokenDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedMoveTokenSessionDetails
  readonly command: MoveTokenCommand
  readonly result: MoveTokenDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplyMoveTokenCommandUseCaseResult =
  | ApplyMoveTokenAcceptedResult
  | ApplyMoveTokenRejectedResult
  | ApplyMoveTokenDuplicateResult

type MoveTokenSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedMoveTokenTarget = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
  readonly placement: SheetPlacement
  readonly placementIndex: number
  readonly resource: SessionTokenResourceRef
}

const defaultClock: ApplyMoveTokenCommandClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const clonePosition = (position: GridAnchor): MoveTokenPosition => ({
  x: position.x,
  y: position.y,
  z: position.z,
})

const positionsEqual = (left: GridAnchor, right: GridAnchor): boolean =>
  left.x === right.x && left.y === right.y && left.z === right.z

const metadataForResult = (
  command: MoveTokenCommand,
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

const defaultResolveTokenFootprint: MoveTokenFootprintResolver = ({ placement }) => ({
  id: placement.id,
  base: 1,
  clearance: 1,
})

const footprintForPlacement = (
  placement: SheetPlacement,
  map: TabletopMapV2,
  state: AuthoritativeSessionState<TabletopMapV2>,
  resolveFootprint: MoveTokenFootprintResolver,
): PositionedGridFootprint => {
  const footprint = resolveFootprint({ placement, map, state })

  if (!Number.isSafeInteger(footprint.base) || footprint.base < 1) {
    throw new ApplyMoveTokenCommandUseCaseError(
      500,
      `Resolved footprint for token ${placement.id} must have a positive safe-integer base`,
    )
  }

  if (
    footprint.clearance !== undefined &&
    (!Number.isSafeInteger(footprint.clearance) || footprint.clearance < 1)
  ) {
    throw new ApplyMoveTokenCommandUseCaseError(
      500,
      `Resolved footprint for token ${placement.id} must have a positive safe-integer clearance`,
    )
  }

  return {
    ...footprint,
    id: footprint.id ?? placement.id,
    position: clonePosition(placement.position),
  }
}

const tokenStateFromPlacement = (
  mapSlug: SessionMapSlug,
  mapRevision: MapRevision,
  sessionRevision: SessionRevision,
  placement: SheetPlacement,
): MoveTokenCurrentState => ({
  tokenId: placement.id,
  mapSlug,
  position: clonePosition(placement.position),
  revision: sessionRevision,
  mapRevision,
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
})

const getActiveMoveTokenRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<MoveTokenCommand, 'sessionId'>,
): MoveTokenSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplyMoveTokenCommandUseCaseError(
      404,
      'No Track 2 table session was found for the supplied moveToken command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplyMoveTokenCommandUseCaseError(
      409,
      'The Track 2 table session must be active before moveToken commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplyMoveTokenCommandUseCaseError(
      500,
      'The Track 2 table session has no authoritative state available for moveToken commands',
    )
  }

  return record as MoveTokenSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedMoveTokenSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: MoveTokenCommand,
  record: MoveTokenSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<typeof MOVE_TOKEN_COMMAND_TYPE, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'invalid',
  message: issueSummary(issues) || 'moveToken command is invalid.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: MOVE_TOKEN_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  issues,
  metadata: metadataForResult(command, processedAt),
})

const createUnauthorizedRejection = (
  command: MoveTokenCommand,
  record: MoveTokenSessionRecord,
  permission: PermissionDenied | undefined,
  resource: SessionTokenResourceRef | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  typeof MOVE_TOKEN_COMMAND_TYPE,
  MoveTokenCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'The actor is not authorized to move this token.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: MOVE_TOKEN_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  ...(permission === undefined ? {} : { permission }),
  ...(resource === undefined ? {} : { resource: cloneResource(resource) }),
  metadata: metadataForResult(command, processedAt),
})

const createConflictRejection = (
  command: MoveTokenCommand,
  record: MoveTokenSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly conflictingScopes?: MoveTokenCommand['scopes']
    readonly currentState?: MoveTokenCurrentState | null
  } = {},
): SessionCommandConflictRejection<
  typeof MOVE_TOKEN_COMMAND_TYPE,
  MoveTokenCurrentState | null,
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
  commandType: MOVE_TOKEN_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  conflictingScopes: options.conflictingScopes ?? command.scopes,
  ...(options.currentState === undefined ? {} : { currentState: options.currentState }),
  metadata: metadataForResult(command, processedAt),
})

const rejectionOutcome = (
  command: MoveTokenCommand,
  record: MoveTokenSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: MoveTokenRejectedResult,
): ApplyMoveTokenRejectedResult => ({
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

const resolveMoveTokenTarget = (
  command: MoveTokenCommand,
  record: MoveTokenSessionRecord,
  resource: SessionTokenResourceRef,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedMoveTokenTarget }
  | { readonly ok: false; readonly result: MoveTokenRejectedResult } => {
  const mapSlug = resolveMapSlug(record.state, resource)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        'moveToken commands must identify a map or the session must have a selected map.',
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
    throw new ApplyMoveTokenCommandUseCaseError(
      500,
      'moveToken target placement count and lookup disagreed',
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

const validateMoveDestination = (
  command: MoveTokenCommand,
  record: MoveTokenSessionRecord,
  target: ResolvedMoveTokenTarget,
  processedAt: string,
  resolveFootprint: MoveTokenFootprintResolver,
): MoveTokenRejectedResult | undefined => {
  const currentToken = tokenStateFromPlacement(
    target.mapSlug,
    target.mapState.revision,
    record.revision,
    target.placement,
  )

  if (positionsEqual(target.placement.position, command.payload.to)) {
    return createConflictRejection(
      command,
      record,
      `Token ${command.payload.tokenId} is already at the requested position.`,
      processedAt,
      { retryable: false, currentState: currentToken },
    )
  }

  const movingFootprint = footprintForPlacement(
    target.placement,
    target.mapState.document,
    record.state,
    resolveFootprint,
  )
  const otherFootprints = target.mapState.document.placements
    .filter((placement) => placement.id !== target.placement.id)
    .map((placement) => footprintForPlacement(
      placement,
      target.mapState.document,
      record.state,
      resolveFootprint,
    ))
  const occupiedVoxels = buildVoxelOccupancy(target.mapState.document.voxels)
  const canPlace = canPlacePokemon(
    movingFootprint,
    command.payload.to,
    otherFootprints,
    target.mapState.document.dimensions,
    target.placement.id,
    occupiedVoxels,
  )

  if (!canPlace) {
    return createConflictRejection(
      command,
      record,
      `Token ${command.payload.tokenId} cannot move to ${command.payload.to.x},${command.payload.to.y},${command.payload.to.z}; the destination is out of bounds, blocked, or occupied.`,
      processedAt,
      { retryable: true, currentState: currentToken },
    )
  }

  return undefined
}

const movedMapDocument = (
  map: TabletopMapV2,
  placementIndex: number,
  to: MoveTokenPosition,
  processedAt: string,
): TabletopMapV2 => {
  const updatedAtMs = Date.parse(processedAt)
  const placements = map.placements.map((placement, index) => (
    index === placementIndex
      ? { ...placement, position: clonePosition(to) }
      : placement
  ))

  return {
    ...map,
    placements,
    ...(Number.isFinite(updatedAtMs) ? { updatedAt: updatedAtMs } : {}),
  }
}

const rememberRejectedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: MoveTokenCommand,
  result: MoveTokenRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: MoveTokenCommand,
  result: MoveTokenAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForMoveToken = (commandInput: unknown): MoveTokenCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<MoveTokenCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (envelopeValidation.command.type !== MOVE_TOKEN_COMMAND_TYPE) {
      throw new ApplyMoveTokenCommandUseCaseError(
        400,
        'applyMoveTokenCommandUseCase only handles moveToken command envelopes',
      )
    }
    return envelopeValidation.command
  }

  throw new ApplyMoveTokenCommandUseCaseError(
    400,
    `moveToken command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

export const applyMoveTokenCommandUseCase = (
  input: ApplyMoveTokenCommandInput = {},
  dependencies: ApplyMoveTokenCommandDependencies = {},
): ApplyMoveTokenCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot
  const resolveFootprint = dependencies.resolveFootprint ?? defaultResolveTokenFootprint

  const envelope = validateEnvelopeForMoveToken(input.command)
  const record = getActiveMoveTokenRecord(activeStore, envelope)
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
        result: duplicateCheck.result as MoveTokenDuplicateResult,
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

  const commandValidation = validateMoveTokenCommand(envelope, {
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

  const targetResult = resolveMoveTokenTarget(
    commandValidation.command,
    record,
    commandValidation.resource,
    processedAt,
  )
  if (!targetResult.ok) {
    rememberRejectedResult(tracker, envelope, targetResult.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, targetResult.result)
  }

  const destinationRejection = validateMoveDestination(
    commandValidation.command,
    record,
    targetResult.target,
    processedAt,
    resolveFootprint,
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
  const nextDocument = movedMapDocument(
    targetResult.target.mapState.document,
    targetResult.target.placementIndex,
    commandValidation.payload.to,
    processedAt,
  )
  const applied = applyAcceptedSessionCommandEffect({
    state: record.state,
    command: commandValidation.command,
    eventType: MOVE_TOKEN_PATCH_EVENT_TYPE,
    eventPayload: {
      tokenId: commandValidation.payload.tokenId,
      mapSlug: targetResult.target.mapSlug,
      from: previousToken.position,
      to: commandValidation.payload.to,
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
    throw new ApplyMoveTokenCommandUseCaseError(
      409,
      'The Track 2 table session ended before moveToken could apply',
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
    throw new ApplyMoveTokenCommandUseCaseError(
      500,
      `Failed to write moveToken session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  const currentMapState = getSessionMapState(applied.state, targetResult.target.mapSlug)
  const currentPlacement = currentMapState?.document.placements.find(
    (placement) => placement.id === commandValidation.payload.tokenId,
  )
  if (currentMapState === undefined || currentPlacement === undefined) {
    throw new ApplyMoveTokenCommandUseCaseError(
      500,
      'moveToken applied but the moved token could not be found in next authoritative state',
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
