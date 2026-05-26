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
  MODIFY_COMBAT_STAGES_COMMAND_SCOPE_FIELD,
  MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  SESSION_COMBAT_STAGE_KEYS,
  validateModifyCombatStagesCommand,
  type ModifyCombatStagesCommand,
  type ModifyCombatStagesCommandPayload,
  type SessionCombatStageMap,
} from '#shared/sessionTableActionCommands'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, SheetPlacement, TabletopMapV2 } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  applyCombatStagesToSheet,
  toPersistableSheetPayload,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
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

export class ApplyModifyCombatStagesCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const MODIFY_COMBAT_STAGES_PATCH_EVENT_TYPE = 'combatStagesModified' as const

export type ModifyCombatStagesValueState = SessionCombatStageMap

export interface ModifyCombatStagesCurrentState {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly combatStages: ModifyCombatStagesValueState
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
}

export interface ModifyCombatStagesPatchPayload {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly previous: ModifyCombatStagesValueState
  readonly current: ModifyCombatStagesValueState
}

export type ModifyCombatStagesPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof MODIFY_COMBAT_STAGES_PATCH_EVENT_TYPE,
  ModifyCombatStagesPatchPayload
>

export type ModifyCombatStagesAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  typeof MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  ModifyCombatStagesCommandPayload,
  TabletopMapV2,
  typeof MODIFY_COMBAT_STAGES_PATCH_EVENT_TYPE,
  ModifyCombatStagesPatchPayload
>

export type ModifyCombatStagesRejectedResult = SessionCommandRejectedResult<
  typeof MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  ModifyCombatStagesCurrentState | null,
  SessionRevision
>

export type ModifyCombatStagesDuplicateResult = SessionCommandDuplicateResult<
  typeof MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  SessionRevision
>

export interface ApplyModifyCombatStagesCommandInput {
  readonly command?: unknown
}

export type ApplyModifyCombatStagesCommandClock = () => string
export type ApplyModifyCombatStagesCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export type ModifyCombatStagesSheetReader = (
  kind: SheetKind,
  slug: string,
) => { readonly path: string; readonly sheet: AnyLiveSheet } | null

export type ModifyCombatStagesSheetWriter = (path: string, sheet: Record<string, unknown>) => void

export interface ApplyModifyCombatStagesCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplyModifyCombatStagesCommandClock
  readonly writeSnapshot?: ApplyModifyCombatStagesCommandSnapshotWriter
  readonly readSheet?: ModifyCombatStagesSheetReader
  readonly writeSheet?: ModifyCombatStagesSheetWriter
}

export interface AppliedModifyCombatStagesSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedModifyCombatStagesSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplyModifyCombatStagesAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedModifyCombatStagesSessionDetails
  readonly command: ModifyCombatStagesCommand
  readonly result: ModifyCombatStagesAcceptedApplication['result']
  readonly patchEvent: ModifyCombatStagesPatchEvent
  readonly eventLogEntry: ModifyCombatStagesAcceptedApplication['eventLogEntry']
  readonly combatStages: ModifyCombatStagesCurrentState
  readonly previousCombatStages: ModifyCombatStagesCurrentState
  readonly snapshot: AppliedModifyCombatStagesSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: ModifyCombatStagesAcceptedApplication['mapRevisionChanges']
}

export interface ApplyModifyCombatStagesRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedModifyCombatStagesSessionDetails
  readonly command: ModifyCombatStagesCommand
  readonly result: ModifyCombatStagesRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplyModifyCombatStagesDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedModifyCombatStagesSessionDetails
  readonly command: ModifyCombatStagesCommand
  readonly result: ModifyCombatStagesDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplyModifyCombatStagesCommandUseCaseResult =
  | ApplyModifyCombatStagesAcceptedResult
  | ApplyModifyCombatStagesRejectedResult
  | ApplyModifyCombatStagesDuplicateResult

type ModifyCombatStagesSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedModifyCombatStagesTarget = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
  readonly placement: SheetPlacement
  readonly placementIndex: number
  readonly tokenResource: SessionTokenResourceRef
  readonly sheetResource?: SessionSheetResourceRef
}

type ResolvedModifyCombatStagesSheet = {
  readonly path: string
  readonly original: AnyLiveSheet
  readonly updated: AnyLiveSheet
  readonly previousCombatStages: ModifyCombatStagesValueState
  readonly currentCombatStages: ModifyCombatStagesValueState
}

const defaultClock: ApplyModifyCombatStagesCommandClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const metadataForResult = (
  command: ModifyCombatStagesCommand,
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

const cloneCombatStagesValueState = (
  combatStages: ModifyCombatStagesValueState,
): ModifyCombatStagesValueState => ({
  atk: combatStages.atk,
  def: combatStages.def,
  satk: combatStages.satk,
  sdef: combatStages.sdef,
  spd: combatStages.spd,
  acc: combatStages.acc,
})

const combatStagesSnapshotForSheet = (
  kind: SheetKind,
  sheet: AnyLiveSheet,
): ModifyCombatStagesValueState => {
  const snapshot = kind === 'pokemon'
    ? pokemonHpSnapshot(sheet as CharacterSheet)
    : trainerHpSnapshot(sheet as TrainerSheet)
  return cloneCombatStagesValueState(snapshot.combatStages)
}

const tokenStateFromCombatStages = (
  mapSlug: SessionMapSlug,
  mapRevision: MapRevision,
  sessionRevision: SessionRevision,
  placement: SheetPlacement,
  combatStages: ModifyCombatStagesValueState,
): ModifyCombatStagesCurrentState => ({
  tokenId: placement.id,
  mapSlug,
  sheetKind: placement.sheetKind,
  sheetSlug: placement.sheetSlug,
  combatStages: cloneCombatStagesValueState(combatStages),
  revision: sessionRevision,
  mapRevision,
})

const combatStagesValuesEqual = (
  left: ModifyCombatStagesValueState,
  right: ModifyCombatStagesValueState,
): boolean => SESSION_COMBAT_STAGE_KEYS.every((key) => left[key] === right[key])

const persistableSheet = (sheet: AnyLiveSheet): Record<string, unknown> =>
  toPersistableSheetPayload(sheet as unknown as Record<string, unknown>)

const defaultReadSheet: ModifyCombatStagesSheetReader = (kind, slug) => {
  const result = readSheetFile<AnyLiveSheet>(kind, slug)
  if (result === null) return null
  return {
    path: result.path,
    sheet: result.sheet,
  }
}

const getActiveModifyCombatStagesRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<ModifyCombatStagesCommand, 'sessionId'>,
): ModifyCombatStagesSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplyModifyCombatStagesCommandUseCaseError(
      404,
      'No Track 2 table session was found for the supplied modifyCombatStages command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplyModifyCombatStagesCommandUseCaseError(
      409,
      'The Track 2 table session must be active before modifyCombatStages commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplyModifyCombatStagesCommandUseCaseError(
      500,
      'The Track 2 table session has no authoritative state available for modifyCombatStages commands',
    )
  }

  return record as ModifyCombatStagesSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedModifyCombatStagesSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: ModifyCombatStagesCommand,
  record: ModifyCombatStagesSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<typeof MODIFY_COMBAT_STAGES_COMMAND_TYPE, SessionRevision> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'invalid',
  message: issueSummary(issues) || 'modifyCombatStages command is invalid.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  issues,
  metadata: metadataForResult(command, processedAt),
})

const createUnauthorizedRejection = (
  command: ModifyCombatStagesCommand,
  record: ModifyCombatStagesSessionRecord,
  permission: PermissionDenied | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  typeof MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  ModifyCombatStagesCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'Only the GM or a player assigned to the target token or sheet can modify combat stages in a Track 2 table session.',
  retryable: false,
  sessionId: command.sessionId,
  opId: command.opId,
  commandType: MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  ...(permission === undefined ? {} : { permission }),
  metadata: metadataForResult(command, processedAt),
})

const createConflictRejection = (
  command: ModifyCombatStagesCommand,
  record: ModifyCombatStagesSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly conflictingScopes?: ModifyCombatStagesCommand['scopes']
    readonly currentState?: ModifyCombatStagesCurrentState | null
  } = {},
): SessionCommandConflictRejection<
  typeof MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  ModifyCombatStagesCurrentState | null,
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
  commandType: MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  conflictingScopes: options.conflictingScopes ?? command.scopes,
  ...(options.currentState === undefined ? {} : { currentState: options.currentState }),
  metadata: metadataForResult(command, processedAt),
})

const createStaleRejection = (
  command: ModifyCombatStagesCommand,
  record: ModifyCombatStagesSessionRecord,
  message: string,
  processedAt: string,
  currentState: ModifyCombatStagesCurrentState | null,
  changedScopes: readonly SessionCommandScope[] = command.scopes,
): SessionCommandStaleRejection<
  typeof MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  ModifyCombatStagesCurrentState | null,
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
  commandType: MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  actor: command.actor,
  currentRevision: record.revision,
  scopes: command.scopes,
  baseRevision: command.baseRevision,
  changedScopes,
  currentState,
  metadata: metadataForResult(command, processedAt),
})

const rejectionOutcome = (
  command: ModifyCombatStagesCommand,
  record: ModifyCombatStagesSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: ModifyCombatStagesRejectedResult,
): ApplyModifyCombatStagesRejectedResult => ({
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

const resolveModifyCombatStagesTarget = (
  command: ModifyCombatStagesCommand,
  record: ModifyCombatStagesSessionRecord,
  tokenResource: SessionTokenResourceRef,
  sheetResource: SessionSheetResourceRef | undefined,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedModifyCombatStagesTarget }
  | { readonly ok: false; readonly result: ModifyCombatStagesRejectedResult } => {
  const mapSlug = resolveMapSlug(record.state, tokenResource)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        'modifyCombatStages commands must identify a map or the session must have a selected map.',
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
    throw new ApplyModifyCombatStagesCommandUseCaseError(
      500,
      'modifyCombatStages target placement count and lookup disagreed',
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
        `Token ${command.payload.tokenId} does not match the requested sheet combat-stage scope.`,
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

const resolveModifyCombatStagesSheet = (
  command: ModifyCombatStagesCommand,
  record: ModifyCombatStagesSessionRecord,
  target: ResolvedModifyCombatStagesTarget,
  processedAt: string,
  readSheet: ModifyCombatStagesSheetReader,
):
  | { readonly ok: true; readonly sheet: ResolvedModifyCombatStagesSheet }
  | { readonly ok: false; readonly result: ModifyCombatStagesRejectedResult } => {
  const sheetResult = readSheet(target.placement.sheetKind, target.placement.sheetSlug)
  if (sheetResult === null) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Sheet ${target.placement.sheetKind}/${target.placement.sheetSlug} could not be loaded for modifyCombatStages.`,
        processedAt,
        { retryable: true, currentState: null },
      ),
    }
  }

  const previousCombatStages = combatStagesSnapshotForSheet(target.placement.sheetKind, sheetResult.sheet)
  const updated = applyCombatStagesToSheet(
    target.placement.sheetKind,
    sheetResult.sheet,
    command.payload.stages,
  )
  const currentCombatStages = combatStagesSnapshotForSheet(target.placement.sheetKind, updated)

  return {
    ok: true,
    sheet: {
      path: sheetResult.path,
      original: sheetResult.sheet,
      updated,
      previousCombatStages,
      currentCombatStages,
    },
  }
}

const acceptedOperationAfterBase = (
  operation: SessionOperationRecord,
  baseRevision: SessionRevision,
): boolean => operation.result.status === 'accepted' &&
  compareSessionRevisions(baseRevision, operation.result.currentRevision) === -1

const scopeTouchesTokenCombatStages = (
  scope: SessionCommandScope,
  tokenId: string,
  mapSlug: SessionMapSlug,
): boolean => {
  const resource = scope.resource
  if (scope.lane !== 'token') return false
  if (scope.field !== MODIFY_COMBAT_STAGES_COMMAND_SCOPE_FIELD) return false
  if (resource?.kind !== 'token') return false
  if (resource.tokenId !== tokenId) return false

  const scopedMapSlug = resource.mapSlug ?? scope.mapSlug
  return scopedMapSlug === undefined || scopedMapSlug === mapSlug
}

const scopeTouchesSheetCombatStages = (
  scope: SessionCommandScope,
  placement: SheetPlacement,
): boolean => {
  const resource = scope.resource
  return scope.lane === 'sheet' &&
    scope.field === MODIFY_COMBAT_STAGES_COMMAND_SCOPE_FIELD &&
    resource?.kind === 'sheet' &&
    resource.sheetKind === placement.sheetKind &&
    resource.sheetSlug === placement.sheetSlug
}

const operationTouchesModifyCombatStagesTarget = (
  operation: SessionOperationRecord,
  target: ResolvedModifyCombatStagesTarget,
): boolean => operation.commandType === MODIFY_COMBAT_STAGES_COMMAND_TYPE &&
  operation.scopes.some((scope) =>
    scopeTouchesTokenCombatStages(scope, target.placement.id, target.mapSlug) ||
    scopeTouchesSheetCombatStages(scope, target.placement),
  )

const staleModifyCombatStagesRejection = (
  command: ModifyCombatStagesCommand,
  record: ModifyCombatStagesSessionRecord,
  target: ResolvedModifyCombatStagesTarget,
  currentState: ModifyCombatStagesCurrentState,
  processedAt: string,
  tracker: InMemorySessionOperationTracker | false,
): ModifyCombatStagesRejectedResult | undefined => {
  if (compareSessionRevisions(command.baseRevision, record.revision) !== -1) return undefined

  if (tracker === false) {
    return createStaleRejection(
      command,
      record,
      `Combat stages for token ${command.payload.tokenId} may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before modifying them again.`,
      processedAt,
      currentState,
    )
  }

  const acceptedSinceBase = tracker
    .list(command.sessionId)
    .filter((operation) => acceptedOperationAfterBase(operation, command.baseRevision))

  const matchingCombatStageChange = acceptedSinceBase.find((operation) =>
    operationTouchesModifyCombatStagesTarget(operation, target),
  )
  if (matchingCombatStageChange !== undefined) {
    return createStaleRejection(
      command,
      record,
      `Combat stages for token ${command.payload.tokenId} changed after revision ${command.baseRevision}.`,
      processedAt,
      currentState,
      matchingCombatStageChange.scopes,
    )
  }

  const revisionGap = record.revision - command.baseRevision
  if (acceptedSinceBase.length === 0 || revisionGap > tracker.maxRecordsPerSession) {
    return createStaleRejection(
      command,
      record,
      `Combat stages for token ${command.payload.tokenId} may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before modifying them again.`,
      processedAt,
      currentState,
    )
  }

  return undefined
}

const noOpCombatStagesRejection = (
  command: ModifyCombatStagesCommand,
  record: ModifyCombatStagesSessionRecord,
  target: ResolvedModifyCombatStagesTarget,
  sheet: ResolvedModifyCombatStagesSheet,
  processedAt: string,
): ModifyCombatStagesRejectedResult | undefined => {
  if (!combatStagesValuesEqual(sheet.previousCombatStages, sheet.currentCombatStages)) return undefined

  return createConflictRejection(
    command,
    record,
    `Token ${command.payload.tokenId} already has the requested combat stages.`,
    processedAt,
    {
      retryable: false,
      currentState: tokenStateFromCombatStages(
        target.mapSlug,
        target.mapState.revision,
        record.revision,
        target.placement,
        sheet.previousCombatStages,
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
  command: ModifyCombatStagesCommand,
  result: ModifyCombatStagesRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: ModifyCombatStagesCommand,
  result: ModifyCombatStagesAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForModifyCombatStages = (commandInput: unknown): ModifyCombatStagesCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<ModifyCombatStagesCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (envelopeValidation.command.type !== MODIFY_COMBAT_STAGES_COMMAND_TYPE) {
      throw new ApplyModifyCombatStagesCommandUseCaseError(
        400,
        'applyModifyCombatStagesCommandUseCase only handles modifyCombatStages command envelopes',
      )
    }

    return envelopeValidation.command
  }

  throw new ApplyModifyCombatStagesCommandUseCaseError(
    400,
    `modifyCombatStages command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

const rollbackWrittenSheet = (
  writeSheet: ModifyCombatStagesSheetWriter,
  path: string,
  original: AnyLiveSheet,
): void => {
  writeSheet(path, persistableSheet(original))
}

export const applyModifyCombatStagesCommandUseCase = (
  input: ApplyModifyCombatStagesCommandInput = {},
  dependencies: ApplyModifyCombatStagesCommandDependencies = {},
): ApplyModifyCombatStagesCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot
  const readSheet = dependencies.readSheet ?? defaultReadSheet
  const writeSheet = dependencies.writeSheet ?? writeSheetFile

  const envelope = validateEnvelopeForModifyCombatStages(input.command)
  const record = getActiveModifyCombatStagesRecord(activeStore, envelope)
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
        result: duplicateCheck.result as ModifyCombatStagesDuplicateResult,
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

  const commandValidation = validateModifyCombatStagesCommand(envelope, {
    assignments: record.state.assignments,
  })

  if (!commandValidation.valid) {
    const result = commandValidation.permission?.allowed === false
      ? createUnauthorizedRejection(envelope, record, commandValidation.permission, processedAt)
      : createInvalidRejection(envelope, record, commandValidation.issues, processedAt)

    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const targetResult = resolveModifyCombatStagesTarget(
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

  const sheetResult = resolveModifyCombatStagesSheet(
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

  const currentState = tokenStateFromCombatStages(
    targetResult.target.mapSlug,
    targetResult.target.mapState.revision,
    record.revision,
    targetResult.target.placement,
    sheetResult.sheet.previousCombatStages,
  )

  const staleRejection = staleModifyCombatStagesRejection(
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

  const noOpRejection = noOpCombatStagesRejection(
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
    eventType: MODIFY_COMBAT_STAGES_PATCH_EVENT_TYPE,
    eventPayload: {
      tokenId: targetResult.target.placement.id,
      mapSlug: targetResult.target.mapSlug,
      sheetKind: targetResult.target.placement.sheetKind,
      sheetSlug: targetResult.target.placement.sheetSlug,
      previous: cloneCombatStagesValueState(sheetResult.sheet.previousCombatStages),
      current: cloneCombatStagesValueState(sheetResult.sheet.currentCombatStages),
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
    writeSheet(sheetResult.sheet.path, persistableSheet(sheetResult.sheet.updated))
  } catch (error) {
    throw new ApplyModifyCombatStagesCommandUseCaseError(
      500,
      `Failed to write modifyCombatStages sheet update: ${messageFromError(error)}`,
    )
  }

  const updatedRecord = activeStore.setState(record.sessionId, applied.state, {
    revision: applied.currentRevision,
    updatedAt: applied.processedAt,
  })
  if (updatedRecord === undefined) {
    rollbackWrittenSheet(writeSheet, sheetResult.sheet.path, sheetResult.sheet.original)
    throw new ApplyModifyCombatStagesCommandUseCaseError(
      409,
      'The Track 2 table session ended before modifyCombatStages could apply',
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
      throw new ApplyModifyCombatStagesCommandUseCaseError(
        500,
        `Failed to write modifyCombatStages session snapshot and failed to roll back sheet update: ${messageFromError(error)}; rollback: ${messageFromError(rollbackError)}`,
      )
    }
    throw new ApplyModifyCombatStagesCommandUseCaseError(
      500,
      `Failed to write modifyCombatStages session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  const currentMapState = getSessionMapState(applied.state, targetResult.target.mapSlug)
  const currentPlacement = currentMapState?.document.placements.find(
    (placement) => placement.id === commandValidation.payload.tokenId,
  )
  if (currentMapState === undefined || currentPlacement === undefined) {
    throw new ApplyModifyCombatStagesCommandUseCaseError(
      500,
      'modifyCombatStages applied but the target token could not be found in next authoritative state',
    )
  }

  return {
    status: 'accepted',
    session: sessionDetailsFor(updatedRecord),
    command: commandValidation.command,
    result: applied.result,
    patchEvent: applied.patchEvent,
    eventLogEntry: applied.eventLogEntry,
    combatStages: tokenStateFromCombatStages(
      targetResult.target.mapSlug,
      currentMapState.revision,
      applied.currentRevision,
      currentPlacement,
      sheetResult.sheet.currentCombatStages,
    ),
    previousCombatStages: tokenStateFromCombatStages(
      targetResult.target.mapSlug,
      targetResult.target.mapState.revision,
      record.revision,
      targetResult.target.placement,
      sheetResult.sheet.previousCombatStages,
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
