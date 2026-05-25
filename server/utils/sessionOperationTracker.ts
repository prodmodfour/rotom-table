import {
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  type SessionCommandDuplicateOriginalSummary,
  type SessionCommandDuplicateResult,
  type SessionCommandRejectedResult,
  type SessionCommandResult,
  type SessionCommandResultMetadata,
  type SessionCommandAcceptedResult,
} from '#shared/sessionCommandResults'
import {
  formatOperationIdScopeKey,
  getCommandOperationIdScope,
  type OperationIdScopeKey,
  type OpId,
  type SessionCommandEnvelope,
  type SessionCommandScope,
  type SessionCommandType,
} from '#shared/sessionCommands'
import type { ClientId, SessionId } from '#shared/sessionIdentity'
import type { SessionActor } from '#shared/sessionPermissions'
import type { Revision, SessionRevision } from '#shared/sessionRevisions'

export const SESSION_OPERATION_TRACKER_DEFAULT_MAX_RECORDS_PER_SESSION = 512

export const SESSION_OPERATION_IDEMPOTENCY_STATUSES = [
  'new',
  'duplicate',
  'mismatched-opId',
] as const

export type SessionOperationIdempotencyStatus =
  (typeof SESSION_OPERATION_IDEMPOTENCY_STATUSES)[number]

export type SessionOperationTrackerClock = () => string

type Brand<TName extends string> = string & { readonly __brand: TName }

export type SessionOperationCommandFingerprint = Brand<'SessionOperationCommandFingerprint'>

export type TrackableSessionCommand = SessionCommandEnvelope<
  SessionCommandType,
  unknown,
  SessionActor,
  Revision
>

export type TrackableSessionCommandResult =
  | SessionCommandAcceptedResult<SessionCommandType, unknown, SessionRevision>
  | SessionCommandRejectedResult<SessionCommandType, unknown, SessionRevision>

export interface SessionOperationRecord {
  readonly sessionId: SessionId
  readonly clientId: ClientId
  readonly opId: OpId
  readonly scopeKey: OperationIdScopeKey
  readonly commandType: SessionCommandType
  readonly command: TrackableSessionCommand
  readonly commandFingerprint: SessionOperationCommandFingerprint
  readonly scopes: readonly SessionCommandScope[]
  readonly result: TrackableSessionCommandResult
  readonly original: SessionCommandDuplicateOriginalSummary<SessionRevision>
  readonly recordedAt: string
}

export interface RememberSessionOperationResultOptions {
  readonly recordedAt?: string
  readonly clock?: SessionOperationTrackerClock
}

export interface CreateDuplicateSessionCommandResultOptions {
  readonly currentRevision: SessionRevision
  readonly processedAt?: string
  readonly clock?: SessionOperationTrackerClock
  readonly resultMetadata?: SessionCommandResultMetadata
}

export type SessionOperationIdempotencyCheck =
  | {
      readonly status: 'new'
      readonly scopeKey: OperationIdScopeKey
    }
  | {
      readonly status: 'duplicate'
      readonly scopeKey: OperationIdScopeKey
      readonly record: SessionOperationRecord
      readonly result: SessionCommandDuplicateResult<SessionCommandType, SessionRevision>
    }
  | {
      readonly status: 'mismatched-opId'
      readonly scopeKey: OperationIdScopeKey
      readonly record: SessionOperationRecord
      readonly message: string
    }

export interface CreateInMemorySessionOperationTrackerOptions {
  readonly maxRecordsPerSession?: number
  readonly clock?: SessionOperationTrackerClock
}

export interface InMemorySessionOperationTracker {
  readonly sessionCount: number
  readonly recordCount: number
  readonly maxRecordsPerSession: number
  rememberResult(
    command: TrackableSessionCommand,
    result: SessionCommandResult<SessionCommandType, unknown, unknown, SessionRevision>,
    options?: RememberSessionOperationResultOptions,
  ): SessionOperationRecord
  check(
    command: TrackableSessionCommand,
    options: CreateDuplicateSessionCommandResultOptions,
  ): SessionOperationIdempotencyCheck
  get(command: TrackableSessionCommand): SessionOperationRecord | undefined
  list(sessionId: SessionId): readonly SessionOperationRecord[]
  clearSession(sessionId: SessionId): boolean
  clear(): void
}

type MutableSessionOperationRecord = {
  -readonly [TKey in keyof SessionOperationRecord]: SessionOperationRecord[TKey]
}

const defaultSessionOperationTrackerClock: SessionOperationTrackerClock = () =>
  new Date().toISOString()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const assertValidMaxRecordsPerSession = (maxRecordsPerSession: number): void => {
  if (!Number.isSafeInteger(maxRecordsPerSession) || maxRecordsPerSession < 1) {
    throw new Error('maxRecordsPerSession must be a positive safe integer')
  }
}

const canonicalJsonStringify = (
  value: unknown,
  path = 'value',
  seen: WeakSet<object> = new WeakSet(),
): string => {
  if (value === null) return 'null'

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must be JSON-serializable; non-finite numbers are not allowed`)
    }
    return JSON.stringify(value)
  }

  if (value === undefined) {
    throw new Error(`${path} must be JSON-serializable; undefined values are not allowed`)
  }

  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error(`${path} must be JSON-serializable`)
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error(`${path} must be JSON-serializable; circular references are not allowed`)
    }
    seen.add(value)
    const serialized = `[${value
      .map((item, index) => canonicalJsonStringify(item, `${path}[${index}]`, seen))
      .join(',')}]`
    seen.delete(value)
    return serialized
  }

  if (!isRecord(value)) {
    throw new Error(`${path} must be JSON-serializable`)
  }

  if (seen.has(value)) {
    throw new Error(`${path} must be JSON-serializable; circular references are not allowed`)
  }

  seen.add(value)
  const serializedEntries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key], `${path}.${key}`, seen)}`)
  seen.delete(value)

  return `{${serializedEntries.join(',')}}`
}

const materialCommandForFingerprint = (
  command: TrackableSessionCommand,
): Omit<TrackableSessionCommand, 'metadata'> => ({
  schemaVersion: command.schemaVersion,
  sessionId: command.sessionId,
  actor: command.actor,
  type: command.type,
  opId: command.opId,
  baseRevision: command.baseRevision,
  scopes: command.scopes,
  payload: command.payload,
})

export const createSessionOperationCommandFingerprint = (
  command: TrackableSessionCommand,
): SessionOperationCommandFingerprint => {
  try {
    return canonicalJsonStringify(
      materialCommandForFingerprint(command),
      'command',
    ) as SessionOperationCommandFingerprint
  } catch (error) {
    throw new Error(`Session command envelope could not be fingerprinted: ${messageFromError(error)}`)
  }
}

export const isTrackableSessionOperationResult = (
  result: SessionCommandResult<SessionCommandType, unknown, unknown, SessionRevision>,
): result is TrackableSessionCommandResult => result.status === 'accepted' || result.status === 'rejected'

const cloneSessionOperationRecord = (
  record: MutableSessionOperationRecord,
): SessionOperationRecord => ({ ...record })

const createOriginalSummary = (
  result: TrackableSessionCommandResult,
): SessionCommandDuplicateOriginalSummary<SessionRevision> =>
  result.status === 'accepted'
    ? {
        status: 'accepted',
        revision: result.currentRevision,
      }
    : {
        status: 'rejected',
        revision: result.currentRevision,
        reason: result.reason,
      }

const metadataForDuplicateResult = (
  commandMetadata: TrackableSessionCommand['metadata'],
  processedAt: string,
  override: SessionCommandResultMetadata | undefined,
): SessionCommandResultMetadata => ({
  serverProcessedAt: override?.serverProcessedAt ?? processedAt,
  ...(override?.traceId !== undefined
    ? { traceId: override.traceId }
    : commandMetadata?.traceId === undefined
      ? {}
      : { traceId: commandMetadata.traceId }),
  ...(override?.attributes === undefined ? {} : { attributes: override.attributes }),
})

const assertResultMatchesCommand = (
  command: TrackableSessionCommand,
  result: TrackableSessionCommandResult,
): void => {
  if (result.sessionId !== command.sessionId) {
    throw new Error('Tracked command result sessionId must match the command sessionId')
  }

  if (result.opId !== command.opId) {
    throw new Error('Tracked command result opId must match the command opId')
  }

  if (result.commandType !== command.type) {
    throw new Error('Tracked command result commandType must match the command type')
  }

  if (result.actor.clientId !== command.actor.clientId) {
    throw new Error('Tracked command result actor clientId must match the command actor clientId')
  }

  if (canonicalJsonStringify(result.actor, 'result.actor') !== canonicalJsonStringify(command.actor, 'command.actor')) {
    throw new Error('Tracked command result actor must match the command actor')
  }

  if (canonicalJsonStringify(result.scopes, 'result.scopes') !== canonicalJsonStringify(command.scopes, 'command.scopes')) {
    throw new Error('Tracked command result scopes must match the command scopes')
  }
}

const scopeKeyForCommand = (command: TrackableSessionCommand): OperationIdScopeKey =>
  formatOperationIdScopeKey(getCommandOperationIdScope(command))

const mismatchMessageFor = (scopeKey: OperationIdScopeKey): string =>
  `Operation ID ${scopeKey} was already recorded for a different command envelope`

export const createDuplicateSessionCommandResult = (
  command: TrackableSessionCommand,
  record: SessionOperationRecord,
  options: CreateDuplicateSessionCommandResultOptions,
): SessionCommandDuplicateResult<SessionCommandType, SessionRevision> => {
  const scopeKey = scopeKeyForCommand(command)
  if (record.scopeKey !== scopeKey) {
    throw new Error('Duplicate command result scope must match the tracked operation scope')
  }

  const fingerprint = createSessionOperationCommandFingerprint(command)
  if (record.commandFingerprint !== fingerprint) {
    throw new Error(mismatchMessageFor(scopeKey))
  }

  if (options.currentRevision < record.original.revision) {
    throw new Error('Duplicate command currentRevision must not be before the original result revision')
  }

  const processedAt = options.processedAt ?? options.clock?.() ?? defaultSessionOperationTrackerClock()

  return {
    schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
    status: 'duplicate',
    duplicate: true,
    idempotent: true,
    sessionId: command.sessionId,
    opId: command.opId,
    commandType: command.type,
    actor: command.actor,
    currentRevision: options.currentRevision,
    scopes: command.scopes,
    original: record.original,
    metadata: metadataForDuplicateResult(command.metadata, processedAt, options.resultMetadata),
  }
}

export const createInMemorySessionOperationTracker = (
  options: CreateInMemorySessionOperationTrackerOptions = {},
): InMemorySessionOperationTracker => {
  const maxRecordsPerSession =
    options.maxRecordsPerSession ?? SESSION_OPERATION_TRACKER_DEFAULT_MAX_RECORDS_PER_SESSION
  assertValidMaxRecordsPerSession(maxRecordsPerSession)

  const clock = options.clock ?? defaultSessionOperationTrackerClock
  const recordsBySessionId = new Map<SessionId, Map<OperationIdScopeKey, MutableSessionOperationRecord>>()

  const getSessionRecords = (
    sessionId: SessionId,
    createIfMissing = false,
  ): Map<OperationIdScopeKey, MutableSessionOperationRecord> | undefined => {
    const existing = recordsBySessionId.get(sessionId)
    if (existing !== undefined || !createIfMissing) return existing

    const records = new Map<OperationIdScopeKey, MutableSessionOperationRecord>()
    recordsBySessionId.set(sessionId, records)
    return records
  }

  const evictOldestIfNeeded = (
    records: Map<OperationIdScopeKey, MutableSessionOperationRecord>,
  ): void => {
    while (records.size > maxRecordsPerSession) {
      const oldestKey = records.keys().next().value as OperationIdScopeKey | undefined
      if (oldestKey === undefined) return
      records.delete(oldestKey)
    }
  }

  const getMutableRecord = (command: TrackableSessionCommand): MutableSessionOperationRecord | undefined => {
    const records = getSessionRecords(command.sessionId)
    return records?.get(scopeKeyForCommand(command))
  }

  const rememberResult: InMemorySessionOperationTracker['rememberResult'] = (
    command,
    result,
    rememberOptions = {},
  ) => {
    if (!isTrackableSessionOperationResult(result)) {
      throw new Error('Only accepted or rejected command results can be tracked for duplicate opId handling')
    }

    assertResultMatchesCommand(command, result)

    const scopeKey = scopeKeyForCommand(command)
    const commandFingerprint = createSessionOperationCommandFingerprint(command)
    const records = getSessionRecords(command.sessionId, true)
    if (records === undefined) {
      throw new Error('Session operation tracker could not allocate session records')
    }

    const existing = records.get(scopeKey)
    if (existing !== undefined) {
      if (existing.commandFingerprint !== commandFingerprint) {
        throw new Error(mismatchMessageFor(scopeKey))
      }
      return cloneSessionOperationRecord(existing)
    }

    const record: MutableSessionOperationRecord = {
      sessionId: command.sessionId,
      clientId: command.actor.clientId,
      opId: command.opId,
      scopeKey,
      commandType: command.type,
      command,
      commandFingerprint,
      scopes: command.scopes,
      result,
      original: createOriginalSummary(result),
      recordedAt: rememberOptions.recordedAt ?? rememberOptions.clock?.() ?? clock(),
    }

    records.set(scopeKey, record)
    evictOldestIfNeeded(records)

    return cloneSessionOperationRecord(record)
  }

  const check: InMemorySessionOperationTracker['check'] = (command, checkOptions) => {
    const scopeKey = scopeKeyForCommand(command)
    const record = getMutableRecord(command)
    if (record === undefined) return { status: 'new', scopeKey }

    const clonedRecord = cloneSessionOperationRecord(record)
    if (record.commandFingerprint !== createSessionOperationCommandFingerprint(command)) {
      return {
        status: 'mismatched-opId',
        scopeKey,
        record: clonedRecord,
        message: mismatchMessageFor(scopeKey),
      }
    }

    return {
      status: 'duplicate',
      scopeKey,
      record: clonedRecord,
      result: createDuplicateSessionCommandResult(command, clonedRecord, checkOptions),
    }
  }

  const list = (sessionId: SessionId): readonly SessionOperationRecord[] =>
    [...(getSessionRecords(sessionId)?.values() ?? [])].map(cloneSessionOperationRecord)

  return {
    get sessionCount() {
      return recordsBySessionId.size
    },
    get recordCount() {
      return [...recordsBySessionId.values()].reduce((total, records) => total + records.size, 0)
    },
    maxRecordsPerSession,
    rememberResult,
    check,
    get: (command) => {
      const record = getMutableRecord(command)
      return record === undefined ? undefined : cloneSessionOperationRecord(record)
    },
    list,
    clearSession: (sessionId) => recordsBySessionId.delete(sessionId),
    clear: () => recordsBySessionId.clear(),
  }
}

export const sessionOperationTracker = createInMemorySessionOperationTracker()
