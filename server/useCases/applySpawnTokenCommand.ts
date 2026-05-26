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
import type { PermissionDenied } from '#shared/sessionPermissions'
import type { MapRevision, SessionRevision } from '#shared/sessionRevisions'
import {
  getSessionMapState,
  type AuthoritativeSessionMapState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import {
  SPAWN_TOKEN_COMMAND_TYPE,
  validateSpawnTokenCommand,
  type MoveTokenPosition,
  type SpawnTokenCommand,
  type SpawnTokenCommandPayload,
} from '#shared/sessionTokenCommands'
import type { SheetPlacement, TabletopMapV2 } from '~/types/map'
import { canPlacePokemon } from '~/utils/gridPlacement'
import type { GridFootprint, PositionedGridFootprint } from '~/utils/gridGeometry'
import { DEFAULT_TOKEN_FACING_DIRECTION, tokenFacingStoresLegacyTurned } from '~/utils/tokenFacing'
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

export class ApplySpawnTokenCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const SPAWN_TOKEN_PATCH_EVENT_TYPE = 'tokenSpawned' as const

export interface SpawnTokenCurrentState {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly placement: SheetPlacement
  readonly position: MoveTokenPosition
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
  readonly sheetKind: SheetPlacement['sheetKind']
  readonly sheetSlug: string
}

export interface SpawnTokenPatchPayload {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly placement: SheetPlacement
  readonly sheetKind: SheetPlacement['sheetKind']
  readonly sheetSlug: string
  readonly position: MoveTokenPosition
}

export type SpawnTokenPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof SPAWN_TOKEN_PATCH_EVENT_TYPE,
  SpawnTokenPatchPayload
>

export type SpawnTokenAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  typeof SPAWN_TOKEN_COMMAND_TYPE,
  SpawnTokenCommandPayload,
  TabletopMapV2,
  typeof SPAWN_TOKEN_PATCH_EVENT_TYPE,
  SpawnTokenPatchPayload
>

export type SpawnTokenRejectedResult = SessionCommandRejectedResult<
  typeof SPAWN_TOKEN_COMMAND_TYPE,
  SpawnTokenCurrentState | null,
  SessionRevision
>

export type SpawnTokenDuplicateResult = SessionCommandDuplicateResult<
  typeof SPAWN_TOKEN_COMMAND_TYPE,
  SessionRevision
>

export interface ApplySpawnTokenCommandInput {
  readonly command?: unknown
}

export type ApplySpawnTokenCommandClock = () => string
export type ApplySpawnTokenCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export type SpawnTokenFootprintResolver = (input: {
  readonly placement: SheetPlacement
  readonly map: TabletopMapV2
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}) => GridFootprint

export interface ApplySpawnTokenCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplySpawnTokenCommandClock
  readonly writeSnapshot?: ApplySpawnTokenCommandSnapshotWriter
  readonly resolveFootprint?: SpawnTokenFootprintResolver
}

export interface AppliedSpawnTokenSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedSpawnTokenSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplySpawnTokenAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedSpawnTokenSessionDetails
  readonly command: SpawnTokenCommand
  readonly result: SpawnTokenAcceptedApplication['result']
  readonly patchEvent: SpawnTokenPatchEvent
  readonly eventLogEntry: SpawnTokenAcceptedApplication['eventLogEntry']
  readonly token: SpawnTokenCurrentState
  readonly snapshot: AppliedSpawnTokenSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: SpawnTokenAcceptedApplication['mapRevisionChanges']
}

export interface ApplySpawnTokenRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedSpawnTokenSessionDetails
  readonly command: SpawnTokenCommand
  readonly result: SpawnTokenRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplySpawnTokenDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedSpawnTokenSessionDetails
  readonly command: SpawnTokenCommand
  readonly result: SpawnTokenDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplySpawnTokenCommandUseCaseResult =
  | ApplySpawnTokenAcceptedResult
  | ApplySpawnTokenRejectedResult
  | ApplySpawnTokenDuplicateResult

type SpawnTokenSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedSpawnTokenTarget = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
  readonly placement: SheetPlacement
}

const defaultClock: ApplySpawnTokenCommandClock = () => new Date().toISOString()

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
  command: SpawnTokenCommand,
  processedAt: string,
): SessionCommandResultMetadata => ({
  serverProcessedAt: processedAt,
  ...(command.metadata?.traceId === undefined ? {} : { traceId: command.metadata.traceId }),
})

const issueSummary = (issues: readonly SessionCommandValidationIssue[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const defaultResolveTokenFootprint: SpawnTokenFootprintResolver = ({ placement }) => ({
  id: placement.id,
  base: 1,
  clearance: 1,
})

const footprintForPlacement = (
  placement: SheetPlacement,
  map: TabletopMapV2,
  state: AuthoritativeSessionState<TabletopMapV2>,
  resolveFootprint: SpawnTokenFootprintResolver,
): PositionedGridFootprint => {
  const footprint = resolveFootprint({ placement, map, state })

  if (!Number.isSafeInteger(footprint.base) || footprint.base < 1) {
    throw new ApplySpawnTokenCommandUseCaseError(
      500,
      `Resolved footprint for token ${placement.id} must have a positive safe-integer base`,
    )
  }

  if (
    footprint.clearance !== undefined &&
    (!Number.isSafeInteger(footprint.clearance) || footprint.clearance < 1)
  ) {
    throw new ApplySpawnTokenCommandUseCaseError(
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
): SpawnTokenCurrentState => ({
  tokenId: placement.id,
  mapSlug,
  placement: clonePlacement(placement),
  position: clonePosition(placement.position),
  revision: sessionRevision,
  mapRevision,
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
})

const getActiveSpawnTokenRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<SpawnTokenCommand, 'sessionId'>,
): SpawnTokenSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplySpawnTokenCommandUseCaseError(
      404,
      'No Track 2 table session was found for the supplied spawnToken command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplySpawnTokenCommandUseCaseError(
      409,
      'The Track 2 table session must be active before spawnToken commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplySpawnTokenCommandUseCaseError(
      500,
      'The Track 2 table session has no authoritative state available for spawnToken commands',
    )
  }

  return record as SpawnTokenSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedSpawnTokenSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: SpawnTokenCommand,
  record: SpawnTokenSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<typeof SPAWN_TOKEN_COMMAND_TYPE, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'invalid',
  message: issueSummary(issues) || 'spawnToken command is invalid.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: SPAWN_TOKEN_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  issues,
  metadata: metadataForResult(command, processedAt),
})

const createUnauthorizedRejection = (
  command: SpawnTokenCommand,
  record: SpawnTokenSessionRecord,
  permission: PermissionDenied | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  typeof SPAWN_TOKEN_COMMAND_TYPE,
  SpawnTokenCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'Only the GM can spawn tokens in a Track 2 table session.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: SPAWN_TOKEN_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  ...(permission === undefined ? {} : { permission }),
  metadata: metadataForResult(command, processedAt),
})

const createConflictRejection = (
  command: SpawnTokenCommand,
  record: SpawnTokenSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly currentState?: SpawnTokenCurrentState | null
  } = {},
): SessionCommandConflictRejection<
  typeof SPAWN_TOKEN_COMMAND_TYPE,
  SpawnTokenCurrentState | null,
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
  commandType: SPAWN_TOKEN_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  conflictingScopes: command.scopes,
  ...(options.currentState === undefined ? {} : { currentState: options.currentState }),
  metadata: metadataForResult(command, processedAt),
})

const rejectionOutcome = (
  command: SpawnTokenCommand,
  record: SpawnTokenSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: SpawnTokenRejectedResult,
): ApplySpawnTokenRejectedResult => ({
  status: 'rejected',
  session: sessionDetailsFor(record),
  command,
  result,
  record,
  state,
})

const resolveMapSlug = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  mapSlug: string | undefined,
): SessionMapSlug | undefined => mapSlug ?? state.selectedMapSlug ?? undefined

const findTokenPlacement = (
  mapState: AuthoritativeSessionMapState<TabletopMapV2>,
  tokenId: string,
): SheetPlacement | undefined => mapState.document.placements.find((placement) => placement.id === tokenId)

const resolveSpawnTokenTarget = (
  command: SpawnTokenCommand,
  record: SpawnTokenSessionRecord,
  mapSlugInput: string | undefined,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedSpawnTokenTarget }
  | { readonly ok: false; readonly result: SpawnTokenRejectedResult } => {
  const mapSlug = resolveMapSlug(record.state, mapSlugInput)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        'spawnToken commands must identify a map or the session must have a selected map.',
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

  const existingPlacement = findTokenPlacement(mapState, command.payload.placement.id)
  if (existingPlacement !== undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Token ${command.payload.placement.id} is already present on map ${mapSlug}.`,
        processedAt,
        {
          retryable: false,
          currentState: tokenStateFromPlacement(
            mapSlug,
            mapState.revision,
            record.revision,
            existingPlacement,
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
      placement: normalizedSpawnPlacement(command.payload.placement),
    },
  }
}

const normalizedSpawnPlacement = (
  placement: SpawnTokenCommandPayload['placement'],
): SheetPlacement => {
  const facing = placement.facing ?? DEFAULT_TOKEN_FACING_DIRECTION
  return {
    id: placement.id,
    sheetKind: placement.sheetKind,
    sheetSlug: placement.sheetSlug,
    position: clonePosition(placement.position),
    facing,
    turned: tokenFacingStoresLegacyTurned(facing),
    ...(placement.initiative === undefined ? {} : { initiative: placement.initiative }),
  }
}

const validateSpawnDestination = (
  command: SpawnTokenCommand,
  record: SpawnTokenSessionRecord,
  target: ResolvedSpawnTokenTarget,
  processedAt: string,
  resolveFootprint: SpawnTokenFootprintResolver,
): SpawnTokenRejectedResult | undefined => {
  const spawningFootprint = footprintForPlacement(
    target.placement,
    target.mapState.document,
    record.state,
    resolveFootprint,
  )
  const otherFootprints = target.mapState.document.placements.map((placement) => footprintForPlacement(
    placement,
    target.mapState.document,
    record.state,
    resolveFootprint,
  ))
  const occupiedVoxels = buildVoxelOccupancy(target.mapState.document.voxels)
  const canPlace = canPlacePokemon(
    spawningFootprint,
    target.placement.position,
    otherFootprints,
    target.mapState.document.dimensions,
    target.placement.id,
    occupiedVoxels,
  )

  if (!canPlace) {
    return createConflictRejection(
      command,
      record,
      `Token ${command.payload.placement.id} cannot spawn at ${target.placement.position.x},${target.placement.position.y},${target.placement.position.z}; the destination is out of bounds, blocked, or occupied.`,
      processedAt,
      { retryable: true, currentState: null },
    )
  }

  return undefined
}

const spawnedMapDocument = (
  map: TabletopMapV2,
  placement: SheetPlacement,
  processedAt: string,
): TabletopMapV2 => {
  const updatedAtMs = Date.parse(processedAt)
  return {
    ...map,
    placements: [...map.placements, clonePlacement(placement)],
    ...(Number.isFinite(updatedAtMs) ? { updatedAt: updatedAtMs } : {}),
  }
}

const rememberRejectedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: SpawnTokenCommand,
  result: SpawnTokenRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: SpawnTokenCommand,
  result: SpawnTokenAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForSpawnToken = (commandInput: unknown): SpawnTokenCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<SpawnTokenCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (envelopeValidation.command.type !== SPAWN_TOKEN_COMMAND_TYPE) {
      throw new ApplySpawnTokenCommandUseCaseError(
        400,
        'applySpawnTokenCommandUseCase only handles spawnToken command envelopes',
      )
    }
    return envelopeValidation.command
  }

  throw new ApplySpawnTokenCommandUseCaseError(
    400,
    `spawnToken command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

export const applySpawnTokenCommandUseCase = (
  input: ApplySpawnTokenCommandInput = {},
  dependencies: ApplySpawnTokenCommandDependencies = {},
): ApplySpawnTokenCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot
  const resolveFootprint = dependencies.resolveFootprint ?? defaultResolveTokenFootprint

  const envelope = validateEnvelopeForSpawnToken(input.command)
  const record = getActiveSpawnTokenRecord(activeStore, envelope)
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
        result: duplicateCheck.result as SpawnTokenDuplicateResult,
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

  const commandValidation = validateSpawnTokenCommand(envelope)

  if (!commandValidation.valid) {
    const result = commandValidation.permission?.allowed === false
      ? createUnauthorizedRejection(envelope, record, commandValidation.permission, processedAt)
      : createInvalidRejection(envelope, record, commandValidation.issues, processedAt)

    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const targetResult = resolveSpawnTokenTarget(
    commandValidation.command,
    record,
    commandValidation.resource.mapSlug,
    processedAt,
  )
  if (!targetResult.ok) {
    rememberRejectedResult(tracker, envelope, targetResult.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, targetResult.result)
  }

  const destinationRejection = validateSpawnDestination(
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

  const nextDocument = spawnedMapDocument(
    targetResult.target.mapState.document,
    targetResult.target.placement,
    processedAt,
  )
  const applied = applyAcceptedSessionCommandEffect({
    state: record.state,
    command: commandValidation.command,
    eventType: SPAWN_TOKEN_PATCH_EVENT_TYPE,
    eventPayload: {
      tokenId: targetResult.target.placement.id,
      mapSlug: targetResult.target.mapSlug,
      placement: clonePlacement(targetResult.target.placement),
      sheetKind: targetResult.target.placement.sheetKind,
      sheetSlug: targetResult.target.placement.sheetSlug,
      position: clonePosition(targetResult.target.placement.position),
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
    throw new ApplySpawnTokenCommandUseCaseError(
      409,
      'The Track 2 table session ended before spawnToken could apply',
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
    throw new ApplySpawnTokenCommandUseCaseError(
      500,
      `Failed to write spawnToken session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  const currentMapState = getSessionMapState(applied.state, targetResult.target.mapSlug)
  const currentPlacement = currentMapState?.document.placements.find(
    (placement) => placement.id === commandValidation.payload.placement.id,
  )
  if (currentMapState === undefined || currentPlacement === undefined) {
    throw new ApplySpawnTokenCommandUseCaseError(
      500,
      'spawnToken applied but the spawned token could not be found in next authoritative state',
    )
  }

  return {
    status: 'accepted',
    session: sessionDetailsFor(updatedRecord),
    command: commandValidation.command,
    result: applied.result,
    patchEvent: applied.patchEvent,
    eventLogEntry: applied.eventLogEntry,
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
