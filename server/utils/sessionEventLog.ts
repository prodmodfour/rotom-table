import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  isSessionCommandResultStatus,
  type SessionCommandResult,
} from '#shared/sessionCommandResults'
import {
  parseOpId,
  parseSessionCommandType,
  type OpId,
  type SessionCommandEnvelope,
  type SessionCommandScope,
  type SessionCommandType,
} from '#shared/sessionCommands'
import { validateSessionCommandEnvelope } from '#shared/sessionCommandValidation'
import { parseSessionId, type SessionId } from '#shared/sessionIdentity'
import type { SessionActor } from '#shared/sessionPermissions'
import { parseSessionRevision, type SessionRevision } from '#shared/sessionRevisions'
import { joinSafeUnderRoot, PROJECT_ROOT } from './fsPaths'

export const SESSION_EVENT_LOG_SCHEMA_VERSION = 1 as const
export const SESSION_EVENT_LOG_FILE_NAME = 'events.jsonl'
export const SESSION_EVENT_LOG_ROOT = resolve(PROJECT_ROOT, 'data/sessions')

export const SESSION_EVENT_LOG_ENTRY_KINDS = ['command', 'event'] as const
export type SessionEventLogEntryKind = (typeof SESSION_EVENT_LOG_ENTRY_KINDS)[number]

export const SESSION_EVENT_LOG_VALIDATION_ISSUE_CODES = [
  'not-object',
  'missing-field',
  'invalid-schema-version',
  'invalid-session-id',
  'session-id-mismatch',
  'invalid-revision',
  'revision-mismatch',
  'invalid-timestamp',
  'invalid-kind',
  'invalid-command',
  'invalid-result',
  'invalid-event',
  'invalid-metadata',
] as const

export type SessionEventLogValidationIssueCode =
  (typeof SESSION_EVENT_LOG_VALIDATION_ISSUE_CODES)[number]

export type SessionEventLogClock = () => string
export type SessionEventLogMetadataValue = string | number | boolean | null
export type SessionEventLogMetadataAttributes = Readonly<Record<string, SessionEventLogMetadataValue>>

export interface SessionEventLogMetadata {
  readonly traceId?: string
  readonly source?: string
  readonly attributes?: SessionEventLogMetadataAttributes
}

export interface SessionEventLogEntryBase<
  TKind extends SessionEventLogEntryKind = SessionEventLogEntryKind,
> {
  readonly schemaVersion: typeof SESSION_EVENT_LOG_SCHEMA_VERSION
  readonly kind: TKind
  readonly sessionId: SessionId
  /**
   * The server-owned session revision after this entry is durable. Command
   * entries normally use the command result's current revision.
   */
  readonly revision: SessionRevision
  readonly recordedAt: string
  readonly metadata?: SessionEventLogMetadata
}

export interface SessionCommandEventLogEntry<
  TType extends SessionCommandType = SessionCommandType,
  TPayload = unknown,
  TEvent = unknown,
  TCurrentState = unknown,
> extends SessionEventLogEntryBase<'command'> {
  readonly command: SessionCommandEnvelope<TType, TPayload, SessionActor, SessionRevision>
  readonly result: SessionCommandResult<TType, TEvent, TCurrentState, SessionRevision>
}

export interface SessionGenericEventLogEntry<TEvent = unknown>
  extends SessionEventLogEntryBase<'event'> {
  readonly eventType: string
  readonly event: TEvent
  readonly actor?: SessionActor
  readonly opId?: OpId
  readonly commandType?: SessionCommandType
  readonly scopes?: readonly SessionCommandScope[]
}

export type SessionEventLogEntry<
  TType extends SessionCommandType = SessionCommandType,
  TPayload = unknown,
  TEvent = unknown,
  TCurrentState = unknown,
> =
  | SessionCommandEventLogEntry<TType, TPayload, TEvent, TCurrentState>
  | SessionGenericEventLogEntry<TEvent>

export interface CreateSessionEventLogEntryOptions {
  readonly recordedAt?: string
  readonly clock?: SessionEventLogClock
  readonly metadata?: SessionEventLogMetadata
}

export interface CreateSessionEventLogEventInput<TEvent = unknown> {
  readonly sessionId: SessionId
  readonly revision: SessionRevision
  readonly eventType: string
  readonly event: TEvent
  readonly actor?: SessionActor
  readonly opId?: OpId
  readonly commandType?: SessionCommandType
  readonly scopes?: readonly SessionCommandScope[]
}

export interface SessionEventLogPathOptions {
  readonly rootDir?: string
}

export interface ValidateSessionEventLogEntryOptions {
  readonly expectedSessionId?: SessionId
}

export interface SessionEventLogValidationIssue {
  readonly path: string
  readonly code: SessionEventLogValidationIssueCode
  readonly message: string
}

export type ValidateSessionEventLogEntryResult<
  TEntry extends SessionEventLogEntry = SessionEventLogEntry,
> =
  | {
      readonly valid: true
      readonly entry: TEntry
      readonly issues: readonly []
    }
  | {
      readonly valid: false
      readonly issues: readonly SessionEventLogValidationIssue[]
    }

export interface AppendSessionEventLogOptions extends SessionEventLogPathOptions {
  /**
   * Defaults to true. Tests may disable fsync when a mocked filesystem cannot
   * support it; production appends should keep it enabled for durability.
   */
  readonly flushToDisk?: boolean
}

export interface AppendSessionEventLogResult<TEntry extends SessionEventLogEntry = SessionEventLogEntry> {
  readonly directoryPath: string
  readonly filePath: string
  readonly entry: TEntry
  readonly bytesWritten: number
}

type UnknownRecord = Record<string, unknown>

interface CommandResultSummary {
  readonly sessionId?: SessionId
  readonly opId?: OpId
  readonly commandType?: SessionCommandType
  readonly currentRevision?: SessionRevision
}

const defaultSessionEventLogClock: SessionEventLogClock = () => new Date().toISOString()

const normalizeEventLogRoot = (rootDir: string = SESSION_EVENT_LOG_ROOT): string => resolve(rootDir)

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const addValidationIssue = (
  issues: SessionEventLogValidationIssue[],
  path: string,
  code: SessionEventLogValidationIssueCode,
  message: string,
): void => {
  issues.push({ path, code, message })
}

const parseRequiredRecordField = (
  value: unknown,
  path: string,
  issues: SessionEventLogValidationIssue[],
): UnknownRecord | undefined => {
  if (!isRecord(value)) {
    addValidationIssue(issues, path, 'not-object', `${path} must be a JSON object`)
    return undefined
  }

  return value
}

const parseTimestampField = (
  value: unknown,
  path: string,
  issues: SessionEventLogValidationIssue[],
): string | undefined => {
  if (typeof value !== 'string' || value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    addValidationIssue(issues, path, 'invalid-timestamp', `${path} must be a valid timestamp string`)
    return undefined
  }

  return value
}

const parseSessionIdField = (
  value: unknown,
  path: string,
  issues: SessionEventLogValidationIssue[],
): SessionId | undefined => {
  try {
    return parseSessionId(value, path)
  } catch (error) {
    addValidationIssue(issues, path, 'invalid-session-id', messageFromError(error))
    return undefined
  }
}

const parseSessionRevisionField = (
  value: unknown,
  path: string,
  issues: SessionEventLogValidationIssue[],
): SessionRevision | undefined => {
  try {
    return parseSessionRevision(value, path)
  } catch (error) {
    addValidationIssue(issues, path, 'invalid-revision', messageFromError(error))
    return undefined
  }
}

const parseOpIdField = (
  value: unknown,
  path: string,
  issues: SessionEventLogValidationIssue[],
): OpId | undefined => {
  try {
    return parseOpId(value, path)
  } catch (error) {
    addValidationIssue(issues, path, 'invalid-result', messageFromError(error))
    return undefined
  }
}

const parseCommandTypeField = (
  value: unknown,
  path: string,
  issues: SessionEventLogValidationIssue[],
): SessionCommandType | undefined => {
  try {
    return parseSessionCommandType(value, path)
  } catch (error) {
    addValidationIssue(issues, path, 'invalid-result', messageFromError(error))
    return undefined
  }
}

const validateMetadata = (
  value: unknown,
  path: string,
  issues: SessionEventLogValidationIssue[],
): void => {
  const record = parseRequiredRecordField(value, path, issues)
  if (record === undefined) return

  if (hasOwn(record, 'traceId') && typeof record.traceId !== 'string') {
    addValidationIssue(issues, `${path}.traceId`, 'invalid-metadata', `${path}.traceId must be a string`)
  }

  if (hasOwn(record, 'source') && typeof record.source !== 'string') {
    addValidationIssue(issues, `${path}.source`, 'invalid-metadata', `${path}.source must be a string`)
  }

  if (!hasOwn(record, 'attributes')) return

  const attributes = parseRequiredRecordField(record.attributes, `${path}.attributes`, issues)
  if (attributes === undefined) return

  for (const [key, attributeValue] of Object.entries(attributes)) {
    if (
      attributeValue === null ||
      typeof attributeValue === 'string' ||
      typeof attributeValue === 'boolean' ||
      (typeof attributeValue === 'number' && Number.isFinite(attributeValue))
    ) {
      continue
    }

    addValidationIssue(
      issues,
      `${path}.attributes.${key}`,
      'invalid-metadata',
      `${path}.attributes.${key} must be a string, finite number, boolean, or null`,
    )
  }
}

const collectCommandResultIssues = (
  value: unknown,
  path: string,
  issues: SessionEventLogValidationIssue[],
): CommandResultSummary => {
  const record = parseRequiredRecordField(value, path, issues)
  if (record === undefined) return {}

  if (record.schemaVersion !== SESSION_COMMAND_RESULT_SCHEMA_VERSION) {
    addValidationIssue(
      issues,
      `${path}.schemaVersion`,
      'invalid-result',
      `${path}.schemaVersion must be ${SESSION_COMMAND_RESULT_SCHEMA_VERSION}`,
    )
  }

  if (!isSessionCommandResultStatus(record.status)) {
    addValidationIssue(issues, `${path}.status`, 'invalid-result', `${path}.status is invalid`)
  }

  const sessionId = parseSessionIdField(record.sessionId, `${path}.sessionId`, issues)
  const opId = parseOpIdField(record.opId, `${path}.opId`, issues)
  const commandType = parseCommandTypeField(record.commandType, `${path}.commandType`, issues)
  const currentRevision = parseSessionRevisionField(
    record.currentRevision,
    `${path}.currentRevision`,
    issues,
  )

  if (!Array.isArray(record.scopes)) {
    addValidationIssue(issues, `${path}.scopes`, 'invalid-result', `${path}.scopes must be an array`)
  }

  if (!isRecord(record.actor)) {
    addValidationIssue(issues, `${path}.actor`, 'invalid-result', `${path}.actor must be a JSON object`)
  }

  if (record.status === 'accepted' && record.accepted !== true) {
    addValidationIssue(issues, `${path}.accepted`, 'invalid-result', `${path}.accepted must be true`)
  }

  if (record.status === 'rejected') {
    if (record.accepted !== false) {
      addValidationIssue(issues, `${path}.accepted`, 'invalid-result', `${path}.accepted must be false`)
    }
    if (typeof record.reason !== 'string' || record.reason.length === 0) {
      addValidationIssue(issues, `${path}.reason`, 'invalid-result', `${path}.reason is required`)
    }
    if (typeof record.message !== 'string' || record.message.length === 0) {
      addValidationIssue(issues, `${path}.message`, 'invalid-result', `${path}.message is required`)
    }
    if (typeof record.retryable !== 'boolean') {
      addValidationIssue(issues, `${path}.retryable`, 'invalid-result', `${path}.retryable is required`)
    }
  }

  if (record.status === 'duplicate') {
    if (record.duplicate !== true || record.idempotent !== true) {
      addValidationIssue(
        issues,
        `${path}.duplicate`,
        'invalid-result',
        `${path} duplicate results must be marked duplicate and idempotent`,
      )
    }
    if (!isRecord(record.original)) {
      addValidationIssue(issues, `${path}.original`, 'invalid-result', `${path}.original is required`)
    }
  }

  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(opId === undefined ? {} : { opId }),
    ...(commandType === undefined ? {} : { commandType }),
    ...(currentRevision === undefined ? {} : { currentRevision }),
  }
}

const collectCommandEntryIssues = (
  record: UnknownRecord,
  path: string,
  sessionId: SessionId | undefined,
  revision: SessionRevision | undefined,
  issues: SessionEventLogValidationIssue[],
): void => {
  const commandValidation = validateSessionCommandEnvelope<SessionCommandEnvelope>(record.command)
  if (!commandValidation.valid) {
    const summary = commandValidation.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ')
    addValidationIssue(issues, `${path}.command`, 'invalid-command', summary)
  }

  const result = collectCommandResultIssues(record.result, `${path}.result`, issues)
  const command = commandValidation.valid ? commandValidation.command : undefined

  if (sessionId !== undefined && command !== undefined && command.sessionId !== sessionId) {
    addValidationIssue(
      issues,
      `${path}.command.sessionId`,
      'session-id-mismatch',
      `${path}.command.sessionId must match ${path}.sessionId`,
    )
  }

  if (sessionId !== undefined && result.sessionId !== undefined && result.sessionId !== sessionId) {
    addValidationIssue(
      issues,
      `${path}.result.sessionId`,
      'session-id-mismatch',
      `${path}.result.sessionId must match ${path}.sessionId`,
    )
  }

  if (revision !== undefined && result.currentRevision !== undefined && result.currentRevision !== revision) {
    addValidationIssue(
      issues,
      `${path}.result.currentRevision`,
      'revision-mismatch',
      `${path}.result.currentRevision must match ${path}.revision`,
    )
  }

  if (command !== undefined && result.opId !== undefined && result.opId !== command.opId) {
    addValidationIssue(
      issues,
      `${path}.result.opId`,
      'invalid-result',
      `${path}.result.opId must match ${path}.command.opId`,
    )
  }

  if (command !== undefined && result.commandType !== undefined && result.commandType !== command.type) {
    addValidationIssue(
      issues,
      `${path}.result.commandType`,
      'invalid-result',
      `${path}.result.commandType must match ${path}.command.type`,
    )
  }
}

const collectGenericEventEntryIssues = (
  record: UnknownRecord,
  path: string,
  issues: SessionEventLogValidationIssue[],
): void => {
  if (typeof record.eventType !== 'string' || record.eventType.trim().length === 0) {
    addValidationIssue(issues, `${path}.eventType`, 'invalid-event', `${path}.eventType is required`)
  }

  if (!hasOwn(record, 'event') || record.event === undefined) {
    addValidationIssue(issues, `${path}.event`, 'invalid-event', `${path}.event must be provided`)
  }

  if (hasOwn(record, 'opId')) parseOpIdField(record.opId, `${path}.opId`, issues)
  if (hasOwn(record, 'commandType')) parseCommandTypeField(record.commandType, `${path}.commandType`, issues)
  if (hasOwn(record, 'scopes') && !Array.isArray(record.scopes)) {
    addValidationIssue(issues, `${path}.scopes`, 'invalid-event', `${path}.scopes must be an array`)
  }
  if (hasOwn(record, 'actor') && !isRecord(record.actor)) {
    addValidationIssue(issues, `${path}.actor`, 'invalid-event', `${path}.actor must be a JSON object`)
  }
}

const validationIssueSummary = (issues: readonly SessionEventLogValidationIssue[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const closeFileBestEffort = (fd: number | undefined): void => {
  if (fd === undefined) return
  try {
    closeSync(fd)
  } catch {
    // Best-effort cleanup after a failed append path.
  }
}

const flushDirectoryBestEffort = (directoryPath: string): void => {
  let fd: number | undefined
  try {
    fd = openSync(directoryPath, 'r')
    fsyncSync(fd)
  } catch {
    // Directory fsync is an extra guard and is not available everywhere.
  } finally {
    closeFileBestEffort(fd)
  }
}

export const sessionEventLogDirectoryPathFor = (
  sessionId: SessionId,
  options: SessionEventLogPathOptions = {},
): string => joinSafeUnderRoot(normalizeEventLogRoot(options.rootDir), sessionId)

export const sessionEventLogFilePathFor = (
  sessionId: SessionId,
  options: SessionEventLogPathOptions = {},
): string => joinSafeUnderRoot(
  normalizeEventLogRoot(options.rootDir),
  sessionId,
  SESSION_EVENT_LOG_FILE_NAME,
)

export const createSessionCommandEventLogEntry = <
  TType extends SessionCommandType,
  TPayload,
  TEvent = unknown,
  TCurrentState = unknown,
>(
  command: SessionCommandEnvelope<TType, TPayload, SessionActor, SessionRevision>,
  result: SessionCommandResult<TType, TEvent, TCurrentState, SessionRevision>,
  options: CreateSessionEventLogEntryOptions = {},
): SessionCommandEventLogEntry<TType, TPayload, TEvent, TCurrentState> => {
  const recordedAt = options.recordedAt ?? options.clock?.() ?? defaultSessionEventLogClock()
  const entry: SessionCommandEventLogEntry<TType, TPayload, TEvent, TCurrentState> = {
    schemaVersion: SESSION_EVENT_LOG_SCHEMA_VERSION,
    kind: 'command',
    sessionId: command.sessionId,
    revision: result.currentRevision,
    recordedAt,
    command,
    result,
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  }

  const validation = validateSessionEventLogEntry(entry)
  if (!validation.valid) {
    throw new Error(`Session command event log entry is invalid: ${validationIssueSummary(validation.issues)}`)
  }

  return entry
}

export const createSessionEventLogEntry = <TEvent = unknown>(
  input: CreateSessionEventLogEventInput<TEvent>,
  options: CreateSessionEventLogEntryOptions = {},
): SessionGenericEventLogEntry<TEvent> => {
  const recordedAt = options.recordedAt ?? options.clock?.() ?? defaultSessionEventLogClock()
  const entry: SessionGenericEventLogEntry<TEvent> = {
    schemaVersion: SESSION_EVENT_LOG_SCHEMA_VERSION,
    kind: 'event',
    sessionId: input.sessionId,
    revision: input.revision,
    recordedAt,
    eventType: input.eventType,
    event: input.event,
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.opId === undefined ? {} : { opId: input.opId }),
    ...(input.commandType === undefined ? {} : { commandType: input.commandType }),
    ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  }

  const validation = validateSessionEventLogEntry(entry)
  if (!validation.valid) {
    throw new Error(`Session event log entry is invalid: ${validationIssueSummary(validation.issues)}`)
  }

  return entry
}

export const validateSessionEventLogEntry = <
  TEntry extends SessionEventLogEntry = SessionEventLogEntry,
>(
  value: unknown,
  options: ValidateSessionEventLogEntryOptions = {},
): ValidateSessionEventLogEntryResult<TEntry> => {
  const issues: SessionEventLogValidationIssue[] = []
  const record = parseRequiredRecordField(value, 'entry', issues)
  if (record === undefined) return { valid: false, issues }

  if (record.schemaVersion !== SESSION_EVENT_LOG_SCHEMA_VERSION) {
    addValidationIssue(
      issues,
      'entry.schemaVersion',
      'invalid-schema-version',
      `entry.schemaVersion must be ${SESSION_EVENT_LOG_SCHEMA_VERSION}`,
    )
  }

  const sessionId = parseSessionIdField(record.sessionId, 'entry.sessionId', issues)
  const revision = parseSessionRevisionField(record.revision, 'entry.revision', issues)
  parseTimestampField(record.recordedAt, 'entry.recordedAt', issues)

  if (
    options.expectedSessionId !== undefined &&
    sessionId !== undefined &&
    sessionId !== options.expectedSessionId
  ) {
    addValidationIssue(
      issues,
      'entry.sessionId',
      'session-id-mismatch',
      'entry.sessionId must match the requested sessionId',
    )
  }

  if (hasOwn(record, 'metadata') && record.metadata !== undefined) {
    validateMetadata(record.metadata, 'entry.metadata', issues)
  }

  if (record.kind === 'command') {
    collectCommandEntryIssues(record, 'entry', sessionId, revision, issues)
  } else if (record.kind === 'event') {
    collectGenericEventEntryIssues(record, 'entry', issues)
  } else {
    addValidationIssue(issues, 'entry.kind', 'invalid-kind', 'entry.kind must be command or event')
  }

  if (issues.length > 0 || sessionId === undefined || revision === undefined) {
    return { valid: false, issues }
  }

  return { valid: true, entry: value as TEntry, issues: [] }
}

export const serializeSessionEventLogEntry = (entry: SessionEventLogEntry): string => {
  const initialValidation = validateSessionEventLogEntry(entry)
  if (!initialValidation.valid) {
    throw new Error(`Session event log entry is invalid: ${validationIssueSummary(initialValidation.issues)}`)
  }

  const json = JSON.stringify(entry)

  if (json === undefined) {
    throw new Error('Session event log entry could not be serialized to JSON')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json) as unknown
  } catch (error) {
    throw new Error(`Session event log entry serialized to invalid JSON: ${messageFromError(error)}`)
  }

  const serializedValidation = validateSessionEventLogEntry(parsed, {
    expectedSessionId: entry.sessionId,
  })
  if (!serializedValidation.valid) {
    throw new Error(
      `Serialized session event log entry is invalid: ${validationIssueSummary(
        serializedValidation.issues,
      )}`,
    )
  }

  return `${json}\n`
}

export const appendSessionEventLogEntry = <TEntry extends SessionEventLogEntry>(
  entry: TEntry,
  options: AppendSessionEventLogOptions = {},
): AppendSessionEventLogResult<TEntry> => {
  const line = serializeSessionEventLogEntry(entry)
  const filePath = sessionEventLogFilePathFor(entry.sessionId, options)
  const directoryPath = dirname(filePath)
  const flushToDisk = options.flushToDisk !== false

  mkdirSync(directoryPath, { recursive: true })

  let fd: number | undefined
  try {
    fd = openSync(filePath, 'a', 0o600)
    writeFileSync(fd, line, 'utf8')
    if (flushToDisk) fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    if (flushToDisk) flushDirectoryBestEffort(directoryPath)
  } catch (error) {
    closeFileBestEffort(fd)
    throw error
  }

  return {
    directoryPath,
    filePath,
    entry,
    bytesWritten: Buffer.byteLength(line, 'utf8'),
  }
}
