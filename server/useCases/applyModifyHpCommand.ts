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
  MODIFY_HP_COMMAND_SCOPE_FIELD,
  MODIFY_HP_COMMAND_TYPE,
  validateModifyHpCommand,
  type ModifyHpCommand,
  type ModifyHpCommandPayload,
} from '#shared/sessionTableActionCommands'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMapV2 } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  applyHpToSheet,
  toPersistableSheetPayload,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import { toNextRevisionSheetPayload } from '~/utils/sheets/persistence'
import { pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
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
import { readSheetFile, writeSheetFile } from '../utils/sheetStorage'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class ApplyModifyHpCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const MODIFY_HP_PATCH_EVENT_TYPE = 'hpModified' as const

export interface ModifyHpValueState {
  readonly currentHp: number
  readonly maxHp: number
  readonly fullMaxHp: number
  readonly injuries: number
}

export interface ModifyHpCurrentState {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly hp: ModifyHpValueState
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
}

export interface ModifyHpPatchPayload {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly previous: ModifyHpValueState
  readonly current: ModifyHpValueState
}

export type ModifyHpPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof MODIFY_HP_PATCH_EVENT_TYPE,
  ModifyHpPatchPayload
>

export type ModifyHpAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  typeof MODIFY_HP_COMMAND_TYPE,
  ModifyHpCommandPayload,
  TabletopMapV2,
  typeof MODIFY_HP_PATCH_EVENT_TYPE,
  ModifyHpPatchPayload
>

export type ModifyHpRejectedResult = SessionCommandRejectedResult<
  typeof MODIFY_HP_COMMAND_TYPE,
  ModifyHpCurrentState | null,
  SessionRevision
>

export type ModifyHpDuplicateResult = SessionCommandDuplicateResult<
  typeof MODIFY_HP_COMMAND_TYPE,
  SessionRevision
>

export interface ApplyModifyHpCommandInput {
  readonly command?: unknown
}

export type ApplyModifyHpCommandClock = () => string
export type ApplyModifyHpCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export type ModifyHpSheetReader = (
  kind: SheetKind,
  slug: string,
) => { readonly path: string; readonly sheet: AnyLiveSheet } | null

export type ModifyHpSheetWriter = (path: string, sheet: Record<string, unknown>) => void

export interface ApplyModifyHpCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplyModifyHpCommandClock
  readonly writeSnapshot?: ApplyModifyHpCommandSnapshotWriter
  readonly readSheet?: ModifyHpSheetReader
  readonly writeSheet?: ModifyHpSheetWriter
}

export interface AppliedModifyHpSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedModifyHpSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplyModifyHpAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedModifyHpSessionDetails
  readonly command: ModifyHpCommand
  readonly result: ModifyHpAcceptedApplication['result']
  readonly patchEvent: ModifyHpPatchEvent
  readonly eventLogEntry: ModifyHpAcceptedApplication['eventLogEntry']
  readonly hp: ModifyHpCurrentState
  readonly previousHp: ModifyHpCurrentState
  readonly snapshot: AppliedModifyHpSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: ModifyHpAcceptedApplication['mapRevisionChanges']
}

export interface ApplyModifyHpRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedModifyHpSessionDetails
  readonly command: ModifyHpCommand
  readonly result: ModifyHpRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplyModifyHpDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedModifyHpSessionDetails
  readonly command: ModifyHpCommand
  readonly result: ModifyHpDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplyModifyHpCommandUseCaseResult =
  | ApplyModifyHpAcceptedResult
  | ApplyModifyHpRejectedResult
  | ApplyModifyHpDuplicateResult

type ModifyHpSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedModifyHpTarget = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
  readonly placement: SheetPlacement
  readonly placementIndex: number
  readonly tokenResource: SessionTokenResourceRef
  readonly sheetResource?: SessionSheetResourceRef
}

type ResolvedModifyHpSheet = {
  readonly path: string
  readonly original: AnyLiveSheet
  readonly updated: AnyLiveSheet
  readonly previousHp: ModifyHpValueState
  readonly currentHp: ModifyHpValueState
}

const defaultClock: ApplyModifyHpCommandClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const metadataForResult = (
  command: ModifyHpCommand,
  processedAt: string,
): SessionCommandResultMetadata => ({
  serverProcessedAt: processedAt,
  ...(command.metadata?.traceId === undefined ? {} : { traceId: command.metadata.traceId }),
})

const issueSummary = (issues: readonly SessionCommandValidationIssue[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const cloneTokenResource = (resource: SessionTokenResourceRef): SessionTokenResourceRef => ({
  ...resource,
})

const cloneHpValueState = (hp: ModifyHpValueState): ModifyHpValueState => ({
  currentHp: hp.currentHp,
  maxHp: hp.maxHp,
  fullMaxHp: hp.fullMaxHp,
  injuries: hp.injuries,
})

const hpSnapshotForSheet = (kind: SheetKind, sheet: AnyLiveSheet): ModifyHpValueState => {
  if (kind === 'pokemon') {
    const snapshot = pokemonHpSnapshot(sheet as CharacterSheet)
    return {
      currentHp: snapshot.currentHp,
      maxHp: snapshot.maxHp,
      fullMaxHp: snapshot.fullMaxHp,
      injuries: snapshot.injuries,
    }
  }

  const snapshot = trainerHpSnapshot(sheet as TrainerSheet)
  return {
    currentHp: snapshot.currentHp,
    maxHp: snapshot.maxHp,
    fullMaxHp: snapshot.fullMaxHp,
    injuries: snapshot.injuries,
  }
}

const tokenStateFromHp = (
  mapSlug: SessionMapSlug,
  mapRevision: MapRevision,
  sessionRevision: SessionRevision,
  placement: SheetPlacement,
  hp: ModifyHpValueState,
): ModifyHpCurrentState => ({
  tokenId: placement.id,
  mapSlug,
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
  hp: cloneHpValueState(hp),
  revision: sessionRevision,
  mapRevision,
})

const hpValuesEqual = (left: ModifyHpValueState, right: ModifyHpValueState): boolean =>
  left.currentHp === right.currentHp && left.injuries === right.injuries

const persistableSheet = (sheet: AnyLiveSheet, options: { advanceRevision?: boolean } = {}): Record<string, unknown> => {
  const payload = toPersistableSheetPayload(sheet as unknown as Record<string, unknown>)
  return options.advanceRevision ? toNextRevisionSheetPayload(payload) : payload
}

const defaultReadSheet: ModifyHpSheetReader = (kind, slug) => {
  const result = readSheetFile<AnyLiveSheet>(kind, slug)
  if (result === null) return null
  return {
    path: result.path,
    sheet: result.sheet,
  }
}

const getActiveModifyHpRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<ModifyHpCommand, 'sessionId'>,
): ModifyHpSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplyModifyHpCommandUseCaseError(
      404,
      'No live session was found for the supplied modifyHp command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplyModifyHpCommandUseCaseError(
      409,
      'The live session must be active before modifyHp commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplyModifyHpCommandUseCaseError(
      500,
      'The live session has no authoritative state available for modifyHp commands',
    )
  }

  return record as ModifyHpSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedModifyHpSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: ModifyHpCommand,
  record: ModifyHpSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<typeof MODIFY_HP_COMMAND_TYPE, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'invalid',
  message: issueSummary(issues) || 'modifyHp command is invalid.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: MODIFY_HP_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  issues,
  metadata: metadataForResult(command, processedAt),
})

const createUnauthorizedRejection = (
  command: ModifyHpCommand,
  record: ModifyHpSessionRecord,
  permission: PermissionDenied | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  typeof MODIFY_HP_COMMAND_TYPE,
  ModifyHpCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'Only the GM or a player assigned to the target token or sheet can modify HP in a live session.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: MODIFY_HP_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  ...(permission === undefined ? {} : { permission }),
  metadata: metadataForResult(command, processedAt),
})

const createConflictRejection = (
  command: ModifyHpCommand,
  record: ModifyHpSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly conflictingScopes?: ModifyHpCommand['scopes']
    readonly currentState?: ModifyHpCurrentState | null
  } = {},
): SessionCommandConflictRejection<
  typeof MODIFY_HP_COMMAND_TYPE,
  ModifyHpCurrentState | null,
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
  commandType: MODIFY_HP_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  conflictingScopes: options.conflictingScopes ?? command.scopes,
  ...(options.currentState === undefined ? {} : { currentState: options.currentState }),
  metadata: metadataForResult(command, processedAt),
})

const createStaleRejection = (
  command: ModifyHpCommand,
  record: ModifyHpSessionRecord,
  message: string,
  processedAt: string,
  currentState: ModifyHpCurrentState | null,
  changedScopes: readonly SessionCommandScope[] = command.scopes,
): SessionCommandStaleRejection<
  typeof MODIFY_HP_COMMAND_TYPE,
  ModifyHpCurrentState | null,
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
  commandType: MODIFY_HP_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  baseRevision: command.baseRevision,
  changedScopes,
  currentState,
  metadata: metadataForResult(command, processedAt),
})

const rejectionOutcome = (
  command: ModifyHpCommand,
  record: ModifyHpSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: ModifyHpRejectedResult,
): ApplyModifyHpRejectedResult => ({
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

const resolveModifyHpTarget = (
  command: ModifyHpCommand,
  record: ModifyHpSessionRecord,
  tokenResource: SessionTokenResourceRef,
  sheetResource: SessionSheetResourceRef | undefined,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedModifyHpTarget }
  | { readonly ok: false; readonly result: ModifyHpRejectedResult } => {
  const mapSlug = resolveMapSlug(record.state, tokenResource)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        'modifyHp commands must identify a map or the session must have a selected map.',
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
    throw new ApplyModifyHpCommandUseCaseError(
      500,
      'modifyHp target placement count and lookup disagreed',
    )
  }

  if (!placementMatchesTokenResource(found.placement, tokenResource)) {
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

  if (!placementMatchesSheetResource(found.placement, sheetResource)) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Token ${command.payload.tokenId} does not match the requested sheet HP scope.`,
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
      placement: found.placement,
      placementIndex: found.index,
      tokenResource: cloneTokenResource(tokenResource),
      ...(sheetResource === undefined ? {} : { sheetResource }),
    },
  }
}

const resolveModifyHpSheet = (
  command: ModifyHpCommand,
  record: ModifyHpSessionRecord,
  target: ResolvedModifyHpTarget,
  processedAt: string,
  readSheet: ModifyHpSheetReader,
):
  | { readonly ok: true; readonly sheet: ResolvedModifyHpSheet }
  | { readonly ok: false; readonly result: ModifyHpRejectedResult } => {
  const sheetResult = readSheet(target.placement.sheetKind, target.placement.sheetSlug)
  if (sheetResult === null) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Sheet ${target.placement.sheetKind}/${target.placement.sheetSlug} could not be loaded for modifyHp.`,
        processedAt,
        { retryable: true, currentState: null },
      ),
    }
  }

  const previousHp = hpSnapshotForSheet(target.placement.sheetKind, sheetResult.sheet)
  const updated = applyHpToSheet(
    target.placement.sheetKind,
    sheetResult.sheet,
    command.payload.currentHp,
    command.payload.injuries,
  )
  const currentHp = hpSnapshotForSheet(target.placement.sheetKind, updated)

  return {
    ok: true,
    sheet: {
      path: sheetResult.path,
      original: sheetResult.sheet,
      updated,
      previousHp,
      currentHp,
    },
  }
}

const acceptedOperationAfterBase = (
  operation: SessionOperationRecord,
  baseRevision: SessionRevision,
): boolean => operation.result.status === 'accepted' &&
  compareSessionRevisions(baseRevision, operation.result.currentRevision) === -1

const scopeTouchesTokenHp = (
  scope: SessionCommandScope,
  tokenId: string,
  mapSlug: SessionMapSlug,
): boolean => {
  const resource = scope.resource
  if (scope.lane !== 'token') return false
  if (scope.field !== MODIFY_HP_COMMAND_SCOPE_FIELD) return false
  if (resource?.kind !== 'token') return false
  if (resource.tokenId !== tokenId) return false

  const scopedMapSlug = resource.mapSlug ?? scope.mapSlug
  return scopedMapSlug === undefined || scopedMapSlug === mapSlug
}

const scopeTouchesSheetHp = (
  scope: SessionCommandScope,
  placement: SheetPlacement,
): boolean => {
  const resource = scope.resource
  return scope.lane === 'sheet' &&
    scope.field === MODIFY_HP_COMMAND_SCOPE_FIELD &&
    resource?.kind === 'sheet' &&
    resource.sheetKind === placement.sheetKind &&
    resource.sheetSlug === placement.sheetSlug
}

const operationTouchesModifyHpTarget = (
  operation: SessionOperationRecord,
  target: ResolvedModifyHpTarget,
): boolean => operation.commandType === MODIFY_HP_COMMAND_TYPE &&
  operation.scopes.some((scope) =>
    scopeTouchesTokenHp(scope, target.placement.id, target.mapSlug) ||
    scopeTouchesSheetHp(scope, target.placement),
  )

const staleModifyHpRejection = (
  command: ModifyHpCommand,
  record: ModifyHpSessionRecord,
  target: ResolvedModifyHpTarget,
  currentState: ModifyHpCurrentState,
  processedAt: string,
  tracker: InMemorySessionOperationTracker | false,
): ModifyHpRejectedResult | undefined => {
  if (compareSessionRevisions(command.baseRevision, record.revision) !== -1) return undefined

  if (tracker === false) {
    return createStaleRejection(
      command,
      record,
      `HP for token ${command.payload.tokenId} may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before modifying it again.`,
      processedAt,
      currentState,
    )
  }

  const acceptedSinceBase = tracker
    .list(command.sessionId)
    .filter((operation) => acceptedOperationAfterBase(operation, command.baseRevision))

  const matchingHpChange = acceptedSinceBase.find((operation) =>
    operationTouchesModifyHpTarget(operation, target),
  )
  if (matchingHpChange !== undefined) {
    return createStaleRejection(
      command,
      record,
      `HP for token ${command.payload.tokenId} changed after revision ${command.baseRevision}.`,
      processedAt,
      currentState,
      matchingHpChange.scopes,
    )
  }

  const revisionGap = record.revision - command.baseRevision
  if (acceptedSinceBase.length === 0 || revisionGap > tracker.maxRecordsPerSession) {
    return createStaleRejection(
      command,
      record,
      `HP for token ${command.payload.tokenId} may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before modifying it again.`,
      processedAt,
      currentState,
    )
  }

  return undefined
}

const noOpHpRejection = (
  command: ModifyHpCommand,
  record: ModifyHpSessionRecord,
  target: ResolvedModifyHpTarget,
  sheet: ResolvedModifyHpSheet,
  processedAt: string,
): ModifyHpRejectedResult | undefined => {
  if (!hpValuesEqual(sheet.previousHp, sheet.currentHp)) return undefined

  return createConflictRejection(
    command,
    record,
    `Token ${command.payload.tokenId} already has the requested HP state.`,
    processedAt,
    {
      retryable: false,
      currentState: tokenStateFromHp(
        target.mapSlug,
        target.mapState.revision,
        record.revision,
        target.placement,
        sheet.previousHp,
      ),
    },
  )
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

const rememberRejectedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: ModifyHpCommand,
  result: ModifyHpRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: ModifyHpCommand,
  result: ModifyHpAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForModifyHp = (commandInput: unknown): ModifyHpCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<ModifyHpCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (envelopeValidation.command.type !== MODIFY_HP_COMMAND_TYPE) {
      throw new ApplyModifyHpCommandUseCaseError(
        400,
        'applyModifyHpCommandUseCase only handles modifyHp command envelopes',
      )
    }

    return envelopeValidation.command
  }

  throw new ApplyModifyHpCommandUseCaseError(
    400,
    `modifyHp command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

const rollbackWrittenSheet = (
  writeSheet: ModifyHpSheetWriter,
  path: string,
  original: AnyLiveSheet,
): void => {
  writeSheet(path, persistableSheet(original))
}

export const applyModifyHpCommandUseCase = (
  input: ApplyModifyHpCommandInput = {},
  dependencies: ApplyModifyHpCommandDependencies = {},
): ApplyModifyHpCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot
  const readSheet = dependencies.readSheet ?? defaultReadSheet
  const writeSheet = dependencies.writeSheet ?? writeSheetFile

  const envelope = validateEnvelopeForModifyHp(input.command)
  const record = getActiveModifyHpRecord(activeStore, envelope)
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
        result: duplicateCheck.result as ModifyHpDuplicateResult,
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

  const commandValidation = validateModifyHpCommand(envelope, {
    assignments: record.state.assignments,
  })

  if (!commandValidation.valid) {
    const result = commandValidation.permission?.allowed === false
      ? createUnauthorizedRejection(envelope, record, commandValidation.permission, processedAt)
      : createInvalidRejection(envelope, record, commandValidation.issues, processedAt)

    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const targetResult = resolveModifyHpTarget(
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

  const sheetResult = resolveModifyHpSheet(
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

  const currentState = tokenStateFromHp(
    targetResult.target.mapSlug,
    targetResult.target.mapState.revision,
    record.revision,
    targetResult.target.placement,
    sheetResult.sheet.previousHp,
  )

  const staleRejection = staleModifyHpRejection(
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

  const noOpRejection = noOpHpRejection(
    commandValidation.command,
    record,
    targetResult.target,
    sheetResult.sheet,
    processedAt,
  )
  if (noOpRejection !== undefined) {
    rememberRejectedResult(tracker, envelope, noOpRejection, processedAt)
    return rejectionOutcome(envelope, record, record.state, noOpRejection)
  }

  const nextDocument = touchedMapDocument(targetResult.target.mapState.document, processedAt)
  const applied = applyAcceptedSessionCommandEffect({
    state: record.state,
    command: commandValidation.command,
    eventType: MODIFY_HP_PATCH_EVENT_TYPE,
    eventPayload: {
      tokenId: targetResult.target.placement.id,
      mapSlug: targetResult.target.mapSlug,
      sheetKind: targetResult.target.placement.sheetKind,
      sheetSlug: targetResult.target.placement.sheetSlug,
      previous: cloneHpValueState(sheetResult.sheet.previousHp),
      current: cloneHpValueState(sheetResult.sheet.currentHp),
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

  try {
    writeSheet(sheetResult.sheet.path, persistableSheet(sheetResult.sheet.updated, { advanceRevision: true }))
  } catch (error) {
    throw new ApplyModifyHpCommandUseCaseError(
      500,
      `Failed to write modifyHp sheet update: ${messageFromError(error)}`,
    )
  }

  const updatedRecord = activeStore.setState(record.sessionId, applied.state, {
    revision: applied.currentRevision,
    updatedAt: applied.processedAt,
  })
  if (updatedRecord === undefined) {
    rollbackWrittenSheet(writeSheet, sheetResult.sheet.path, sheetResult.sheet.original)
    throw new ApplyModifyHpCommandUseCaseError(
      409,
      'The live session ended before modifyHp could apply',
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
    try {
      rollbackWrittenSheet(writeSheet, sheetResult.sheet.path, sheetResult.sheet.original)
    } catch (rollbackError) {
      throw new ApplyModifyHpCommandUseCaseError(
        500,
        `Failed to write modifyHp session snapshot and failed to roll back sheet update: ${messageFromError(error)}; rollback: ${messageFromError(rollbackError)}`,
      )
    }
    throw new ApplyModifyHpCommandUseCaseError(
      500,
      `Failed to write modifyHp session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  const currentMapState = getSessionMapState(applied.state, targetResult.target.mapSlug)
  const currentPlacement = currentMapState?.document.placements.find(
    (placement) => placement.id === commandValidation.payload.tokenId,
  )
  if (currentMapState === undefined || currentPlacement === undefined) {
    throw new ApplyModifyHpCommandUseCaseError(
      500,
      'modifyHp applied but the target token could not be found in next authoritative state',
    )
  }

  return {
    status: 'accepted',
    session: sessionDetailsFor(updatedRecord),
    command: commandValidation.command,
    result: applied.result,
    patchEvent: applied.patchEvent,
    eventLogEntry: applied.eventLogEntry,
    hp: tokenStateFromHp(
      targetResult.target.mapSlug,
      currentMapState.revision,
      applied.currentRevision,
      currentPlacement,
      sheetResult.sheet.currentHp,
    ),
    previousHp: tokenStateFromHp(
      targetResult.target.mapSlug,
      targetResult.target.mapState.revision,
      record.revision,
      targetResult.target.placement,
      sheetResult.sheet.previousHp,
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
