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
import { type SessionCommandEnvelope, type SessionCommandScope } from '#shared/sessionCommands'
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
  USE_ABILITY_COMMAND_SCOPE_FIELD,
  USE_ABILITY_COMMAND_TYPE,
  USE_MANEUVER_COMMAND_SCOPE_FIELD,
  USE_MANEUVER_COMMAND_TYPE,
  USE_ORDER_COMMAND_SCOPE_FIELD,
  USE_ORDER_COMMAND_TYPE,
  validateUseAbilityCommand,
  validateUseManeuverCommand,
  validateUseOrderCommand,
  type UseAbilityCommand,
  type UseAbilityCommandPayload,
  type UseManeuverCommand,
  type UseManeuverCommandPayload,
  type UseOrderCommand,
  type UseOrderCommandPayload,
} from '#shared/sessionTableActionCommands'
import type { CharacterSheet } from '~/types/characterSheet'
import type { AbilityAutomationCategory } from '~/types/abilityAutomation'
import type { SheetKind, SheetPlacement, TabletopMapV2 } from '~/types/map'
import type { CombatStageMap } from '~/types/combatStages'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  buildLegacyTokenAbilityMenuOptions,
  getLegacyMapAbilityAutomation as getMapAbilityAutomation,
  resolveLegacyMapAbilityAutomationTransaction as resolveMapAbilityAutomationTransaction,
  type LegacyTokenAbilityMenuOption,
} from '../domain/abilityAutomation/legacyCompatibility'
import { applyAa065CrushTrapGrappleTrigger } from '../domain/abilityAutomation/mechanics/aa065ManeuverIntegration'
import { cleanupAa065CrueltyHealingBlockForBreather } from '../domain/abilityAutomation/mechanics/aa065StaticIntegration'
import { appendAbilityAutomationLogEntry } from '~/utils/abilityAutomationLog'
import {
  appendActiveOrderEffect,
  createActiveOrderEffect,
  type ActiveOrderEffect,
} from '~/utils/activeOrderEffects'
import { abilityEntriesForPlacement } from '~/utils/mapTokenAbilities'
import {
  referenceManeuverOptions,
  trainerManeuverOptionsForSheet,
  type TokenManeuverMenuOption,
} from '~/utils/mapTokenManeuvers'
import {
  trainerOrderOptionsForSheet,
  type TokenOrderMenuOption,
} from '~/utils/mapTokenOrders'
import {
  appendManeuverLogEntry,
  buildManeuverUseLogLines,
} from '~/utils/maneuverLog'
import {
  appendOrderLogEntry,
  buildOrderUseLogLines,
} from '~/utils/orderLog'
import {
  applyAbilityActivationToSheet,
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import {
  catalogEntryForPokemonSheet,
  catalogEntryForTrainerSheet,
  pokemonHpSnapshot,
  trainerHpSnapshot,
} from '~/utils/sheetSpawn'
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

export class ApplyUseTableActionCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const USE_MANEUVER_PATCH_EVENT_TYPE = 'maneuverUsed' as const
export const USE_ABILITY_PATCH_EVENT_TYPE = 'abilityUsed' as const
export const USE_ORDER_PATCH_EVENT_TYPE = 'orderUsed' as const

export type UseTableActionCommand =
  | UseManeuverCommand
  | UseAbilityCommand
  | UseOrderCommand

export type UseTableActionPayload =
  | UseManeuverCommandPayload
  | UseAbilityCommandPayload
  | UseOrderCommandPayload

export type UseTableActionCommandType = UseTableActionCommand['type']

export interface UseTableActionMetadataSummary {
  readonly maneuverLogCount: number
  readonly abilityLogCount: number
  readonly orderLogCount: number
  readonly activeOrderEffectCount: number
}

export interface UseTableActionCurrentState {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly actionType: UseTableActionCommandType
  readonly actionName: string
  readonly targetTokenId?: string
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
  readonly metadata: UseTableActionMetadataSummary
}

export interface UseManeuverPatchPayload {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly maneuverName: string
  readonly targetTokenId?: string
  readonly targetName?: string
  readonly logLines: readonly string[]
}

export interface UseAbilityPatchPayload {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly abilityName: string
  readonly category: AbilityAutomationCategory
  readonly targetTokenId?: string
  readonly targetName?: string
  readonly activated?: boolean
  readonly combatStageUpdates: readonly { readonly tokenId: string; readonly stages: CombatStageMap }[]
  readonly conditionUpdates: readonly { readonly tokenId: string; readonly conditions: readonly string[] }[]
  readonly logLines: readonly string[]
}

export interface UseOrderPatchPayload {
  readonly tokenId: string
  readonly mapSlug: SessionMapSlug
  readonly sheetKind: Extract<SheetKind, 'trainer'>
  readonly sheetSlug: string
  readonly orderName: string
  readonly targetTokenId?: string
  readonly targetName?: string
  readonly activeEffect?: ActiveOrderEffect
  readonly logLines: readonly string[]
}

export type UseManeuverPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof USE_MANEUVER_PATCH_EVENT_TYPE,
  UseManeuverPatchPayload
>

export type UseAbilityPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof USE_ABILITY_PATCH_EVENT_TYPE,
  UseAbilityPatchPayload
>

export type UseOrderPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof USE_ORDER_PATCH_EVENT_TYPE,
  UseOrderPatchPayload
>

export type UseTableActionPatchEvent =
  | UseManeuverPatchEvent
  | UseAbilityPatchEvent
  | UseOrderPatchEvent

export type UseTableActionAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  UseTableActionCommandType,
  UseTableActionPayload,
  TabletopMapV2,
  typeof USE_MANEUVER_PATCH_EVENT_TYPE | typeof USE_ABILITY_PATCH_EVENT_TYPE | typeof USE_ORDER_PATCH_EVENT_TYPE,
  UseManeuverPatchPayload | UseAbilityPatchPayload | UseOrderPatchPayload
>

export type UseTableActionRejectedResult = SessionCommandRejectedResult<
  UseTableActionCommandType,
  UseTableActionCurrentState | null,
  SessionRevision
>

export type UseTableActionDuplicateResult = SessionCommandDuplicateResult<
  UseTableActionCommandType,
  SessionRevision
>

export interface ApplyUseTableActionCommandInput {
  readonly command?: unknown
}

export type ApplyUseTableActionCommandClock = () => string
export type ApplyUseTableActionCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export type UseTableActionSheetReader = (
  kind: SheetKind,
  slug: string,
) => { readonly path: string; readonly sheet: AnyLiveSheet } | null

export type UseTableActionSheetWriter = (path: string, sheet: AnyLiveSheet) => void

export interface ApplyUseTableActionCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplyUseTableActionCommandClock
  readonly writeSnapshot?: ApplyUseTableActionCommandSnapshotWriter
  readonly readSheet?: UseTableActionSheetReader
  readonly writeSheet?: UseTableActionSheetWriter
}

export interface AppliedUseTableActionSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedUseTableActionSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplyUseTableActionAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedUseTableActionSessionDetails
  readonly command: UseTableActionCommand
  readonly result: UseTableActionAcceptedApplication['result']
  readonly patchEvent: UseTableActionPatchEvent
  readonly eventLogEntry: UseTableActionAcceptedApplication['eventLogEntry']
  readonly action: UseTableActionCurrentState
  readonly previousAction: UseTableActionCurrentState
  readonly snapshot: AppliedUseTableActionSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: UseTableActionAcceptedApplication['mapRevisionChanges']
}

export interface ApplyUseTableActionRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedUseTableActionSessionDetails
  readonly command: UseTableActionCommand
  readonly result: UseTableActionRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplyUseTableActionDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedUseTableActionSessionDetails
  readonly command: UseTableActionCommand
  readonly result: UseTableActionDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplyUseTableActionCommandUseCaseResult =
  | ApplyUseTableActionAcceptedResult
  | ApplyUseTableActionRejectedResult
  | ApplyUseTableActionDuplicateResult

type UseTableActionSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedUseTableActionTarget = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
  readonly placement: SheetPlacement
  readonly tokenResource: SessionTokenResourceRef
  readonly sheetResource?: SessionSheetResourceRef
}

type ResolvedActionToken = Pick<
  SpawnedPokemon,
  'id' | 'species' | 'position' | 'base' | 'clearance' | 'sheetKind' | 'sheetSlug' | 'combatStages' | 'conditions'
>

type SheetCacheEntry = {
  readonly kind: SheetKind
  readonly slug: string
  readonly path: string
  readonly sheet: AnyLiveSheet
}

type SheetWritePlan = {
  readonly kind: SheetKind
  readonly slug: string
  readonly path: string
  readonly original: AnyLiveSheet
  next: AnyLiveSheet
}

type UseTableActionApplicationPlan = {
  readonly mapDocument: TabletopMapV2
  readonly eventType: typeof USE_MANEUVER_PATCH_EVENT_TYPE | typeof USE_ABILITY_PATCH_EVENT_TYPE | typeof USE_ORDER_PATCH_EVENT_TYPE
  readonly eventPayload: UseManeuverPatchPayload | UseAbilityPatchPayload | UseOrderPatchPayload
  readonly writePlans: readonly SheetWritePlan[]
}

const defaultClock: ApplyUseTableActionCommandClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const metadataForResult = (
  command: UseTableActionCommand,
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

const cloneSheetResource = (resource: SessionSheetResourceRef): SessionSheetResourceRef => ({
  ...resource,
})

const actionNameForCommand = (command: UseTableActionCommand): string => {
  if (command.type === USE_MANEUVER_COMMAND_TYPE) return command.payload.maneuverName
  if (command.type === USE_ABILITY_COMMAND_TYPE) return command.payload.abilityName
  return command.payload.orderName
}

const targetTokenIdForCommand = (command: UseTableActionCommand): string | undefined =>
  command.payload.targetTokenId

const scopeFieldForCommandType = (type: UseTableActionCommandType): string => {
  if (type === USE_MANEUVER_COMMAND_TYPE) return USE_MANEUVER_COMMAND_SCOPE_FIELD
  if (type === USE_ABILITY_COMMAND_TYPE) return USE_ABILITY_COMMAND_SCOPE_FIELD
  return USE_ORDER_COMMAND_SCOPE_FIELD
}

const metadataSummary = (metadata: Record<string, unknown> | undefined): UseTableActionMetadataSummary => ({
  maneuverLogCount: Array.isArray(metadata?.maneuverLog) ? metadata.maneuverLog.length : 0,
  abilityLogCount: Array.isArray(metadata?.abilityLog) ? metadata.abilityLog.length : 0,
  orderLogCount: Array.isArray(metadata?.orderLog) ? metadata.orderLog.length : 0,
  activeOrderEffectCount: Array.isArray(metadata?.activeOrderEffects) ? metadata.activeOrderEffects.length : 0,
})

const useTableActionStateFromTarget = (
  command: UseTableActionCommand,
  target: ResolvedUseTableActionTarget,
  revision: SessionRevision,
): UseTableActionCurrentState => ({
  tokenId: target.placement.id,
  mapSlug: target.mapSlug,
  sheetKind: target.placement.sheetKind,
  sheetSlug: target.placement.sheetSlug,
  actionType: command.type,
  actionName: actionNameForCommand(command),
  ...(targetTokenIdForCommand(command) === undefined ? {} : { targetTokenId: targetTokenIdForCommand(command) }),
  revision,
  mapRevision: target.mapState.revision,
  metadata: metadataSummary(target.mapState.document.metadata),
})

const defaultReadSheet: UseTableActionSheetReader = (kind, slug) => {
  const result = readRuntimeSheet<AnyLiveSheet>(kind, slug)
  if (result === null) return null
  return {
    path: result.path,
    sheet: result.sheet,
  }
}

const getActiveUseTableActionRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<UseTableActionCommand, 'sessionId'>,
): UseTableActionSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplyUseTableActionCommandUseCaseError(
      404,
      'No live session was found for the supplied table action command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplyUseTableActionCommandUseCaseError(
      409,
      'The live session must be active before table action commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplyUseTableActionCommandUseCaseError(
      500,
      'The live session has no authoritative state available for table action commands',
    )
  }

  return record as UseTableActionSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedUseTableActionSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: UseTableActionCommand,
  record: UseTableActionSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<UseTableActionCommandType, SessionRevision> => ({
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
  command: UseTableActionCommand,
  record: UseTableActionSessionRecord,
  permission: PermissionDenied | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  UseTableActionCommandType,
  UseTableActionCurrentState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'Only the GM or a player assigned to the acting token or sheet can use this table action in a live session.',
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
  command: UseTableActionCommand,
  record: UseTableActionSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly conflictingScopes?: UseTableActionCommand['scopes']
    readonly currentState?: UseTableActionCurrentState | null
  } = {},
): SessionCommandConflictRejection<
  UseTableActionCommandType,
  UseTableActionCurrentState | null,
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
  command: UseTableActionCommand,
  record: UseTableActionSessionRecord,
  message: string,
  processedAt: string,
  currentState: UseTableActionCurrentState | null,
  changedScopes: readonly SessionCommandScope[] = command.scopes,
): SessionCommandStaleRejection<
  UseTableActionCommandType,
  UseTableActionCurrentState | null,
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
  command: UseTableActionCommand,
  record: UseTableActionSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: UseTableActionRejectedResult,
): ApplyUseTableActionRejectedResult => ({
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

const resolveUseTableActionTarget = (
  command: UseTableActionCommand,
  record: UseTableActionSessionRecord,
  tokenResource: SessionTokenResourceRef,
  sheetResource: SessionSheetResourceRef | undefined,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedUseTableActionTarget }
  | { readonly ok: false; readonly result: UseTableActionRejectedResult } => {
  const mapSlug = resolveMapSlug(record.state, tokenResource)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `${command.type} commands must identify a map or the session must have a selected map.`,
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
    throw new ApplyUseTableActionCommandUseCaseError(
      500,
      `${command.type} target placement count and lookup disagreed`,
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
        `Token ${command.payload.tokenId} does not match the requested sheet ${command.type} scope.`,
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
      ...(sheetResource === undefined ? {} : { sheetResource: cloneSheetResource(sheetResource) }),
    },
  }
}

const acceptedOperationAfterBase = (
  operation: SessionOperationRecord,
  baseRevision: SessionRevision,
): boolean => operation.result.status === 'accepted' &&
  compareSessionRevisions(baseRevision, operation.result.currentRevision) === -1

const scopeTouchesActionToken = (
  scope: SessionCommandScope,
  tokenId: string,
  mapSlug: SessionMapSlug,
  field: string,
): boolean => {
  const resource = scope.resource
  if (scope.lane !== 'token') return false
  if (scope.field !== field) return false
  if (resource?.kind !== 'token') return false
  if (resource.tokenId !== tokenId) return false

  const scopedMapSlug = resource.mapSlug ?? scope.mapSlug
  return scopedMapSlug === undefined || scopedMapSlug === mapSlug
}

const scopeTouchesActionSheet = (
  scope: SessionCommandScope,
  placement: SheetPlacement,
  field: string,
): boolean => {
  const resource = scope.resource
  return scope.lane === 'sheet' &&
    scope.field === field &&
    resource?.kind === 'sheet' &&
    resource.sheetKind === placement.sheetKind &&
    resource.sheetSlug === placement.sheetSlug
}

const operationTouchesUseTableActionTarget = (
  operation: SessionOperationRecord,
  target: ResolvedUseTableActionTarget,
  commandType: UseTableActionCommandType,
): boolean => {
  if (operation.commandType !== commandType) return false
  const field = scopeFieldForCommandType(commandType)
  return operation.scopes.some((scope) =>
    scopeTouchesActionToken(scope, target.placement.id, target.mapSlug, field) ||
    scopeTouchesActionSheet(scope, target.placement, field),
  )
}

const staleUseTableActionRejection = (
  command: UseTableActionCommand,
  record: UseTableActionSessionRecord,
  target: ResolvedUseTableActionTarget,
  currentState: UseTableActionCurrentState,
  processedAt: string,
  tracker: InMemorySessionOperationTracker | false,
): UseTableActionRejectedResult | undefined => {
  if (compareSessionRevisions(command.baseRevision, record.revision) !== -1) return undefined

  if (tracker === false) {
    return createStaleRejection(
      command,
      record,
      `${command.type} for token ${command.payload.tokenId} may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before using it again.`,
      processedAt,
      currentState,
    )
  }

  const acceptedSinceBase = tracker
    .list(command.sessionId)
    .filter((operation) => acceptedOperationAfterBase(operation, command.baseRevision))

  const matchingActionChange = acceptedSinceBase.find((operation) =>
    operationTouchesUseTableActionTarget(operation, target, command.type),
  )
  if (matchingActionChange !== undefined) {
    return createStaleRejection(
      command,
      record,
      `${command.type} for token ${command.payload.tokenId} changed after revision ${command.baseRevision}.`,
      processedAt,
      currentState,
      matchingActionChange.scopes,
    )
  }

  const revisionGap = record.revision - command.baseRevision
  if (acceptedSinceBase.length === 0 || revisionGap > tracker.maxRecordsPerSession) {
    return createStaleRejection(
      command,
      record,
      `${command.type} for token ${command.payload.tokenId} may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before using it again.`,
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

const sheetKey = (kind: SheetKind, slug: string): string => `${kind}:${slug}`

const makeSheetCache = (readSheet: UseTableActionSheetReader) => {
  const cache = new Map<string, SheetCacheEntry | null>()
  return (kind: SheetKind, slug: string): SheetCacheEntry | null => {
    const key = sheetKey(kind, slug)
    if (cache.has(key)) return cache.get(key) ?? null
    const result = readSheet(kind, slug)
    const entry = result === null
      ? null
      : { kind, slug, path: result.path, sheet: result.sheet }
    cache.set(key, entry)
    return entry
  }
}

const readSheetMapsForMap = (
  placements: readonly SheetPlacement[],
  getSheet: (kind: SheetKind, slug: string) => SheetCacheEntry | null,
): { readonly pokemon: Map<string, CharacterSheet>; readonly trainer: Map<string, TrainerSheet> } => {
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const placement of placements) {
    const entry = getSheet(placement.sheetKind, placement.sheetSlug)
    if (entry === null) continue
    if (entry.kind === 'pokemon') pokemon.set(entry.slug, entry.sheet as CharacterSheet)
    else trainer.set(entry.slug, entry.sheet as TrainerSheet)
  }
  return { pokemon, trainer }
}

const sheetDisplayName = (kind: SheetKind, sheet: AnyLiveSheet): string => {
  if (kind === 'pokemon') {
    const pokemon = sheet as CharacterSheet
    return nonEmptyString(pokemon.nickname) ?? nonEmptyString(pokemon.species) ?? nonEmptyString(pokemon.slug) ?? 'Pokémon'
  }
  const trainer = sheet as TrainerSheet
  return nonEmptyString(trainer.name) ?? nonEmptyString(trainer.slug) ?? 'Trainer'
}

const tokenFromPlacement = (
  placement: SheetPlacement,
  entry: SheetCacheEntry,
): ResolvedActionToken => {
  if (placement.sheetKind === 'pokemon') {
    const sheet = entry.sheet as CharacterSheet
    const snapshot = pokemonHpSnapshot(sheet)
    const footprint = catalogEntryForPokemonSheet(sheet)
    return {
      id: placement.id,
      species: sheetDisplayName('pokemon', sheet),
      position: placement.position,
      base: footprint?.base ?? 1,
      clearance: footprint?.clearance ?? 1,
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      combatStages: snapshot.combatStages,
      conditions: snapshot.conditions,
    }
  }

  const sheet = entry.sheet as TrainerSheet
  const snapshot = trainerHpSnapshot(sheet)
  const footprint = catalogEntryForTrainerSheet(sheet)
  return {
    id: placement.id,
    species: sheetDisplayName('trainer', sheet),
    position: placement.position,
    base: footprint?.base ?? 1,
    clearance: footprint?.clearance ?? 1,
    sheetKind: placement.sheetKind,
    sheetSlug: placement.sheetSlug,
    combatStages: snapshot.combatStages,
    conditions: snapshot.conditions,
  }
}

const resolveActionToken = (
  command: UseTableActionCommand,
  record: UseTableActionSessionRecord,
  placement: SheetPlacement,
  processedAt: string,
  getSheet: (kind: SheetKind, slug: string) => SheetCacheEntry | null,
):
  | { readonly ok: true; readonly token: ResolvedActionToken; readonly sheet: SheetCacheEntry }
  | { readonly ok: false; readonly result: UseTableActionRejectedResult } => {
  const entry = getSheet(placement.sheetKind, placement.sheetSlug)
  if (entry === null) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Sheet ${placement.sheetKind}/${placement.sheetSlug} could not be loaded for ${command.type}.`,
        processedAt,
        { retryable: true, currentState: null },
      ),
    }
  }

  return {
    ok: true,
    token: tokenFromPlacement(placement, entry),
    sheet: entry,
  }
}

const resolveOptionalTargetToken = (
  command: UseTableActionCommand,
  record: UseTableActionSessionRecord,
  target: ResolvedUseTableActionTarget,
  processedAt: string,
  getSheet: (kind: SheetKind, slug: string) => SheetCacheEntry | null,
):
  | { readonly ok: true; readonly token?: ResolvedActionToken; readonly placement?: SheetPlacement; readonly sheet?: SheetCacheEntry }
  | { readonly ok: false; readonly result: UseTableActionRejectedResult } => {
  const targetTokenId = targetTokenIdForCommand(command)
  if (targetTokenId === undefined) return { ok: true }

  if (targetTokenId === command.payload.tokenId) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `${command.type} targetTokenId must refer to a different token than the acting token.`,
        processedAt,
        { retryable: false, currentState: useTableActionStateFromTarget(command, target, record.revision) },
      ),
    }
  }

  const placementCount = countTokenPlacements(target.mapState, targetTokenId)
  if (placementCount !== 1) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        placementCount === 0
          ? `Target token ${targetTokenId} is not present on map ${target.mapSlug}.`
          : `Target token ${targetTokenId} has duplicate placements on map ${target.mapSlug}.`,
        processedAt,
        { retryable: placementCount === 0, currentState: useTableActionStateFromTarget(command, target, record.revision) },
      ),
    }
  }

  const targetPlacement = findTokenPlacement(target.mapState, targetTokenId)
  if (targetPlacement === undefined) {
    throw new ApplyUseTableActionCommandUseCaseError(
      500,
      `${command.type} target placement count and lookup disagreed`,
    )
  }

  const resolved = resolveActionToken(command, record, targetPlacement, processedAt, getSheet)
  if (!resolved.ok) return resolved
  return {
    ok: true,
    token: resolved.token,
    placement: targetPlacement,
    sheet: resolved.sheet,
  }
}

const optionMatchesName = (optionName: string, requestedName: string): boolean =>
  optionName.trim().toLocaleLowerCase() === requestedName.trim().toLocaleLowerCase()

const resolveManeuverOption = (
  placement: SheetPlacement,
  sheet: SheetCacheEntry,
  requestedName: string,
): TokenManeuverMenuOption | null => {
  const options = placement.sheetKind === 'trainer'
    ? trainerManeuverOptionsForSheet(sheet.sheet as TrainerSheet)
    : referenceManeuverOptions()
  return options.find((option) => optionMatchesName(option.name, requestedName)) ?? null
}

const resolveAbilityOption = (
  placement: SheetPlacement,
  sheetMaps: { readonly pokemon: Map<string, CharacterSheet>; readonly trainer: Map<string, TrainerSheet> },
  requestedName: string,
): LegacyTokenAbilityMenuOption | null => {
  const entries = abilityEntriesForPlacement(placement, sheetMaps)
  const options = buildLegacyTokenAbilityMenuOptions(entries)
  return options.find((option) => optionMatchesName(option.name, requestedName)) ?? null
}

const resolveOrderOption = (
  placement: SheetPlacement,
  sheet: SheetCacheEntry,
  requestedName: string,
): TokenOrderMenuOption | null => {
  if (placement.sheetKind !== 'trainer') return null
  const options = trainerOrderOptionsForSheet(sheet.sheet as TrainerSheet)
  return options.find((option) => optionMatchesName(option.name, requestedName)) ?? null
}

const addOrUpdateWritePlan = (
  plans: Map<string, SheetWritePlan>,
  entry: SheetCacheEntry,
  update: (kind: SheetKind, sheet: AnyLiveSheet) => AnyLiveSheet,
): void => {
  const key = sheetKey(entry.kind, entry.slug)
  const existing = plans.get(key)
  if (existing !== undefined) {
    existing.next = update(entry.kind, existing.next)
    return
  }

  plans.set(key, {
    kind: entry.kind,
    slug: entry.slug,
    path: entry.path,
    original: entry.sheet,
    next: update(entry.kind, entry.sheet),
  })
}

const applyCombatStageUpdatePlan = (
  plans: Map<string, SheetWritePlan>,
  entry: SheetCacheEntry,
  stages: CombatStageMap,
): void => {
  addOrUpdateWritePlan(plans, entry, (kind, sheet) => applyCombatStagesToSheet(kind, sheet, stages))
}

const applyConditionUpdatePlan = (
  plans: Map<string, SheetWritePlan>,
  entry: SheetCacheEntry,
  conditions: readonly string[],
): void => {
  addOrUpdateWritePlan(plans, entry, (kind, sheet) => applyConditionsToSheet(kind, sheet, [...conditions]))
}

const applyAbilityActivationPlan = (
  plans: Map<string, SheetWritePlan>,
  entry: SheetCacheEntry,
  abilityName: string,
): void => {
  addOrUpdateWritePlan(plans, entry, (kind, sheet) => applyAbilityActivationToSheet(kind, sheet, abilityName))
}

const useManeuverPlan = (
  command: UseManeuverCommand,
  record: UseTableActionSessionRecord,
  target: ResolvedUseTableActionTarget,
  user: ResolvedActionToken,
  userSheet: SheetCacheEntry,
  targetToken: ResolvedActionToken | undefined,
  processedAt: string,
):
  | { readonly ok: true; readonly plan: UseTableActionApplicationPlan }
  | { readonly ok: false; readonly result: UseTableActionRejectedResult } => {
  const maneuver = resolveManeuverOption(target.placement, userSheet, command.payload.maneuverName)
  if (maneuver === null) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Maneuver ${command.payload.maneuverName} is not available to token ${command.payload.tokenId}.`,
        processedAt,
        { retryable: false, currentState: useTableActionStateFromTarget(command, target, record.revision) },
      ),
    }
  }

  const logLines = buildManeuverUseLogLines(user, maneuver, { target: targetToken ?? null })
  const metadata = appendManeuverLogEntry(target.mapState.document.metadata, {
    userId: user.id,
    userName: user.species,
    maneuverName: maneuver.name,
    lines: logLines,
  }, {
    now: () => Date.parse(processedAt),
  })

  const mapWithMetadata = { ...target.mapState.document, metadata }
  const mapAfterBreather = maneuver.name === 'Take a Breather'
    ? cleanupAa065CrueltyHealingBlockForBreather({
        map: mapWithMetadata,
        placementId: target.placement.id,
      })
    : mapWithMetadata
  const mapWithAbilityTrigger = maneuver.name === 'Grapple' && targetToken
    ? applyAa065CrushTrapGrappleTrigger({
        map: mapAfterBreather,
        actorPlacement: target.placement,
        actorToken: user,
        actorSheet: userSheet.sheet as CharacterSheet,
        targetToken,
        operationId: command.opId,
      })
    : mapAfterBreather
  return {
    ok: true,
    plan: {
      mapDocument: touchedMapDocument(mapWithAbilityTrigger, processedAt),
      eventType: USE_MANEUVER_PATCH_EVENT_TYPE,
      eventPayload: {
        tokenId: target.placement.id,
        mapSlug: target.mapSlug,
        sheetKind: target.placement.sheetKind,
        sheetSlug: target.placement.sheetSlug,
        maneuverName: maneuver.name,
        ...(targetToken === undefined ? {} : { targetTokenId: targetToken.id, targetName: targetToken.species }),
        logLines,
      },
      writePlans: [],
    },
  }
}

const useAbilityPlan = (
  command: UseAbilityCommand,
  record: UseTableActionSessionRecord,
  target: ResolvedUseTableActionTarget,
  user: ResolvedActionToken,
  userSheet: SheetCacheEntry,
  targetToken: ResolvedActionToken | undefined,
  targetSheet: SheetCacheEntry | undefined,
  sheetMaps: { readonly pokemon: Map<string, CharacterSheet>; readonly trainer: Map<string, TrainerSheet> },
  processedAt: string,
):
  | { readonly ok: true; readonly plan: UseTableActionApplicationPlan }
  | { readonly ok: false; readonly result: UseTableActionRejectedResult } => {
  const option = resolveAbilityOption(target.placement, sheetMaps, command.payload.abilityName)
  if (option === null) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Ability ${command.payload.abilityName} is not present on token ${command.payload.tokenId}'s sheet.`,
        processedAt,
        { retryable: false, currentState: useTableActionStateFromTarget(command, target, record.revision) },
      ),
    }
  }

  if (option.automation === null) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Ability ${option.name} does not have a live session automation boundary yet.`,
        processedAt,
        { retryable: false, currentState: useTableActionStateFromTarget(command, target, record.revision) },
      ),
    }
  }

  if (option.automation.category === 'passive') {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Ability ${option.name} is passive and cannot be used as an active session command.`,
        processedAt,
        { retryable: false, currentState: useTableActionStateFromTarget(command, target, record.revision) },
      ),
    }
  }

  const writePlans = new Map<string, SheetWritePlan>()
  let logLines: readonly string[]
  let category: AbilityAutomationCategory = option.automation.category
  const combatStageUpdates: { tokenId: string; stages: CombatStageMap }[] = []
  const conditionUpdates: { tokenId: string; conditions: readonly string[] }[] = []
  let activated: boolean | undefined

  if (option.automation.category === 'sheet') {
    if (option.activated) {
      return {
        ok: false,
        result: createConflictRejection(
          command,
          record,
          `Ability ${option.name} is already active on token ${command.payload.tokenId}.`,
          processedAt,
          { retryable: false, currentState: useTableActionStateFromTarget(command, target, record.revision) },
        ),
      }
    }

    applyAbilityActivationPlan(writePlans, userSheet, option.name)
    activated = true
    logLines = [`${user.species} activated ${option.name}.`]
  } else {
    const mapAutomation = getMapAbilityAutomation(option.name)
    if (mapAutomation?.targetMode === 'target' && targetToken === undefined) {
      return {
        ok: false,
        result: createConflictRejection(
          command,
          record,
          `Ability ${option.name} requires a target token.`,
          processedAt,
          { retryable: false, currentState: useTableActionStateFromTarget(command, target, record.revision) },
        ),
      }
    }

    const transaction = resolveMapAbilityAutomationTransaction({
      abilityName: option.name,
      user: user as SpawnedPokemon,
      ...(targetToken === undefined ? {} : { target: targetToken as SpawnedPokemon }),
      fieldEffects: target.mapState.document.fieldEffects,
    })
    if (transaction === null) {
      return {
        ok: false,
        result: createConflictRejection(
          command,
          record,
          `Ability ${option.name} could not produce a valid session automation transaction.`,
          processedAt,
          { retryable: false, currentState: useTableActionStateFromTarget(command, target, record.revision) },
        ),
      }
    }

    category = transaction.category
    logLines = transaction.logLines
    for (const update of transaction.combatStageUpdates) {
      const updatePlacement = findTokenPlacement(target.mapState, update.id)
      const updateSheet = update.id === user.id ? userSheet : update.id === targetToken?.id ? targetSheet : undefined
      if (updatePlacement === undefined || updateSheet === undefined) {
        return {
          ok: false,
          result: createConflictRejection(
            command,
            record,
            `Ability ${option.name} references combat-stage target ${update.id}, but that target is not available.`,
            processedAt,
            { retryable: true, currentState: useTableActionStateFromTarget(command, target, record.revision) },
          ),
        }
      }
      applyCombatStageUpdatePlan(writePlans, updateSheet, update.stages)
      combatStageUpdates.push({ tokenId: update.id, stages: update.stages })
    }

    for (const update of transaction.conditionUpdates) {
      const updatePlacement = findTokenPlacement(target.mapState, update.id)
      const updateSheet = update.id === user.id ? userSheet : update.id === targetToken?.id ? targetSheet : undefined
      if (updatePlacement === undefined || updateSheet === undefined) {
        return {
          ok: false,
          result: createConflictRejection(
            command,
            record,
            `Ability ${option.name} references condition target ${update.id}, but that target is not available.`,
            processedAt,
            { retryable: true, currentState: useTableActionStateFromTarget(command, target, record.revision) },
          ),
        }
      }
      applyConditionUpdatePlan(writePlans, updateSheet, update.conditions)
      conditionUpdates.push({ tokenId: update.id, conditions: [...update.conditions] })
    }
  }

  const metadata = appendAbilityAutomationLogEntry(target.mapState.document.metadata, {
    userId: user.id,
    userName: user.species,
    abilityName: option.name,
    category,
    combatStageUpdates: combatStageUpdates.map((update) => ({ id: update.tokenId, stages: update.stages })),
    conditionUpdates: conditionUpdates.map((update) => ({ id: update.tokenId, conditions: [...update.conditions] })),
    logLines: [...logLines],
  }, {
    now: () => Date.parse(processedAt),
  })

  return {
    ok: true,
    plan: {
      mapDocument: touchedMapDocument({ ...target.mapState.document, metadata }, processedAt),
      eventType: USE_ABILITY_PATCH_EVENT_TYPE,
      eventPayload: {
        tokenId: target.placement.id,
        mapSlug: target.mapSlug,
        sheetKind: target.placement.sheetKind,
        sheetSlug: target.placement.sheetSlug,
        abilityName: option.name,
        category,
        ...(targetToken === undefined ? {} : { targetTokenId: targetToken.id, targetName: targetToken.species }),
        ...(activated === undefined ? {} : { activated }),
        combatStageUpdates,
        conditionUpdates,
        logLines,
      },
      writePlans: [...writePlans.values()],
    },
  }
}

const orderTargetLabel = (order: TokenOrderMenuOption): string | null => {
  const explicit = order.target?.trim()
  if (explicit) return explicit
  if (order.tags.some((tag) => /^training$/i.test(tag))) return 'Your Pokémon'
  return null
}

const currentOrderTimeline = (map: TabletopMapV2): { readonly activeId: string | null; readonly round: number } => {
  const n = Math.floor(Number(map.initiative?.round ?? 1))
  return {
    activeId: map.initiative?.activeId ?? null,
    round: Number.isFinite(n) && n > 0 ? n : 1,
  }
}

const useOrderPlan = (
  command: UseOrderCommand,
  record: UseTableActionSessionRecord,
  target: ResolvedUseTableActionTarget,
  user: ResolvedActionToken,
  userSheet: SheetCacheEntry,
  targetToken: ResolvedActionToken | undefined,
  processedAt: string,
):
  | { readonly ok: true; readonly plan: UseTableActionApplicationPlan }
  | { readonly ok: false; readonly result: UseTableActionRejectedResult } => {
  if (target.placement.sheetKind !== 'trainer') {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Order ${command.payload.orderName} can only be used by trainer tokens.`,
        processedAt,
        { retryable: false, currentState: useTableActionStateFromTarget(command, target, record.revision) },
      ),
    }
  }

  const order = resolveOrderOption(target.placement, userSheet, command.payload.orderName)
  if (order === null) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Order ${command.payload.orderName} is not available to trainer token ${command.payload.tokenId}.`,
        processedAt,
        { retryable: false, currentState: useTableActionStateFromTarget(command, target, record.revision) },
      ),
    }
  }

  if (orderTargetLabel(order) !== null && targetToken === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `Order ${order.name} requires a target token.`,
        processedAt,
        { retryable: false, currentState: useTableActionStateFromTarget(command, target, record.revision) },
      ),
    }
  }

  const activeEffect = createActiveOrderEffect({
    user,
    order,
    target: targetToken ?? null,
    timeline: currentOrderTimeline(target.mapState.document),
    idFactory: () => `ord-${command.opId}`,
  })

  const logLines = buildOrderUseLogLines(user, order, {
    target: targetToken ?? null,
    activeEffect,
  })
  let metadata = target.mapState.document.metadata
  if (activeEffect) metadata = appendActiveOrderEffect(metadata, activeEffect)
  metadata = appendOrderLogEntry(metadata, {
    userId: user.id,
    userName: user.species,
    orderName: order.name,
    lines: logLines,
  }, {
    now: () => Date.parse(processedAt),
  })

  return {
    ok: true,
    plan: {
      mapDocument: touchedMapDocument({ ...target.mapState.document, metadata }, processedAt),
      eventType: USE_ORDER_PATCH_EVENT_TYPE,
      eventPayload: {
        tokenId: target.placement.id,
        mapSlug: target.mapSlug,
        sheetKind: 'trainer',
        sheetSlug: target.placement.sheetSlug,
        orderName: order.name,
        ...(targetToken === undefined ? {} : { targetTokenId: targetToken.id, targetName: targetToken.species }),
        ...(activeEffect === null ? {} : { activeEffect }),
        logLines,
      },
      writePlans: [],
    },
  }
}

const planUseTableActionApplication = (
  command: UseTableActionCommand,
  record: UseTableActionSessionRecord,
  target: ResolvedUseTableActionTarget,
  processedAt: string,
  readSheet: UseTableActionSheetReader,
):
  | { readonly ok: true; readonly plan: UseTableActionApplicationPlan }
  | { readonly ok: false; readonly result: UseTableActionRejectedResult } => {
  const getSheet = makeSheetCache(readSheet)
  const userResult = resolveActionToken(command, record, target.placement, processedAt, getSheet)
  if (!userResult.ok) return userResult

  const targetResult = resolveOptionalTargetToken(command, record, target, processedAt, getSheet)
  if (!targetResult.ok) return targetResult

  if (command.type === USE_MANEUVER_COMMAND_TYPE) {
    return useManeuverPlan(
      command,
      record,
      target,
      userResult.token,
      userResult.sheet,
      targetResult.token,
      processedAt,
    )
  }

  if (command.type === USE_ABILITY_COMMAND_TYPE) {
    const sheetMaps = readSheetMapsForMap(target.mapState.document.placements, getSheet)
    return useAbilityPlan(
      command,
      record,
      target,
      userResult.token,
      userResult.sheet,
      targetResult.token,
      targetResult.sheet,
      sheetMaps,
      processedAt,
    )
  }

  return useOrderPlan(
    command,
    record,
    target,
    userResult.token,
    userResult.sheet,
    targetResult.token,
    processedAt,
  )
}

const rememberRejectedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: UseTableActionCommand,
  result: UseTableActionRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: UseTableActionCommand,
  result: UseTableActionAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForUseTableAction = (commandInput: unknown): UseTableActionCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<UseTableActionCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (
      envelopeValidation.command.type !== USE_MANEUVER_COMMAND_TYPE &&
      envelopeValidation.command.type !== USE_ABILITY_COMMAND_TYPE &&
      envelopeValidation.command.type !== USE_ORDER_COMMAND_TYPE
    ) {
      throw new ApplyUseTableActionCommandUseCaseError(
        400,
        'applyUseTableActionCommandUseCase only handles useManeuver, useAbility, or useOrder command envelopes',
      )
    }

    return envelopeValidation.command
  }

  throw new ApplyUseTableActionCommandUseCaseError(
    400,
    `table action command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

const validateCommandSpecifics = (
  command: UseTableActionCommand,
  assignments: AuthoritativeSessionState<TabletopMapV2>['assignments'],
):
  | { readonly valid: true; readonly command: UseTableActionCommand; readonly tokenResource: SessionTokenResourceRef; readonly sheetResource?: SessionSheetResourceRef }
  | { readonly valid: false; readonly issues: readonly SessionCommandValidationIssue[]; readonly permission?: PermissionDenied } => {
  if (command.type === USE_MANEUVER_COMMAND_TYPE) {
    const result = validateUseManeuverCommand(command, { assignments })
    if (!result.valid) return result
    return {
      valid: true,
      command: result.command,
      tokenResource: result.tokenResource,
      ...(result.sheetResource === undefined ? {} : { sheetResource: result.sheetResource }),
    }
  }

  if (command.type === USE_ABILITY_COMMAND_TYPE) {
    const result = validateUseAbilityCommand(command, { assignments })
    if (!result.valid) return result
    return {
      valid: true,
      command: result.command,
      tokenResource: result.tokenResource,
      ...(result.sheetResource === undefined ? {} : { sheetResource: result.sheetResource }),
    }
  }

  const result = validateUseOrderCommand(command, { assignments })
  if (!result.valid) return result
  return {
    valid: true,
    command: result.command,
    tokenResource: result.tokenResource,
    ...(result.sheetResource === undefined ? {} : { sheetResource: result.sheetResource }),
  }
}

const writePlannedSheets = (
  writeSheet: UseTableActionSheetWriter,
  plans: readonly SheetWritePlan[],
): void => {
  for (const plan of plans) {
    writeSheet(
      plan.path,
      toNextRevisionSheetPayload(stripDerivedSheetFields(plan.next) as AnyLiveSheet) as unknown as AnyLiveSheet,
    )
  }
}

const rollbackWrittenSheets = (
  writeSheet: UseTableActionSheetWriter,
  plans: readonly SheetWritePlan[],
): void => {
  for (const plan of [...plans].reverse()) {
    writeSheet(plan.path, stripDerivedSheetFields(plan.original) as AnyLiveSheet)
  }
}

export const applyUseTableActionCommandUseCase = (
  input: ApplyUseTableActionCommandInput = {},
  dependencies: ApplyUseTableActionCommandDependencies = {},
): ApplyUseTableActionCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot
  const readSheet = dependencies.readSheet ?? defaultReadSheet
  const writeSheet = dependencies.writeSheet ?? (writeRuntimeSheet as unknown as UseTableActionSheetWriter)

  const envelope = validateEnvelopeForUseTableAction(input.command)
  const record = getActiveUseTableActionRecord(activeStore, envelope)
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
        result: duplicateCheck.result as UseTableActionDuplicateResult,
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

  const commandValidation = validateCommandSpecifics(envelope, record.state.assignments)

  if (!commandValidation.valid) {
    const result = commandValidation.permission?.allowed === false
      ? createUnauthorizedRejection(envelope, record, commandValidation.permission, processedAt)
      : createInvalidRejection(envelope, record, commandValidation.issues, processedAt)

    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const targetResult = resolveUseTableActionTarget(
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

  const currentState = useTableActionStateFromTarget(
    commandValidation.command,
    targetResult.target,
    record.revision,
  )

  const staleRejection = staleUseTableActionRejection(
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

  const planned = planUseTableActionApplication(
    commandValidation.command,
    record,
    targetResult.target,
    processedAt,
    readSheet,
  )

  if (!planned.ok) {
    rememberRejectedResult(tracker, envelope, planned.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, planned.result)
  }

  const applied = applyAcceptedSessionCommandEffect({
    state: record.state,
    command: commandValidation.command as unknown as SessionCommandEnvelope<
      UseTableActionCommandType,
      UseTableActionPayload,
      UseTableActionCommand['actor'],
      SessionRevision
    >,
    eventType: planned.plan.eventType,
    eventPayload: planned.plan.eventPayload,
    mapEffects: [
      {
        mapSlug: targetResult.target.mapSlug,
        document: planned.plan.mapDocument,
      },
    ],
  }, {
    processedAt,
  })

  try {
    writePlannedSheets(writeSheet, planned.plan.writePlans)
  } catch (error) {
    throw new ApplyUseTableActionCommandUseCaseError(
      500,
      `Failed to write ${commandValidation.command.type} sheet update: ${messageFromError(error)}`,
    )
  }

  const updatedRecord = activeStore.setState(record.sessionId, applied.state, {
    revision: applied.currentRevision,
    updatedAt: applied.processedAt,
  })
  if (updatedRecord === undefined) {
    if (planned.plan.writePlans.length > 0) rollbackWrittenSheets(writeSheet, planned.plan.writePlans)
    throw new ApplyUseTableActionCommandUseCaseError(
      409,
      `The live session ended before ${commandValidation.command.type} could apply`,
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
    if (planned.plan.writePlans.length > 0) {
      try {
        rollbackWrittenSheets(writeSheet, planned.plan.writePlans)
      } catch (rollbackError) {
        throw new ApplyUseTableActionCommandUseCaseError(
          500,
          `Failed to write ${commandValidation.command.type} session snapshot and failed to roll back sheet update: ${messageFromError(error)}; rollback: ${messageFromError(rollbackError)}`,
        )
      }
    }
    throw new ApplyUseTableActionCommandUseCaseError(
      500,
      `Failed to write ${commandValidation.command.type} session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  const currentMapState = getSessionMapState(applied.state, targetResult.target.mapSlug)
  const currentPlacement = currentMapState?.document.placements.find(
    (placement) => placement.id === commandValidation.command.payload.tokenId,
  )
  if (currentMapState === undefined || currentPlacement === undefined) {
    throw new ApplyUseTableActionCommandUseCaseError(
      500,
      `${commandValidation.command.type} applied but the target token could not be found in next authoritative state`,
    )
  }

  const targetAfter: ResolvedUseTableActionTarget = {
    ...targetResult.target,
    mapState: currentMapState,
    placement: currentPlacement,
  }

  return {
    status: 'accepted',
    session: sessionDetailsFor(updatedRecord),
    command: commandValidation.command,
    result: applied.result,
    patchEvent: applied.patchEvent as UseTableActionPatchEvent,
    eventLogEntry: applied.eventLogEntry,
    action: useTableActionStateFromTarget(commandValidation.command, targetAfter, applied.currentRevision),
    previousAction: useTableActionStateFromTarget(commandValidation.command, targetResult.target, record.revision),
    snapshot: {
      writtenAt: snapshot.snapshot.writtenAt,
      revision: snapshot.snapshot.revision,
    },
    record: updatedRecord,
    state: applied.state,
    mapRevisionChanges: applied.mapRevisionChanges,
  }
}
