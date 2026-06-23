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
  MODIFY_CONDITIONS_COMMAND_SCOPE_FIELD,
  MODIFY_CONDITIONS_COMMAND_TYPE,
  validateModifyConditionsCommand,
  type ModifyConditionsCommand,
  type ModifyConditionsCommandPayload,
} from '#shared/sessionTableActionCommands'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMapV2 } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  applyConditionsToSheet,
  toPersistableSheetPayload,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import { toNextRevisionSheetPayload } from '~/utils/sheets/persistence'
import { pokemonHpSnapshot, trainerHpSnapshot } from '~/utils/sheetSpawn'
import { normalizeConditionNames } from '~/utils/statusConditions'
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
import { readRuntimeSheet, writeRuntimeSheet } from '../utils/sqliteSheetRuntimeHelpers'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class ApplyModifyConditionsCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const MODIFY_CONDITIONS_PATCH_EVENT_TYPE = 'conditionsModified' as const

export type ModifyConditionsValueState = readonly string[]

export interface ModifyConditionsCurrentState {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly conditions: ModifyConditionsValueState
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
}

export interface ModifyConditionsPatchPayload {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly previous: ModifyConditionsValueState
  readonly current: ModifyConditionsValueState
}

export type ModifyConditionsPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof MODIFY_CONDITIONS_PATCH_EVENT_TYPE,
  ModifyConditionsPatchPayload
>

export type ModifyConditionsAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  typeof MODIFY_CONDITIONS_COMMAND_TYPE,
  ModifyConditionsCommandPayload,
  TabletopMapV2,
  typeof MODIFY_CONDITIONS_PATCH_EVENT_TYPE,
  ModifyConditionsPatchPayload
>

export type ModifyConditionsRejectedResult = SessionCommandRejectedResult<
  typeof MODIFY_CONDITIONS_COMMAND_TYPE,
  ModifyConditionsCurrentState | null,
  SessionRevision
>

export type ModifyConditionsDuplicateResult = SessionCommandDuplicateResult<
  typeof MODIFY_CONDITIONS_COMMAND_TYPE,
  SessionRevision
>

export interface ApplyModifyConditionsCommandInput {
  readonly command?: unknown
}

export type ApplyModifyConditionsCommandClock = () => string
export type ApplyModifyConditionsCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export type ModifyConditionsSheetReader = (
  kind: SheetKind,
  slug: string,
) => { readonly path: string; readonly sheet: AnyLiveSheet } | null

export type ModifyConditionsSheetWriter = (path: string, sheet: Record<string, unknown>) => void

export interface ApplyModifyConditionsCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplyModifyConditionsCommandClock
  readonly writeSnapshot?: ApplyModifyConditionsCommandSnapshotWriter
  readonly readSheet?: ModifyConditionsSheetReader
  readonly writeSheet?: ModifyConditionsSheetWriter
}

export interface AppliedModifyConditionsSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedModifyConditionsSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplyModifyConditionsAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedModifyConditionsSessionDetails
  readonly command: ModifyConditionsCommand
  readonly result: ModifyConditionsAcceptedApplication['result']
  readonly patchEvent: ModifyConditionsPatchEvent
  readonly eventLogEntry: ModifyConditionsAcceptedApplication['eventLogEntry']
  readonly conditions: ModifyConditionsCurrentState
  readonly previousConditions: ModifyConditionsCurrentState
  readonly snapshot: AppliedModifyConditionsSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: ModifyConditionsAcceptedApplication['mapRevisionChanges']
}

export interface ApplyModifyConditionsRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedModifyConditionsSessionDetails
  readonly command: ModifyConditionsCommand
  readonly result: ModifyConditionsRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplyModifyConditionsDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedModifyConditionsSessionDetails
  readonly command: ModifyConditionsCommand
  readonly result: ModifyConditionsDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplyModifyConditionsCommandUseCaseResult =
  | ApplyModifyConditionsAcceptedResult
  | ApplyModifyConditionsRejectedResult
  | ApplyModifyConditionsDuplicateResult

type ModifyConditionsSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedModifyConditionsTarget = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
  readonly placement: SheetPlacement
  readonly placementIndex: number
  readonly tokenResource: SessionTokenResourceRef
  readonly sheetResource?: SessionSheetResourceRef
}

type ResolvedModifyConditionsSheet = {
  readonly path: string
  readonly original: AnyLiveSheet
  readonly updated: AnyLiveSheet
  readonly previousConditions: ModifyConditionsValueState
  readonly currentConditions: ModifyConditionsValueState
}

const defaultClock: ApplyModifyConditionsCommandClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const metadataForResult = (
  command: ModifyConditionsCommand,
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

const cloneConditionsValueState = (
  conditions: ModifyConditionsValueState,
): string[] => [...conditions]

const conditionsSnapshotForSheet = (
  kind: SheetKind,
  sheet: AnyLiveSheet,
): ModifyConditionsValueState => {
  const snapshot = kind === 'pokemon'
    ? pokemonHpSnapshot(sheet as CharacterSheet)
    : trainerHpSnapshot(sheet as TrainerSheet)
  return cloneConditionsValueState(snapshot.conditions)
}

const conditionIdentityKey = (condition: string): string => condition.trim().toLocaleLowerCase()

const nextConditionsForPayload = (
  previous: ModifyConditionsValueState,
  payload: ModifyConditionsCommandPayload,
): string[] => {
  const normalizedPayloadConditions = normalizeConditionNames(payload.conditions)
  if (payload.action === 'replace') return normalizedPayloadConditions
  if (payload.action === 'add') return normalizeConditionNames([...previous, ...normalizedPayloadConditions])

  const removeKeys = new Set(normalizedPayloadConditions.map(conditionIdentityKey))
  return normalizeConditionNames(previous).filter((condition) => !removeKeys.has(conditionIdentityKey(condition)))
}

const tokenStateFromConditions = (
  mapSlug: SessionMapSlug,
  mapRevision: MapRevision,
  sessionRevision: SessionRevision,
  placement: SheetPlacement,
  conditions: ModifyConditionsValueState,
): ModifyConditionsCurrentState => ({
  tokenId: placement.id,
  mapSlug,
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
  conditions: cloneConditionsValueState(conditions),
  revision: sessionRevision,
  mapRevision,
})

const conditionsValuesEqual = (
  left: ModifyConditionsValueState,
  right: ModifyConditionsValueState,
): boolean => left.length === right.length && left.every((condition, index) => condition === right[index])

const persistableSheet = (sheet: AnyLiveSheet, options: { advanceRevision?: boolean } = {}): Record<string, unknown> => {
  const payload = toPersistableSheetPayload(sheet as unknown as Record<string, unknown>)
  return options.advanceRevision ? toNextRevisionSheetPayload(payload) : payload
}

const defaultReadSheet: ModifyConditionsSheetReader = (kind, slug) => {
  const result = readRuntimeSheet<AnyLiveSheet>(kind, slug)
  if (result === null) return null
  return {
    path: result.path,
    sheet: result.sheet,
  }
}

const getActiveModifyConditionsRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<ModifyConditionsCommand, 'sessionId'>,
): ModifyConditionsSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplyModifyConditionsCommandUseCaseError(
      404,
      'No live session was found for the supplied modifyConditions command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplyModifyConditionsCommandUseCaseError(
      409,
      'The live session must be active before modifyConditions commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplyModifyConditionsCommandUseCaseError(
      500,
      'The live session has no authoritative state available for modifyConditions commands',
    )
  }

  return record as ModifyConditionsSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedModifyConditionsSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: ModifyConditionsCommand,
  record: ModifyConditionsSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<typeof MODIFY_CONDITIONS_COMMAND_TYPE, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'invalid',
  message: issueSummary(issues) || 'modifyConditions command is invalid.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: MODIFY_CONDITIONS_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  issues,
  metadata: metadataForResult(command, processedAt),
})

const createUnauthorizedRejection = (
  command: ModifyConditionsCommand,
  record: ModifyConditionsSessionRecord,
  permission: PermissionDenied | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  typeof MODIFY_CONDITIONS_COMMAND_TYPE,
  ModifyConditionsCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'Only the GM or a player assigned to the target token or sheet can modify conditions in a live session.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: MODIFY_CONDITIONS_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  ...(permission === undefined ? {} : { permission }),
  metadata: metadataForResult(command, processedAt),
})

const createConflictRejection = (
  command: ModifyConditionsCommand,
  record: ModifyConditionsSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly conflictingScopes?: ModifyConditionsCommand['scopes']
    readonly currentState?: ModifyConditionsCurrentState | null
  } = {},
): SessionCommandConflictRejection<
  typeof MODIFY_CONDITIONS_COMMAND_TYPE,
  ModifyConditionsCurrentState | null,
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
  commandType: MODIFY_CONDITIONS_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  conflictingScopes: options.conflictingScopes ?? command.scopes,
  ...(options.currentState === undefined ? {} : { currentState: options.currentState }),
  metadata: metadataForResult(command, processedAt),
})

const createStaleRejection = (
  command: ModifyConditionsCommand,
  record: ModifyConditionsSessionRecord,
  message: string,
  processedAt: string,
  currentState: ModifyConditionsCurrentState | null,
  changedScopes: readonly SessionCommandScope[] = command.scopes,
): SessionCommandStaleRejection<
  typeof MODIFY_CONDITIONS_COMMAND_TYPE,
  ModifyConditionsCurrentState | null,
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
  commandType: MODIFY_CONDITIONS_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  baseRevision: command.baseRevision,
  changedScopes,
  currentState,
  metadata: metadataForResult(command, processedAt),
})

const rejectionOutcome = (
  command: ModifyConditionsCommand,
  record: ModifyConditionsSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: ModifyConditionsRejectedResult,
): ApplyModifyConditionsRejectedResult => ({
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

const resolveModifyConditionsTarget = (
  command: ModifyConditionsCommand,
  record: ModifyConditionsSessionRecord,
  tokenResource: SessionTokenResourceRef,
  sheetResource: SessionSheetResourceRef | undefined,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedModifyConditionsTarget }
  | { readonly ok: false; readonly result: ModifyConditionsRejectedResult } => {
  const mapSlug = resolveMapSlug(record.state, tokenResource)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        'modifyConditions commands must identify a map or the session must have a selected map.',
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
    throw new ApplyModifyConditionsCommandUseCaseError(
      500,
      'modifyConditions target placement count and lookup disagreed',
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
        `Token ${command.payload.tokenId} does not match the requested sheet condition scope.`,
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

const resolveModifyConditionsSheet = (
  command: ModifyConditionsCommand,
  record: ModifyConditionsSessionRecord,
  target: ResolvedModifyConditionsTarget,
  processedAt: string,
  readSheet: ModifyConditionsSheetReader,
):
  | { readonly ok: true; readonly sheet: ResolvedModifyConditionsSheet }
  | { readonly ok: false; readonly result: ModifyConditionsRejectedResult } => {
  const sheetResult = readSheet(target.placement.sheetKind, target.placement.sheetSlug)
  if (sheetResult === null) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Sheet ${target.placement.sheetKind}/${target.placement.sheetSlug} could not be loaded for modifyConditions.`,
        processedAt,
        { retryable: true, currentState: null },
      ),
    }
  }

  const previousConditions = conditionsSnapshotForSheet(target.placement.sheetKind, sheetResult.sheet)
  const nextConditions = nextConditionsForPayload(previousConditions, command.payload)
  const updated = applyConditionsToSheet(
    target.placement.sheetKind,
    sheetResult.sheet,
    nextConditions,
  )
  const currentConditions = conditionsSnapshotForSheet(target.placement.sheetKind, updated)

  return {
    ok: true,
    sheet: {
      path: sheetResult.path,
      original: sheetResult.sheet,
      updated,
      previousConditions,
      currentConditions,
    },
  }
}

const acceptedOperationAfterBase = (
  operation: SessionOperationRecord,
  baseRevision: SessionRevision,
): boolean => operation.result.status === 'accepted' &&
  compareSessionRevisions(baseRevision, operation.result.currentRevision) === -1

const scopeTouchesTokenConditions = (
  scope: SessionCommandScope,
  tokenId: string,
  mapSlug: SessionMapSlug,
): boolean => {
  const resource = scope.resource
  if (scope.lane !== 'token') return false
  if (scope.field !== MODIFY_CONDITIONS_COMMAND_SCOPE_FIELD) return false
  if (resource?.kind !== 'token') return false
  if (resource.tokenId !== tokenId) return false

  const scopedMapSlug = resource.mapSlug ?? scope.mapSlug
  return scopedMapSlug === undefined || scopedMapSlug === mapSlug
}

const scopeTouchesSheetConditions = (
  scope: SessionCommandScope,
  placement: SheetPlacement,
): boolean => {
  const resource = scope.resource
  return scope.lane === 'sheet' &&
    scope.field === MODIFY_CONDITIONS_COMMAND_SCOPE_FIELD &&
    resource?.kind === 'sheet' &&
    resource.sheetKind === placement.sheetKind &&
    resource.sheetSlug === placement.sheetSlug
}

const operationTouchesModifyConditionsTarget = (
  operation: SessionOperationRecord,
  target: ResolvedModifyConditionsTarget,
): boolean => operation.commandType === MODIFY_CONDITIONS_COMMAND_TYPE &&
  operation.scopes.some((scope) =>
    scopeTouchesTokenConditions(scope, target.placement.id, target.mapSlug) ||
    scopeTouchesSheetConditions(scope, target.placement),
  )

const staleModifyConditionsRejection = (
  command: ModifyConditionsCommand,
  record: ModifyConditionsSessionRecord,
  target: ResolvedModifyConditionsTarget,
  currentState: ModifyConditionsCurrentState,
  processedAt: string,
  tracker: InMemorySessionOperationTracker | false,
): ModifyConditionsRejectedResult | undefined => {
  if (compareSessionRevisions(command.baseRevision, record.revision) !== -1) return undefined

  if (tracker === false) {
    return createStaleRejection(
      command,
      record,
      `Conditions for token ${command.payload.tokenId} may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before modifying them again.`,
      processedAt,
      currentState,
    )
  }

  const acceptedSinceBase = tracker
    .list(command.sessionId)
    .filter((operation) => acceptedOperationAfterBase(operation, command.baseRevision))

  const matchingConditionChange = acceptedSinceBase.find((operation) =>
    operationTouchesModifyConditionsTarget(operation, target),
  )
  if (matchingConditionChange !== undefined) {
    return createStaleRejection(
      command,
      record,
      `Conditions for token ${command.payload.tokenId} changed after revision ${command.baseRevision}.`,
      processedAt,
      currentState,
      matchingConditionChange.scopes,
    )
  }

  const revisionGap = record.revision - command.baseRevision
  if (acceptedSinceBase.length === 0 || revisionGap > tracker.maxRecordsPerSession) {
    return createStaleRejection(
      command,
      record,
      `Conditions for token ${command.payload.tokenId} may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before modifying them again.`,
      processedAt,
      currentState,
    )
  }

  return undefined
}

const noOpConditionsRejection = (
  command: ModifyConditionsCommand,
  record: ModifyConditionsSessionRecord,
  target: ResolvedModifyConditionsTarget,
  sheet: ResolvedModifyConditionsSheet,
  processedAt: string,
): ModifyConditionsRejectedResult | undefined => {
  if (!conditionsValuesEqual(sheet.previousConditions, sheet.currentConditions)) return undefined

  return createConflictRejection(
    command,
    record,
    `Token ${command.payload.tokenId} already has the requested conditions.`,
    processedAt,
    {
      retryable: false,
      currentState: tokenStateFromConditions(
        target.mapSlug,
        target.mapState.revision,
        record.revision,
        target.placement,
        sheet.previousConditions,
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
  command: ModifyConditionsCommand,
  result: ModifyConditionsRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: ModifyConditionsCommand,
  result: ModifyConditionsAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForModifyConditions = (commandInput: unknown): ModifyConditionsCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<ModifyConditionsCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (envelopeValidation.command.type !== MODIFY_CONDITIONS_COMMAND_TYPE) {
      throw new ApplyModifyConditionsCommandUseCaseError(
        400,
        'applyModifyConditionsCommandUseCase only handles modifyConditions command envelopes',
      )
    }

    return envelopeValidation.command
  }

  throw new ApplyModifyConditionsCommandUseCaseError(
    400,
    `modifyConditions command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

const rollbackWrittenSheet = (
  writeSheet: ModifyConditionsSheetWriter,
  path: string,
  original: AnyLiveSheet,
): void => {
  writeSheet(path, persistableSheet(original))
}

export const applyModifyConditionsCommandUseCase = (
  input: ApplyModifyConditionsCommandInput = {},
  dependencies: ApplyModifyConditionsCommandDependencies = {},
): ApplyModifyConditionsCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot
  const readSheet = dependencies.readSheet ?? defaultReadSheet
  const writeSheet = dependencies.writeSheet ?? writeRuntimeSheet

  const envelope = validateEnvelopeForModifyConditions(input.command)
  const record = getActiveModifyConditionsRecord(activeStore, envelope)
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
        result: duplicateCheck.result as ModifyConditionsDuplicateResult,
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

  const commandValidation = validateModifyConditionsCommand(envelope, {
    assignments: record.state.assignments,
  })

  if (!commandValidation.valid) {
    const result = commandValidation.permission?.allowed === false
      ? createUnauthorizedRejection(envelope, record, commandValidation.permission, processedAt)
      : createInvalidRejection(envelope, record, commandValidation.issues, processedAt)

    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const targetResult = resolveModifyConditionsTarget(
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

  const sheetResult = resolveModifyConditionsSheet(
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

  const currentState = tokenStateFromConditions(
    targetResult.target.mapSlug,
    targetResult.target.mapState.revision,
    record.revision,
    targetResult.target.placement,
    sheetResult.sheet.previousConditions,
  )

  const staleRejection = staleModifyConditionsRejection(
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

  const noOpRejection = noOpConditionsRejection(
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
    eventType: MODIFY_CONDITIONS_PATCH_EVENT_TYPE,
    eventPayload: {
      tokenId: targetResult.target.placement.id,
      mapSlug: targetResult.target.mapSlug,
      sheetKind: targetResult.target.placement.sheetKind,
      sheetSlug: targetResult.target.placement.sheetSlug,
      previous: cloneConditionsValueState(sheetResult.sheet.previousConditions),
      current: cloneConditionsValueState(sheetResult.sheet.currentConditions),
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
    throw new ApplyModifyConditionsCommandUseCaseError(
      500,
      `Failed to write modifyConditions sheet update: ${messageFromError(error)}`,
    )
  }

  const updatedRecord = activeStore.setState(record.sessionId, applied.state, {
    revision: applied.currentRevision,
    updatedAt: applied.processedAt,
  })
  if (updatedRecord === undefined) {
    rollbackWrittenSheet(writeSheet, sheetResult.sheet.path, sheetResult.sheet.original)
    throw new ApplyModifyConditionsCommandUseCaseError(
      409,
      'The live session ended before modifyConditions could apply',
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
      throw new ApplyModifyConditionsCommandUseCaseError(
        500,
        `Failed to write modifyConditions session snapshot and failed to roll back sheet update: ${messageFromError(error)}; rollback: ${messageFromError(rollbackError)}`,
      )
    }
    throw new ApplyModifyConditionsCommandUseCaseError(
      500,
      `Failed to write modifyConditions session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  const currentMapState = getSessionMapState(applied.state, targetResult.target.mapSlug)
  const currentPlacement = currentMapState?.document.placements.find(
    (placement) => placement.id === commandValidation.payload.tokenId,
  )
  if (currentMapState === undefined || currentPlacement === undefined) {
    throw new ApplyModifyConditionsCommandUseCaseError(
      500,
      'modifyConditions applied but the target token could not be found in next authoritative state',
    )
  }

  return {
    status: 'accepted',
    session: sessionDetailsFor(updatedRecord),
    command: commandValidation.command,
    result: applied.result,
    patchEvent: applied.patchEvent,
    eventLogEntry: applied.eventLogEntry,
    conditions: tokenStateFromConditions(
      targetResult.target.mapSlug,
      currentMapState.revision,
      applied.currentRevision,
      currentPlacement,
      sheetResult.sheet.currentConditions,
    ),
    previousConditions: tokenStateFromConditions(
      targetResult.target.mapSlug,
      targetResult.target.mapState.revision,
      record.revision,
      targetResult.target.placement,
      sheetResult.sheet.previousConditions,
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
