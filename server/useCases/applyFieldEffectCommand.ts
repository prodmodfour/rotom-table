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
  FIELD_EFFECT_COMMAND_SCOPE_FIELD,
  FIELD_EFFECT_COMMAND_TYPES,
  REMOVE_FIELD_EFFECT_COMMAND_TYPE,
  SET_FIELD_EFFECT_COMMAND_TYPE,
  TICK_FIELD_EFFECT_DURATIONS_COMMAND_TYPE,
  validateFieldEffectCommand,
  type FieldEffectCommand,
  type FieldEffectCommandPayload,
  type FieldEffectCommandType,
  type RemoveFieldEffectCommandPayload,
  type SessionFieldEffectCategory,
  type SessionFieldEffectKind,
  type SetFieldEffectCommandPayload,
  type TickFieldEffectDurationsCommandPayload,
} from '#shared/sessionFieldEffectCommands'
import type { SessionId } from '#shared/sessionIdentity'
import type { PermissionDenied } from '#shared/sessionPermissions'
import { compareSessionRevisions, type MapRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  getSessionMapState,
  type AuthoritativeSessionMapState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import type {
  MapFieldEffects,
  MapRoomEffect,
  MapRoomKind,
  MapTerrainEffect,
  MapTerrainKind,
  MapWeatherEffect,
  MapWeatherKind,
  TabletopMapV2,
} from '~/types/map'
import {
  createMapRoomEffect,
  createMapTerrainEffect,
  createMapWeatherEffect,
  normalizeMapFieldEffects,
} from '~/utils/mapFieldEffects'
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

export class ApplyFieldEffectCommandUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const FIELD_EFFECTS_UPDATED_PATCH_EVENT_TYPE = 'fieldEffectsUpdated' as const

export interface FieldEffectsState {
  readonly mapSlug: SessionMapSlug
  readonly fieldEffects: MapFieldEffects
  readonly revision: SessionRevision
  readonly mapRevision: MapRevision
}

export interface FieldEffectsPatchPayload {
  readonly mapSlug: SessionMapSlug
  readonly command: FieldEffectCommandType
  readonly previous: MapFieldEffects
  readonly current: MapFieldEffects
  readonly category?: SessionFieldEffectCategory | 'all'
  readonly kind?: SessionFieldEffectKind
  readonly tickAmount?: number
}

export type FieldEffectsPatchEvent = AcceptedSessionCommandPatchEvent<
  typeof FIELD_EFFECTS_UPDATED_PATCH_EVENT_TYPE,
  FieldEffectsPatchPayload
>

export type FieldEffectAcceptedApplication = ApplyAcceptedSessionCommandEffectResult<
  FieldEffectCommandType,
  FieldEffectCommandPayload,
  TabletopMapV2,
  typeof FIELD_EFFECTS_UPDATED_PATCH_EVENT_TYPE,
  FieldEffectsPatchPayload
>

export type FieldEffectRejectedResult = SessionCommandRejectedResult<
  FieldEffectCommandType,
  FieldEffectsState | null,
  SessionRevision
>

export type FieldEffectDuplicateResult = SessionCommandDuplicateResult<
  FieldEffectCommandType,
  SessionRevision
>

export interface ApplyFieldEffectCommandInput {
  readonly command?: unknown
}

export type ApplyFieldEffectCommandClock = () => string
export type ApplyFieldEffectCommandSnapshotWriter = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  options?: WriteSessionSnapshotOptions<TabletopMapV2>,
) => WriteSessionSnapshotResult<TabletopMapV2>

export interface ApplyFieldEffectCommandDependencies {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>
  readonly operationTracker?: InMemorySessionOperationTracker | false
  readonly clock?: ApplyFieldEffectCommandClock
  readonly writeSnapshot?: ApplyFieldEffectCommandSnapshotWriter
}

export interface AppliedFieldEffectSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AppliedFieldEffectSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface ApplyFieldEffectAcceptedResult {
  readonly status: 'accepted'
  readonly session: AppliedFieldEffectSessionDetails
  readonly command: FieldEffectCommand
  readonly result: FieldEffectAcceptedApplication['result']
  readonly patchEvent: FieldEffectsPatchEvent
  readonly eventLogEntry: FieldEffectAcceptedApplication['eventLogEntry']
  readonly previousFieldEffects: FieldEffectsState
  readonly fieldEffects: FieldEffectsState
  readonly snapshot: AppliedFieldEffectSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
  readonly mapRevisionChanges: FieldEffectAcceptedApplication['mapRevisionChanges']
}

export interface ApplyFieldEffectRejectedResult {
  readonly status: 'rejected'
  readonly session: AppliedFieldEffectSessionDetails
  readonly command: FieldEffectCommand
  readonly result: FieldEffectRejectedResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export interface ApplyFieldEffectDuplicateResult {
  readonly status: 'duplicate'
  readonly session: AppliedFieldEffectSessionDetails
  readonly command: FieldEffectCommand
  readonly result: FieldEffectDuplicateResult
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

export type ApplyFieldEffectCommandUseCaseResult =
  | ApplyFieldEffectAcceptedResult
  | ApplyFieldEffectRejectedResult
  | ApplyFieldEffectDuplicateResult

type FieldEffectSessionRecord = SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>> & {
  readonly state: AuthoritativeSessionState<TabletopMapV2>
}

type ResolvedFieldEffectMap = {
  readonly mapSlug: SessionMapSlug
  readonly mapState: AuthoritativeSessionMapState<TabletopMapV2>
}

type FieldEffectMapChange = {
  readonly document: TabletopMapV2
  readonly previous: MapFieldEffects
  readonly current: MapFieldEffects
  readonly category?: SessionFieldEffectCategory | 'all'
  readonly kind?: SessionFieldEffectKind
  readonly tickAmount?: number
}

const defaultClock: ApplyFieldEffectCommandClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const metadataForResult = (
  command: FieldEffectCommand,
  processedAt: string,
): SessionCommandResultMetadata => ({
  serverProcessedAt: processedAt,
  ...(command.metadata?.traceId === undefined ? {} : { traceId: command.metadata.traceId }),
})

const issueSummary = (issues: readonly SessionCommandValidationIssue[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const cloneWeatherEffect = (effect: MapWeatherEffect): MapWeatherEffect => ({
  kind: effect.kind,
  ...(effect.rounds === undefined ? {} : { rounds: effect.rounds }),
  ...(effect.source === undefined ? {} : { source: effect.source }),
})

const cloneTerrainEffect = (effect: MapTerrainEffect): MapTerrainEffect => ({
  kind: effect.kind,
  ...(effect.scope === undefined ? {} : { scope: effect.scope }),
  ...(effect.rounds === undefined ? {} : { rounds: effect.rounds }),
  ...(effect.source === undefined ? {} : { source: effect.source }),
})

const cloneRoomEffect = (effect: MapRoomEffect): MapRoomEffect => ({
  kind: effect.kind,
  ...(effect.rounds === undefined ? {} : { rounds: effect.rounds }),
  ...(effect.startsNextRound === undefined ? {} : { startsNextRound: effect.startsNextRound }),
  ...(effect.source === undefined ? {} : { source: effect.source }),
})

const cloneFieldEffects = (effects: MapFieldEffects | null | undefined): Required<MapFieldEffects> => {
  const normalized = normalizeMapFieldEffects(effects)
  return {
    weather: (normalized.weather ?? []).map(cloneWeatherEffect),
    terrains: (normalized.terrains ?? []).map(cloneTerrainEffect),
    rooms: (normalized.rooms ?? []).map(cloneRoomEffect),
  }
}

const fieldEffectsEqual = (
  left: MapFieldEffects,
  right: MapFieldEffects,
): boolean => JSON.stringify(cloneFieldEffects(left)) === JSON.stringify(cloneFieldEffects(right))

const currentFieldEffectsState = (
  mapSlug: SessionMapSlug,
  mapState: AuthoritativeSessionMapState<TabletopMapV2>,
  sessionRevision: SessionRevision,
): FieldEffectsState => ({
  mapSlug,
  fieldEffects: cloneFieldEffects(mapState.document.fieldEffects),
  revision: sessionRevision,
  mapRevision: mapState.revision,
})

const getActiveFieldEffectRecord = (
  store: InMemorySessionStore<AuthoritativeSessionState<TabletopMapV2>>,
  command: Pick<FieldEffectCommand, 'sessionId'>,
): FieldEffectSessionRecord => {
  const record = store.get(command.sessionId)
  if (record === undefined) {
    throw new ApplyFieldEffectCommandUseCaseError(
      404,
      'No live session was found for the supplied field-effect command',
    )
  }

  if (record.status !== 'active') {
    throw new ApplyFieldEffectCommandUseCaseError(
      409,
      'The live session must be active before field-effect commands can apply',
    )
  }

  if (record.state === undefined) {
    throw new ApplyFieldEffectCommandUseCaseError(
      500,
      'The live session has no authoritative state available for field-effect commands',
    )
  }

  return record as FieldEffectSessionRecord
}

const sessionDetailsFor = (
  record: SessionStoreRecord<AuthoritativeSessionState<TabletopMapV2>>,
): AppliedFieldEffectSessionDetails => ({
  sessionId: record.sessionId,
  status: record.status,
  revision: record.revision,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

const createInvalidRejection = (
  command: FieldEffectCommand,
  record: FieldEffectSessionRecord,
  issues: readonly SessionCommandValidationIssue[],
  processedAt: string,
): SessionCommandInvalidRejection<FieldEffectCommandType, SessionRevision> => ({
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
  command: FieldEffectCommand,
  record: FieldEffectSessionRecord,
  permission: PermissionDenied | undefined,
  processedAt: string,
): SessionCommandUnauthorizedRejection<
  FieldEffectCommandType,
  FieldEffectsState | null,
  SessionRevision
> => ({
  schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  status: 'rejected',
  accepted: false,
  reason: 'unauthorized',
  message: permission?.message ?? 'Only the GM can manage field effects in a live session.',
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
  command: FieldEffectCommand,
  record: FieldEffectSessionRecord,
  message: string,
  processedAt: string,
  options: {
    readonly retryable?: boolean
    readonly currentState?: FieldEffectsState | null
    readonly conflictingScopes?: FieldEffectCommand['scopes']
  } = {},
): SessionCommandConflictRejection<
  FieldEffectCommandType,
  FieldEffectsState | null,
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
  command: FieldEffectCommand,
  record: FieldEffectSessionRecord,
  message: string,
  processedAt: string,
  currentState: FieldEffectsState | null,
  changedScopes: readonly SessionCommandScope[] = command.scopes,
): SessionCommandStaleRejection<
  FieldEffectCommandType,
  FieldEffectsState | null,
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
  command: FieldEffectCommand,
  record: FieldEffectSessionRecord,
  state: AuthoritativeSessionState<TabletopMapV2>,
  result: FieldEffectRejectedResult,
): ApplyFieldEffectRejectedResult => ({
  status: 'rejected',
  session: sessionDetailsFor(record),
  command,
  result,
  record,
  state,
})

const mapSlugFromCommand = (
  state: AuthoritativeSessionState<TabletopMapV2>,
  command: FieldEffectCommand,
  validationMapSlug: string | undefined,
): SessionMapSlug | undefined => {
  if (validationMapSlug !== undefined) return validationMapSlug
  if (command.payload.mapSlug !== undefined) return command.payload.mapSlug
  const scopedMapSlug = command.scopes.find(
    (scope) => scope.lane === 'field-effect' && scope.field === FIELD_EFFECT_COMMAND_SCOPE_FIELD,
  )?.mapSlug
  return scopedMapSlug ?? state.selectedMapSlug ?? undefined
}

const resolveFieldEffectMap = (
  command: FieldEffectCommand,
  record: FieldEffectSessionRecord,
  validationMapSlug: string | undefined,
  processedAt: string,
):
  | { readonly ok: true; readonly target: ResolvedFieldEffectMap }
  | { readonly ok: false; readonly result: FieldEffectRejectedResult } => {
  const mapSlug = mapSlugFromCommand(record.state, command, validationMapSlug)
  if (mapSlug === undefined) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        'Field-effect commands must identify a map or the session must have a selected map.',
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

const scopeTouchesFieldEffectMap = (
  scope: SessionCommandScope,
  mapSlug: SessionMapSlug,
): boolean => {
  if (scope.lane !== 'field-effect') return false
  if (scope.field !== undefined && scope.field !== FIELD_EFFECT_COMMAND_SCOPE_FIELD) return false
  return scope.mapSlug === undefined || scope.mapSlug === mapSlug
}

const operationTouchesFieldEffectTarget = (
  operation: SessionOperationRecord,
  target: ResolvedFieldEffectMap,
): boolean => operation.scopes.some((scope) => scopeTouchesFieldEffectMap(scope, target.mapSlug))

const staleFieldEffectRejection = (
  command: FieldEffectCommand,
  record: FieldEffectSessionRecord,
  target: ResolvedFieldEffectMap,
  processedAt: string,
  tracker: InMemorySessionOperationTracker | false,
): FieldEffectRejectedResult | undefined => {
  if (compareSessionRevisions(command.baseRevision, record.revision) !== -1) return undefined

  const currentState = currentFieldEffectsState(
    target.mapSlug,
    target.mapState,
    record.revision,
  )

  if (tracker === false) {
    return createStaleRejection(
      command,
      record,
      `Field effects may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before changing field effects.`,
      processedAt,
      currentState,
    )
  }

  const acceptedSinceBase = tracker
    .list(command.sessionId)
    .filter((operation) => acceptedOperationAfterBase(operation, command.baseRevision))

  const matchingFieldEffectChange = acceptedSinceBase.find((operation) =>
    operationTouchesFieldEffectTarget(operation, target),
  )
  if (matchingFieldEffectChange !== undefined) {
    return createStaleRejection(
      command,
      record,
      `Field effects changed after revision ${command.baseRevision}.`,
      processedAt,
      currentState,
      matchingFieldEffectChange.scopes,
    )
  }

  const revisionGap = record.revision - command.baseRevision
  if (acceptedSinceBase.length === 0 || revisionGap > tracker.maxRecordsPerSession) {
    return createStaleRejection(
      command,
      record,
      `Field effects may have changed after revision ${command.baseRevision}; refresh from revision ${record.revision} before changing field effects.`,
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

const setEffectSource = <TEffect extends { source?: string }>(
  effect: TEffect,
  source: string | undefined,
): TEffect => source === undefined ? effect : { ...effect, source }

const weatherEffectFromPayload = (payload: SetFieldEffectCommandPayload): MapWeatherEffect => {
  const effect = createMapWeatherEffect(payload.kind as MapWeatherKind)
  if (payload.rounds !== undefined) effect.rounds = payload.rounds
  return setEffectSource(effect, payload.source)
}

const terrainEffectFromPayload = (payload: SetFieldEffectCommandPayload): MapTerrainEffect => {
  const effect = createMapTerrainEffect(payload.kind as MapTerrainKind)
  if (payload.rounds !== undefined) effect.rounds = payload.rounds
  if (payload.terrainScope !== undefined) effect.scope = payload.terrainScope
  return setEffectSource(effect, payload.source)
}

const roomEffectFromPayload = (payload: SetFieldEffectCommandPayload): MapRoomEffect => {
  const effect = createMapRoomEffect(payload.kind as MapRoomKind)
  if (payload.rounds !== undefined) effect.rounds = payload.rounds
  if (payload.startsNextRound !== undefined) effect.startsNextRound = payload.startsNextRound
  return setEffectSource(effect, payload.source)
}

const withFieldEffectsOnMap = (
  mapState: AuthoritativeSessionMapState<TabletopMapV2>,
  fieldEffects: MapFieldEffects,
  processedAt: string,
): TabletopMapV2 => mapWithUpdatedAt({
  ...mapState.document,
  fieldEffects: cloneFieldEffects(fieldEffects),
}, processedAt)

const setFieldEffectOnMap = (
  command: FieldEffectCommand,
  payload: SetFieldEffectCommandPayload,
  record: FieldEffectSessionRecord,
  target: ResolvedFieldEffectMap,
  processedAt: string,
):
  | { readonly ok: true; readonly change: FieldEffectMapChange }
  | { readonly ok: false; readonly result: FieldEffectRejectedResult } => {
  const previous = cloneFieldEffects(target.mapState.document.fieldEffects)
  const current = cloneFieldEffects(previous)

  if (payload.rounds === 0) {
    if (payload.category === 'weather') {
      current.weather = current.weather.filter((effect) => effect.kind !== payload.kind)
    } else if (payload.category === 'terrain') {
      current.terrains = current.terrains.filter((effect) => effect.kind !== payload.kind)
    } else {
      current.rooms = current.rooms.filter((effect) => effect.kind !== payload.kind)
    }
  } else if (payload.category === 'weather') {
    const effect = weatherEffectFromPayload(payload)
    if (payload.weatherMode === 'append') {
      current.weather = [...current.weather.filter((item) => item.kind !== effect.kind), effect]
        .slice(-2)
    } else {
      current.weather = [effect]
    }
  } else if (payload.category === 'terrain') {
    const effect = terrainEffectFromPayload(payload)
    current.terrains = [...current.terrains.filter((item) => item.kind !== effect.kind), effect]
  } else {
    const effect = roomEffectFromPayload(payload)
    current.rooms = [...current.rooms.filter((item) => item.kind !== effect.kind), effect]
  }

  if (fieldEffectsEqual(previous, current)) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        payload.rounds === 0
          ? `${payload.category} effect ${payload.kind} is not active on map ${target.mapSlug}.`
          : `${payload.category} effect ${payload.kind} is already current on map ${target.mapSlug}.`,
        processedAt,
        {
          retryable: false,
          currentState: currentFieldEffectsState(target.mapSlug, target.mapState, record.revision),
        },
      ),
    }
  }

  return {
    ok: true,
    change: {
      previous,
      current,
      category: payload.category,
      kind: payload.kind,
      document: withFieldEffectsOnMap(target.mapState, current, processedAt),
    },
  }
}

const removeFieldEffectFromMap = (
  command: FieldEffectCommand,
  payload: RemoveFieldEffectCommandPayload,
  record: FieldEffectSessionRecord,
  target: ResolvedFieldEffectMap,
  processedAt: string,
):
  | { readonly ok: true; readonly change: FieldEffectMapChange }
  | { readonly ok: false; readonly result: FieldEffectRejectedResult } => {
  const previous = cloneFieldEffects(target.mapState.document.fieldEffects)
  const current = cloneFieldEffects(previous)

  if (payload.category === 'all') {
    current.weather = []
    current.terrains = []
    current.rooms = []
  } else if (payload.category === 'weather') {
    current.weather = payload.kind === undefined
      ? []
      : current.weather.filter((effect) => effect.kind !== payload.kind)
  } else if (payload.category === 'terrain') {
    current.terrains = payload.kind === undefined
      ? []
      : current.terrains.filter((effect) => effect.kind !== payload.kind)
  } else {
    current.rooms = payload.kind === undefined
      ? []
      : current.rooms.filter((effect) => effect.kind !== payload.kind)
  }

  if (fieldEffectsEqual(previous, current)) {
    const label = payload.category === 'all'
      ? 'No field effects are active'
      : payload.kind === undefined
        ? `No ${payload.category} field effects are active`
        : `${payload.category} effect ${payload.kind} is not active`
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `${label} on map ${target.mapSlug}.`,
        processedAt,
        {
          retryable: true,
          currentState: currentFieldEffectsState(target.mapSlug, target.mapState, record.revision),
        },
      ),
    }
  }

  return {
    ok: true,
    change: {
      previous,
      current,
      category: payload.category,
      ...(payload.kind === undefined ? {} : { kind: payload.kind }),
      document: withFieldEffectsOnMap(target.mapState, current, processedAt),
    },
  }
}

const tickEffects = <TEffect extends { rounds?: number | null }>(
  effects: readonly TEffect[],
  amount: number,
  clone: (effect: TEffect) => TEffect,
): TEffect[] => {
  const next: TEffect[] = []
  for (const effect of effects) {
    if (effect.rounds === null || effect.rounds === undefined) {
      next.push(clone(effect))
      continue
    }
    const rounds = Math.max(0, effect.rounds - amount)
    if (rounds > 0) next.push({ ...clone(effect), rounds })
  }
  return next
}

const tickFieldEffectDurationsOnMap = (
  command: FieldEffectCommand,
  payload: TickFieldEffectDurationsCommandPayload,
  record: FieldEffectSessionRecord,
  target: ResolvedFieldEffectMap,
  processedAt: string,
):
  | { readonly ok: true; readonly change: FieldEffectMapChange }
  | { readonly ok: false; readonly result: FieldEffectRejectedResult } => {
  const amount = payload.amount ?? 1
  const previous = cloneFieldEffects(target.mapState.document.fieldEffects)
  const current: Required<MapFieldEffects> = {
    weather: tickEffects(previous.weather, amount, cloneWeatherEffect),
    terrains: tickEffects(previous.terrains, amount, cloneTerrainEffect),
    rooms: tickEffects(previous.rooms, amount, cloneRoomEffect),
  }

  if (fieldEffectsEqual(previous, current)) {
    return {
      ok: false,
      result: createConflictRejection(
        command,
        record,
        `No finite field-effect durations changed on map ${target.mapSlug}.`,
        processedAt,
        {
          retryable: true,
          currentState: currentFieldEffectsState(target.mapSlug, target.mapState, record.revision),
        },
      ),
    }
  }

  return {
    ok: true,
    change: {
      previous,
      current,
      tickAmount: amount,
      document: withFieldEffectsOnMap(target.mapState, current, processedAt),
    },
  }
}

const applyFieldEffectChange = (
  command: FieldEffectCommand,
  record: FieldEffectSessionRecord,
  target: ResolvedFieldEffectMap,
  processedAt: string,
):
  | { readonly ok: true; readonly change: FieldEffectMapChange }
  | { readonly ok: false; readonly result: FieldEffectRejectedResult } => {
  if (command.type === SET_FIELD_EFFECT_COMMAND_TYPE) {
    return setFieldEffectOnMap(command, command.payload, record, target, processedAt)
  }
  if (command.type === REMOVE_FIELD_EFFECT_COMMAND_TYPE) {
    return removeFieldEffectFromMap(command, command.payload, record, target, processedAt)
  }
  return tickFieldEffectDurationsOnMap(command, command.payload, record, target, processedAt)
}

const rememberRejectedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: FieldEffectCommand,
  result: FieldEffectRejectedResult,
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const rememberAcceptedResult = (
  tracker: InMemorySessionOperationTracker | false,
  command: FieldEffectCommand,
  result: FieldEffectAcceptedApplication['result'],
  processedAt: string,
): void => {
  if (tracker === false) return
  tracker.rememberResult(command, result, { recordedAt: processedAt })
}

const validateEnvelopeForFieldEffect = (commandInput: unknown): FieldEffectCommand => {
  const envelopeValidation = validateSessionCommandEnvelope<FieldEffectCommand>(commandInput)
  if (envelopeValidation.valid) {
    if (!(FIELD_EFFECT_COMMAND_TYPES as readonly string[]).includes(envelopeValidation.command.type)) {
      throw new ApplyFieldEffectCommandUseCaseError(
        400,
        'applyFieldEffectCommandUseCase only handles field-effect command envelopes',
      )
    }
    return envelopeValidation.command
  }

  throw new ApplyFieldEffectCommandUseCaseError(
    400,
    `field-effect command envelope is malformed: ${issueSummary(envelopeValidation.issues)}`,
  )
}

export const applyFieldEffectCommandUseCase = (
  input: ApplyFieldEffectCommandInput = {},
  dependencies: ApplyFieldEffectCommandDependencies = {},
): ApplyFieldEffectCommandUseCaseResult => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TabletopMapV2>
  >)
  const tracker = dependencies.operationTracker ?? sessionOperationTracker
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot

  const envelope = validateEnvelopeForFieldEffect(input.command)
  const record = getActiveFieldEffectRecord(activeStore, envelope)
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
        result: duplicateCheck.result as FieldEffectDuplicateResult,
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

  const commandValidation = validateFieldEffectCommand(envelope)
  if (!commandValidation.valid) {
    const result = commandValidation.permission?.allowed === false
      ? createUnauthorizedRejection(envelope, record, commandValidation.permission, processedAt)
      : createInvalidRejection(envelope, record, commandValidation.issues, processedAt)

    rememberRejectedResult(tracker, envelope, result, processedAt)
    return rejectionOutcome(envelope, record, record.state, result)
  }

  const targetResult = resolveFieldEffectMap(
    commandValidation.command,
    record,
    commandValidation.mapSlug,
    processedAt,
  )
  if (!targetResult.ok) {
    rememberRejectedResult(tracker, envelope, targetResult.result, processedAt)
    return rejectionOutcome(envelope, record, record.state, targetResult.result)
  }

  const staleRejection = staleFieldEffectRejection(
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

  const previousFieldEffects = currentFieldEffectsState(
    targetResult.target.mapSlug,
    targetResult.target.mapState,
    record.revision,
  )
  const change = applyFieldEffectChange(
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
    FieldEffectCommandType,
    FieldEffectCommandPayload,
    TabletopMapV2,
    typeof FIELD_EFFECTS_UPDATED_PATCH_EVENT_TYPE,
    FieldEffectsPatchPayload
  >({
    state: record.state,
    command: commandValidation.command,
    eventType: FIELD_EFFECTS_UPDATED_PATCH_EVENT_TYPE,
    eventPayload: {
      mapSlug: targetResult.target.mapSlug,
      command: commandValidation.command.type,
      previous: cloneFieldEffects(change.change.previous),
      current: cloneFieldEffects(change.change.current),
      ...(change.change.category === undefined ? {} : { category: change.change.category }),
      ...(change.change.kind === undefined ? {} : { kind: change.change.kind }),
      ...(change.change.tickAmount === undefined ? {} : { tickAmount: change.change.tickAmount }),
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
    throw new ApplyFieldEffectCommandUseCaseError(
      409,
      'The live session ended before field effects could apply',
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
    throw new ApplyFieldEffectCommandUseCaseError(
      500,
      `Failed to write field-effect session snapshot: ${messageFromError(error)}`,
    )
  }

  rememberAcceptedResult(tracker, commandValidation.command, applied.result, applied.processedAt)

  const currentMapState = getSessionMapState(applied.state, targetResult.target.mapSlug)
  if (currentMapState === undefined) {
    throw new ApplyFieldEffectCommandUseCaseError(
      500,
      'field-effect command applied but the target map could not be found in next authoritative state',
    )
  }

  return {
    status: 'accepted',
    session: sessionDetailsFor(updatedRecord),
    command: commandValidation.command,
    result: applied.result,
    patchEvent: applied.patchEvent,
    eventLogEntry: applied.eventLogEntry,
    previousFieldEffects,
    fieldEffects: currentFieldEffectsState(
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
