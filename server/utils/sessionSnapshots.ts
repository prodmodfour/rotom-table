import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Dirent,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import {
  parseClientId,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
  type SessionId,
} from '#shared/sessionIdentity'
import { isSessionPresenceStatus } from '#shared/sessionMessages'
import {
  parseMapRevision,
  parseSessionRevision,
  type SessionRevision,
} from '#shared/sessionRevisions'
import {
  SESSION_STATE_SCHEMA_VERSION,
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  type AuthoritativeSessionMapState,
  type AuthoritativeSessionState,
  type SelectedSessionMapSlug,
  type SessionConnectedClientRecord,
  type SessionPlayerRecord,
} from '#shared/sessionState'
import {
  type PlayerAssignmentRecord,
  type SessionActor,
  type SessionControllableResourceRef,
  type SessionMapResourceRef,
  type SessionSheetResourceRef,
  type SessionTokenResourceRef,
  type SessionVisibleResourceRef,
} from '#shared/sessionPermissions'
import { isSheetKind } from '#shared/sheets'
import { joinSafeUnderRoot, PROJECT_ROOT } from './fsPaths'

export const SESSION_SNAPSHOT_SCHEMA_VERSION = 1 as const
export const SESSION_SNAPSHOT_FILE_NAME = 'snapshot.json'
export const SESSION_SNAPSHOT_TEMP_FILE_PREFIX = `${SESSION_SNAPSHOT_FILE_NAME}.tmp-`
export const SESSION_SNAPSHOT_ROOT = resolve(PROJECT_ROOT, 'data/sessions')

export const SESSION_SNAPSHOT_VALIDATION_ISSUE_CODES = [
  'invalid-field',
  'invalid-schema-version',
  'invalid-session-id',
  'session-id-mismatch',
  'invalid-revision',
  'revision-mismatch',
  'invalid-timestamp',
  'invalid-state',
  'client-id-mismatch',
] as const

export type SessionSnapshotValidationIssueCode =
  (typeof SESSION_SNAPSHOT_VALIDATION_ISSUE_CODES)[number]

export const SESSION_SNAPSHOT_READ_FAILURE_REASONS = [
  'not-found',
  'invalid-json',
  'invalid-shape',
  'read-error',
] as const

export type SessionSnapshotReadFailureReason =
  (typeof SESSION_SNAPSHOT_READ_FAILURE_REASONS)[number]

export type SessionSnapshotClock = () => string
export type SessionSnapshotTempFileNameFactory = () => string

export interface PersistedSessionSnapshot<TMapDocument = unknown> {
  readonly schemaVersion: typeof SESSION_SNAPSHOT_SCHEMA_VERSION
  readonly sessionId: SessionId
  readonly revision: SessionRevision
  readonly writtenAt: string
  /**
   * Server-owned authoritative state. This is persisted for reconnect/restart
   * recovery and must not be replaced by live-client whole-map autosaves.
   */
  readonly state: AuthoritativeSessionState<TMapDocument>
}

export interface CreatePersistedSessionSnapshotOptions {
  readonly writtenAt?: string
  readonly clock?: SessionSnapshotClock
}

export interface SessionSnapshotPathOptions {
  readonly rootDir?: string
}

export interface ValidatePersistedSessionSnapshotOptions {
  readonly expectedSessionId?: SessionId
}

export interface SessionSnapshotValidationIssue {
  readonly path: string
  readonly code: SessionSnapshotValidationIssueCode
  readonly message: string
}

export type ValidatePersistedSessionSnapshotResult<TMapDocument = unknown> =
  | {
    readonly valid: true
    readonly snapshot: PersistedSessionSnapshot<TMapDocument>
    readonly issues: readonly []
  }
  | {
    readonly valid: false
    readonly issues: readonly SessionSnapshotValidationIssue[]
  }

export interface SessionSnapshotPublishContext<TMapDocument = unknown> {
  readonly directoryPath: string
  readonly filePath: string
  readonly tempFilePath: string
  readonly json: string
  readonly snapshot: PersistedSessionSnapshot<TMapDocument>
}

export interface WriteSessionSnapshotOptions<TMapDocument = unknown> extends SessionSnapshotPathOptions {
  readonly clock?: SessionSnapshotClock
  /**
   * Test/instrumentation hook for deterministic temp names. Production callers
   * should rely on the default unique name generator.
   */
  readonly tempFileName?: SessionSnapshotTempFileNameFactory
  /**
   * Hook invoked after the temp file is fully written/flushed but before it is
   * renamed over the latest snapshot path.
   */
  readonly onBeforePublish?: (context: SessionSnapshotPublishContext<TMapDocument>) => void
  /**
   * Defaults to true. Tests may disable fsync where a mocked filesystem cannot
   * support it; production snapshot writes should keep it enabled.
   */
  readonly flushToDisk?: boolean
}

export interface WriteSessionSnapshotResult<TMapDocument = unknown> {
  readonly directoryPath: string
  readonly filePath: string
  readonly snapshot: PersistedSessionSnapshot<TMapDocument>
  readonly bytesWritten: number
}

export interface ReadSessionSnapshotSuccess<TMapDocument = unknown> {
  readonly ok: true
  readonly directoryPath: string
  readonly filePath: string
  readonly snapshot: PersistedSessionSnapshot<TMapDocument>
  readonly bytesRead: number
}

export interface ReadSessionSnapshotFailure {
  readonly ok: false
  readonly directoryPath: string
  readonly filePath: string
  readonly reason: SessionSnapshotReadFailureReason
  readonly message: string
  readonly issues?: readonly SessionSnapshotValidationIssue[]
  readonly error?: unknown
}

export type ReadSessionSnapshotResult<TMapDocument = unknown> =
  | ReadSessionSnapshotSuccess<TMapDocument>
  | ReadSessionSnapshotFailure

export interface RecoverSessionStateSuccess<TMapDocument = unknown> {
  readonly recovered: true
  readonly source: 'snapshot'
  readonly directoryPath: string
  readonly filePath: string
  readonly snapshot: PersistedSessionSnapshot<TMapDocument>
  readonly state: AuthoritativeSessionState<TMapDocument>
  readonly revision: SessionRevision
  readonly warnings: readonly []
}

export interface RecoverSessionStateFailure {
  readonly recovered: false
  readonly source: 'snapshot'
  readonly directoryPath: string
  readonly filePath: string
  readonly reason: SessionSnapshotReadFailureReason
  readonly message: string
  readonly issues?: readonly SessionSnapshotValidationIssue[]
  readonly error?: unknown
}

export type RecoverSessionStateResult<TMapDocument = unknown> =
  | RecoverSessionStateSuccess<TMapDocument>
  | RecoverSessionStateFailure

type UnknownRecord = Record<string, unknown>

const defaultSessionSnapshotClock: SessionSnapshotClock = () => new Date().toISOString()

const normalizeSnapshotRoot = (rootDir: string = SESSION_SNAPSHOT_ROOT): string => resolve(rootDir)

const defaultTempFileName = (): string =>
  `${SESSION_SNAPSHOT_TEMP_FILE_PREFIX}${process.pid}-${Date.now()}-${randomUUID()}`

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOwn = <TKey extends PropertyKey>(
  value: object,
  key: TKey,
): value is object & Record<TKey, unknown> => Object.prototype.hasOwnProperty.call(value, key)

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const addValidationIssue = (
  issues: SessionSnapshotValidationIssue[],
  path: string,
  code: SessionSnapshotValidationIssueCode,
  message: string,
): void => {
  issues.push({ path, code, message })
}

const parseRequiredRecordField = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): UnknownRecord | undefined => {
  if (!isRecord(value)) {
    addValidationIssue(issues, path, 'invalid-field', `${path} must be a JSON object`)
    return undefined
  }

  return value
}

const parseNonEmptyStringField = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): string | undefined => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    addValidationIssue(issues, path, 'invalid-field', `${path} must be a non-empty string`)
    return undefined
  }

  return value
}

const parseTimestampField = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): string | undefined => {
  if (typeof value !== 'string' || value.trim().length === 0 || Number.isNaN(Date.parse(value))) {
    addValidationIssue(issues, path, 'invalid-timestamp', `${path} must be a valid timestamp string`)
    return undefined
  }

  return value
}

const parseOptionalTimestampField = (
  record: UnknownRecord,
  key: string,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): string | undefined => {
  if (!hasOwn(record, key)) return undefined
  return parseTimestampField(record[key], `${path}.${key}`, issues)
}

const parseSessionIdField = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
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
  issues: SessionSnapshotValidationIssue[],
): SessionRevision | undefined => {
  try {
    return parseSessionRevision(value, path)
  } catch (error) {
    addValidationIssue(issues, path, 'invalid-revision', messageFromError(error))
    return undefined
  }
}

const parseMapRevisionField = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
) => {
  try {
    return parseMapRevision(value, path)
  } catch (error) {
    addValidationIssue(issues, path, 'invalid-revision', messageFromError(error))
    return undefined
  }
}

const parseClientIdField = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
) => {
  try {
    return parseClientId(value, path)
  } catch (error) {
    addValidationIssue(issues, path, 'invalid-field', messageFromError(error))
    return undefined
  }
}

const parsePlayerIdField = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
) => {
  try {
    return parsePlayerId(value, path)
  } catch (error) {
    addValidationIssue(issues, path, 'invalid-field', messageFromError(error))
    return undefined
  }
}

const parseDisplayNameField = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
) => {
  try {
    return parseSessionDisplayName(value, path)
  } catch (error) {
    addValidationIssue(issues, path, 'invalid-field', messageFromError(error))
    return undefined
  }
}

const parseOptionalNonEmptyStringField = (
  record: UnknownRecord,
  key: string,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): string | undefined => {
  if (!hasOwn(record, key)) return undefined
  return parseNonEmptyStringField(record[key], `${path}.${key}`, issues)
}

const parseOptionalBooleanField = (
  record: UnknownRecord,
  key: string,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): boolean | undefined => {
  if (!hasOwn(record, key)) return undefined
  if (typeof record[key] !== 'boolean') {
    addValidationIssue(issues, `${path}.${key}`, 'invalid-field', `${path}.${key} must be boolean`)
    return undefined
  }

  return record[key]
}

const parseSheetKindField = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
) => {
  if (!isSheetKind(value)) {
    addValidationIssue(issues, path, 'invalid-field', `${path} must be a supported sheet kind`)
    return undefined
  }

  return value
}

const parseOptionalSheetKindField = (
  record: UnknownRecord,
  key: string,
  path: string,
  issues: SessionSnapshotValidationIssue[],
) => {
  if (!hasOwn(record, key)) return undefined
  return parseSheetKindField(record[key], `${path}.${key}`, issues)
}

const parseArrayField = <TItem>(
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
  parseItem: (
    item: unknown,
    itemPath: string,
    itemIssues: SessionSnapshotValidationIssue[],
  ) => TItem | undefined,
): readonly TItem[] => {
  if (!Array.isArray(value)) {
    addValidationIssue(issues, path, 'invalid-field', `${path} must be an array`)
    return []
  }

  const parsed: TItem[] = []
  value.forEach((item, index) => {
    const parsedItem = parseItem(item, `${path}[${index}]`, issues)
    if (parsedItem !== undefined) parsed.push(parsedItem)
  })

  return parsed
}

const parseSessionActorField = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): SessionActor | undefined => {
  const issueCount = issues.length
  const record = parseRequiredRecordField(value, path, issues)
  if (record === undefined) return undefined

  if (record.role === 'gm') {
    const clientId = parseClientIdField(record.clientId, `${path}.clientId`, issues)
    if (issues.length > issueCount || clientId === undefined) return undefined

    return {
      role: 'gm',
      clientId,
    }
  }

  if (record.role === 'player') {
    const playerId = parsePlayerIdField(record.playerId, `${path}.playerId`, issues)
    const clientId = parseClientIdField(record.clientId, `${path}.clientId`, issues)
    const displayName = parseDisplayNameField(record.displayName, `${path}.displayName`, issues)
    if (
      issues.length > issueCount ||
      playerId === undefined ||
      clientId === undefined ||
      displayName === undefined
    ) {
      return undefined
    }

    return {
      role: 'player',
      playerId,
      clientId,
      displayName,
    }
  }

  addValidationIssue(issues, `${path}.role`, 'invalid-field', `${path}.role must be gm or player`)
  return undefined
}

const parseMapResourceRef = (
  record: UnknownRecord,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): SessionMapResourceRef | undefined => {
  const issueCount = issues.length
  const mapSlug = parseNonEmptyStringField(record.mapSlug, `${path}.mapSlug`, issues)
  if (issues.length > issueCount || mapSlug === undefined) return undefined

  return {
    kind: 'map',
    mapSlug,
  }
}

const parseSheetResourceRef = (
  record: UnknownRecord,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): SessionSheetResourceRef | undefined => {
  const issueCount = issues.length
  const sheetKind = parseSheetKindField(record.sheetKind, `${path}.sheetKind`, issues)
  const sheetSlug = parseNonEmptyStringField(record.sheetSlug, `${path}.sheetSlug`, issues)
  if (issues.length > issueCount || sheetKind === undefined || sheetSlug === undefined) {
    return undefined
  }

  return {
    kind: 'sheet',
    sheetKind,
    sheetSlug,
  }
}

const parseTokenResourceRef = (
  record: UnknownRecord,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): SessionTokenResourceRef | undefined => {
  const issueCount = issues.length
  const tokenId = parseNonEmptyStringField(record.tokenId, `${path}.tokenId`, issues)
  const mapSlug = parseOptionalNonEmptyStringField(record, 'mapSlug', path, issues)
  const sheetKind = parseOptionalSheetKindField(record, 'sheetKind', path, issues)
  const sheetSlug = parseOptionalNonEmptyStringField(record, 'sheetSlug', path, issues)
  if (issues.length > issueCount || tokenId === undefined) return undefined

  return {
    kind: 'token',
    tokenId,
    ...(mapSlug === undefined ? {} : { mapSlug }),
    ...(sheetKind === undefined ? {} : { sheetKind }),
    ...(sheetSlug === undefined ? {} : { sheetSlug }),
  }
}

const parseVisibleResourceRef = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): SessionVisibleResourceRef | undefined => {
  const record = parseRequiredRecordField(value, path, issues)
  if (record === undefined) return undefined

  if (record.kind === 'map') return parseMapResourceRef(record, path, issues)
  if (record.kind === 'sheet') return parseSheetResourceRef(record, path, issues)
  if (record.kind === 'token') return parseTokenResourceRef(record, path, issues)

  addValidationIssue(
    issues,
    `${path}.kind`,
    'invalid-field',
    `${path}.kind must be map, sheet, or token`,
  )
  return undefined
}

const parseControllableResourceRef = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): SessionControllableResourceRef | undefined => {
  const record = parseRequiredRecordField(value, path, issues)
  if (record === undefined) return undefined

  if (record.kind === 'sheet') return parseSheetResourceRef(record, path, issues)
  if (record.kind === 'token') return parseTokenResourceRef(record, path, issues)

  addValidationIssue(issues, `${path}.kind`, 'invalid-field', `${path}.kind must be sheet or token`)
  return undefined
}

const parseSessionMapState = <TMapDocument>(
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): AuthoritativeSessionMapState<TMapDocument> | undefined => {
  const issueCount = issues.length
  const record = parseRequiredRecordField(value, path, issues)
  if (record === undefined) return undefined

  const mapSlug = parseNonEmptyStringField(record.mapSlug, `${path}.mapSlug`, issues)
  const revision = parseMapRevisionField(record.revision, `${path}.revision`, issues)
  const playerVisibleByDefault = parseOptionalBooleanField(
    record,
    'playerVisibleByDefault',
    path,
    issues,
  )
  if (!hasOwn(record, 'document')) {
    addValidationIssue(issues, `${path}.document`, 'invalid-field', `${path}.document is required`)
  }

  if (issues.length > issueCount || mapSlug === undefined || revision === undefined) {
    return undefined
  }

  return createAuthoritativeSessionMapState<TMapDocument>({
    mapSlug,
    revision,
    playerVisibleByDefault,
    document: record.document as TMapDocument,
  })
}

const parseConnectedClientRecord = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): SessionConnectedClientRecord | undefined => {
  const issueCount = issues.length
  const record = parseRequiredRecordField(value, path, issues)
  if (record === undefined) return undefined

  const clientId = parseClientIdField(record.clientId, `${path}.clientId`, issues)
  const actor = parseSessionActorField(record.actor, `${path}.actor`, issues)
  const connectedAt = parseTimestampField(record.connectedAt, `${path}.connectedAt`, issues)
  const lastSeenAt = parseOptionalTimestampField(record, 'lastSeenAt', path, issues)
  const disconnectedAt = parseOptionalTimestampField(record, 'disconnectedAt', path, issues)
  const lastSeenRevision = hasOwn(record, 'lastSeenRevision')
    ? parseSessionRevisionField(record.lastSeenRevision, `${path}.lastSeenRevision`, issues)
    : undefined

  if (!isSessionPresenceStatus(record.status)) {
    addValidationIssue(issues, `${path}.status`, 'invalid-field', `${path}.status is invalid`)
  }

  if (clientId !== undefined && actor !== undefined && actor.clientId !== clientId) {
    addValidationIssue(
      issues,
      `${path}.actor.clientId`,
      'client-id-mismatch',
      `${path}.actor.clientId must match ${path}.clientId`,
    )
  }

  if (
    issues.length > issueCount ||
    clientId === undefined ||
    actor === undefined ||
    !isSessionPresenceStatus(record.status) ||
    connectedAt === undefined
  ) {
    return undefined
  }

  return {
    clientId,
    actor,
    status: record.status,
    connectedAt,
    ...(lastSeenAt === undefined ? {} : { lastSeenAt }),
    ...(lastSeenRevision === undefined ? {} : { lastSeenRevision }),
    ...(disconnectedAt === undefined ? {} : { disconnectedAt }),
  }
}

const parsePlayerRecord = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): SessionPlayerRecord | undefined => {
  const issueCount = issues.length
  const record = parseRequiredRecordField(value, path, issues)
  if (record === undefined) return undefined

  const playerId = parsePlayerIdField(record.playerId, `${path}.playerId`, issues)
  const displayName = parseDisplayNameField(record.displayName, `${path}.displayName`, issues)
  const joinedAt = parseTimestampField(record.joinedAt, `${path}.joinedAt`, issues)
  const updatedAt = parseTimestampField(record.updatedAt, `${path}.updatedAt`, issues)
  if (
    issues.length > issueCount ||
    playerId === undefined ||
    displayName === undefined ||
    joinedAt === undefined ||
    updatedAt === undefined
  ) {
    return undefined
  }

  return {
    playerId,
    displayName,
    joinedAt,
    updatedAt,
  }
}

const parsePlayerAssignmentRecord = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): PlayerAssignmentRecord | undefined => {
  const issueCount = issues.length
  const record = parseRequiredRecordField(value, path, issues)
  if (record === undefined) return undefined

  const playerId = parsePlayerIdField(record.playerId, `${path}.playerId`, issues)
  const displayName = parseDisplayNameField(record.displayName, `${path}.displayName`, issues)
  const controllableResources = parseArrayField<SessionControllableResourceRef>(
    record.controllableResources,
    `${path}.controllableResources`,
    issues,
    parseControllableResourceRef,
  )
  const visibleResources = parseArrayField<SessionVisibleResourceRef>(
    record.visibleResources,
    `${path}.visibleResources`,
    issues,
    parseVisibleResourceRef,
  )
  const updatedAt = parseTimestampField(record.updatedAt, `${path}.updatedAt`, issues)
  const updatedByClientId = hasOwn(record, 'updatedByClientId')
    ? parseClientIdField(record.updatedByClientId, `${path}.updatedByClientId`, issues)
    : undefined

  if (
    issues.length > issueCount ||
    playerId === undefined ||
    displayName === undefined ||
    updatedAt === undefined
  ) {
    return undefined
  }

  return {
    playerId,
    displayName,
    controllableResources,
    visibleResources,
    updatedAt,
    ...(updatedByClientId === undefined ? {} : { updatedByClientId }),
  }
}

const parseSelectedMapSlugField = (
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
): SelectedSessionMapSlug | undefined => {
  if (value === null) return null
  return parseNonEmptyStringField(value, path, issues)
}

const validateAuthoritativeSessionStateSnapshot = <TMapDocument>(
  value: unknown,
  path: string,
  issues: SessionSnapshotValidationIssue[],
  expectedSessionId: SessionId | undefined,
  expectedRevision: SessionRevision | undefined,
): AuthoritativeSessionState<TMapDocument> | undefined => {
  const issueCount = issues.length
  const record = parseRequiredRecordField(value, path, issues)
  if (record === undefined) return undefined

  if (record.schemaVersion !== SESSION_STATE_SCHEMA_VERSION) {
    addValidationIssue(
      issues,
      `${path}.schemaVersion`,
      'invalid-schema-version',
      `${path}.schemaVersion must be ${SESSION_STATE_SCHEMA_VERSION}`,
    )
  }

  const sessionId = parseSessionIdField(record.sessionId, `${path}.sessionId`, issues)
  const revision = parseSessionRevisionField(record.revision, `${path}.revision`, issues)
  const selectedMapSlug = parseSelectedMapSlugField(record.selectedMapSlug, `${path}.selectedMapSlug`, issues)
  const maps = parseArrayField<AuthoritativeSessionMapState<TMapDocument>>(
    record.maps,
    `${path}.maps`,
    issues,
    parseSessionMapState,
  )
  const connectedClients = parseArrayField<SessionConnectedClientRecord>(
    record.connectedClients,
    `${path}.connectedClients`,
    issues,
    parseConnectedClientRecord,
  )
  const players = parseArrayField<SessionPlayerRecord>(
    record.players,
    `${path}.players`,
    issues,
    parsePlayerRecord,
  )
  const assignments = parseArrayField<PlayerAssignmentRecord>(
    record.assignments,
    `${path}.assignments`,
    issues,
    parsePlayerAssignmentRecord,
  )
  const createdAt = parseTimestampField(record.createdAt, `${path}.createdAt`, issues)
  const updatedAt = parseTimestampField(record.updatedAt, `${path}.updatedAt`, issues)

  if (expectedSessionId !== undefined && sessionId !== undefined && sessionId !== expectedSessionId) {
    addValidationIssue(
      issues,
      `${path}.sessionId`,
      'session-id-mismatch',
      `${path}.sessionId must match the snapshot sessionId`,
    )
  }

  if (expectedRevision !== undefined && revision !== undefined && revision !== expectedRevision) {
    addValidationIssue(
      issues,
      `${path}.revision`,
      'revision-mismatch',
      `${path}.revision must match the snapshot revision`,
    )
  }

  if (
    issues.length > issueCount ||
    sessionId === undefined ||
    revision === undefined ||
    selectedMapSlug === undefined ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    return undefined
  }

  try {
    return createAuthoritativeSessionState<TMapDocument>({
      sessionId,
      revision,
      selectedMapSlug,
      maps,
      connectedClients,
      players,
      assignments,
      createdAt,
      updatedAt,
    })
  } catch (error) {
    addValidationIssue(issues, path, 'invalid-state', messageFromError(error))
    return undefined
  }
}

const validationIssueSummary = (issues: readonly SessionSnapshotValidationIssue[]): string =>
  issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')

const isNotFoundError = (error: unknown): boolean =>
  isRecord(error) && error.code === 'ENOENT'

const createReadFailure = (
  reason: SessionSnapshotReadFailureReason,
  directoryPath: string,
  filePath: string,
  message: string,
  options: {
    readonly issues?: readonly SessionSnapshotValidationIssue[]
    readonly error?: unknown
  } = {},
): ReadSessionSnapshotFailure => ({
  ok: false,
  directoryPath,
  filePath,
  reason,
  message,
  ...(options.issues === undefined ? {} : { issues: options.issues }),
  ...(options.error === undefined ? {} : { error: options.error }),
})

const closeFileBestEffort = (fd: number | undefined): void => {
  if (fd === undefined) return
  try {
    closeSync(fd)
  } catch {
    // Best-effort cleanup after a failed write path.
  }
}

const unlinkFileBestEffort = (path: string): void => {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // A stale temp file can be removed by cleanupStaleSessionSnapshotTempFiles.
  }
}

const flushDirectoryBestEffort = (directoryPath: string): void => {
  let fd: number | undefined
  try {
    fd = openSync(directoryPath, 'r')
    fsyncSync(fd)
  } catch {
    // Directory fsync is not available on every runtime/filesystem. The file
    // itself has already been flushed before rename; this is an extra guard.
  } finally {
    closeFileBestEffort(fd)
  }
}

export const sessionSnapshotDirectoryPathFor = (
  sessionId: SessionId,
  options: SessionSnapshotPathOptions = {},
): string => joinSafeUnderRoot(normalizeSnapshotRoot(options.rootDir), sessionId)

export const sessionSnapshotFilePathFor = (
  sessionId: SessionId,
  options: SessionSnapshotPathOptions = {},
): string => joinSafeUnderRoot(
  normalizeSnapshotRoot(options.rootDir),
  sessionId,
  SESSION_SNAPSHOT_FILE_NAME,
)

export const isSessionSnapshotTempFileName = (fileName: string): boolean =>
  fileName.startsWith(SESSION_SNAPSHOT_TEMP_FILE_PREFIX)

export const createPersistedSessionSnapshot = <TMapDocument = unknown>(
  state: AuthoritativeSessionState<TMapDocument>,
  options: CreatePersistedSessionSnapshotOptions = {},
): PersistedSessionSnapshot<TMapDocument> => ({
  schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
  sessionId: state.sessionId,
  revision: state.revision,
  writtenAt: options.writtenAt ?? options.clock?.() ?? defaultSessionSnapshotClock(),
  state,
})

export const serializeSessionSnapshot = <TMapDocument = unknown>(
  snapshot: PersistedSessionSnapshot<TMapDocument>,
): string => {
  const json = JSON.stringify(snapshot, null, 2)

  if (json === undefined) {
    throw new Error('Session snapshot could not be serialized to JSON')
  }

  const parsed = JSON.parse(json) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Session snapshot must serialize to a JSON object')
  }

  return `${json}\n`
}

export const validatePersistedSessionSnapshot = <TMapDocument = unknown>(
  value: unknown,
  options: ValidatePersistedSessionSnapshotOptions = {},
): ValidatePersistedSessionSnapshotResult<TMapDocument> => {
  const issues: SessionSnapshotValidationIssue[] = []
  const record = parseRequiredRecordField(value, 'snapshot', issues)
  if (record === undefined) return { valid: false, issues }

  if (record.schemaVersion !== SESSION_SNAPSHOT_SCHEMA_VERSION) {
    addValidationIssue(
      issues,
      'snapshot.schemaVersion',
      'invalid-schema-version',
      `snapshot.schemaVersion must be ${SESSION_SNAPSHOT_SCHEMA_VERSION}`,
    )
  }

  const sessionId = parseSessionIdField(record.sessionId, 'snapshot.sessionId', issues)
  const revision = parseSessionRevisionField(record.revision, 'snapshot.revision', issues)
  const writtenAt = parseTimestampField(record.writtenAt, 'snapshot.writtenAt', issues)

  if (
    options.expectedSessionId !== undefined &&
    sessionId !== undefined &&
    sessionId !== options.expectedSessionId
  ) {
    addValidationIssue(
      issues,
      'snapshot.sessionId',
      'session-id-mismatch',
      'snapshot.sessionId must match the requested sessionId',
    )
  }

  const state = validateAuthoritativeSessionStateSnapshot<TMapDocument>(
    record.state,
    'snapshot.state',
    issues,
    sessionId ?? options.expectedSessionId,
    revision,
  )

  if (
    issues.length > 0 ||
    sessionId === undefined ||
    revision === undefined ||
    writtenAt === undefined ||
    state === undefined
  ) {
    return { valid: false, issues }
  }

  return {
    valid: true,
    issues: [],
    snapshot: {
      schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
      sessionId,
      revision,
      writtenAt,
      state,
    },
  }
}

export const readSessionSnapshot = <TMapDocument = unknown>(
  sessionId: SessionId,
  options: SessionSnapshotPathOptions = {},
): ReadSessionSnapshotResult<TMapDocument> => {
  const directoryPath = sessionSnapshotDirectoryPathFor(sessionId, options)
  const filePath = sessionSnapshotFilePathFor(sessionId, options)
  let raw: string

  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    if (isNotFoundError(error)) {
      return createReadFailure(
        'not-found',
        directoryPath,
        filePath,
        `No session snapshot found for ${sessionId}`,
      )
    }

    return createReadFailure(
      'read-error',
      directoryPath,
      filePath,
      `Could not read session snapshot for ${sessionId}`,
      { error },
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    return createReadFailure(
      'invalid-json',
      directoryPath,
      filePath,
      `Session snapshot for ${sessionId} is not valid JSON`,
      { error },
    )
  }

  const validation = validatePersistedSessionSnapshot<TMapDocument>(parsed, {
    expectedSessionId: sessionId,
  })
  if (!validation.valid) {
    return createReadFailure(
      'invalid-shape',
      directoryPath,
      filePath,
      `Session snapshot for ${sessionId} has invalid shape: ${validationIssueSummary(
        validation.issues,
      )}`,
      { issues: validation.issues },
    )
  }

  return {
    ok: true,
    directoryPath,
    filePath,
    snapshot: validation.snapshot,
    bytesRead: Buffer.byteLength(raw, 'utf8'),
  }
}

export const recoverSessionStateFromSnapshot = <TMapDocument = unknown>(
  sessionId: SessionId,
  options: SessionSnapshotPathOptions = {},
): RecoverSessionStateResult<TMapDocument> => {
  const readResult = readSessionSnapshot<TMapDocument>(sessionId, options)
  if (!readResult.ok) {
    return {
      recovered: false,
      source: 'snapshot',
      directoryPath: readResult.directoryPath,
      filePath: readResult.filePath,
      reason: readResult.reason,
      message: readResult.message,
      ...(readResult.issues === undefined ? {} : { issues: readResult.issues }),
      ...(readResult.error === undefined ? {} : { error: readResult.error }),
    }
  }

  return {
    recovered: true,
    source: 'snapshot',
    directoryPath: readResult.directoryPath,
    filePath: readResult.filePath,
    snapshot: readResult.snapshot,
    state: readResult.snapshot.state,
    revision: readResult.snapshot.revision,
    warnings: [],
  }
}

export const cleanupStaleSessionSnapshotTempFiles = (
  sessionId: SessionId,
  options: SessionSnapshotPathOptions = {},
): readonly string[] => {
  const directoryPath = sessionSnapshotDirectoryPathFor(sessionId, options)
  let entries: Dirent[]

  try {
    entries = readdirSync(directoryPath, { withFileTypes: true })
  } catch {
    return []
  }

  const removed: string[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !isSessionSnapshotTempFileName(entry.name)) continue

    const tempFilePath = joinSafeUnderRoot(directoryPath, '', entry.name)
    try {
      unlinkSync(tempFilePath)
      removed.push(tempFilePath)
    } catch {
      // Leave files we cannot remove for later/manual cleanup.
    }
  }

  return removed.sort()
}

export const writeSessionSnapshot = <TMapDocument = unknown>(
  state: AuthoritativeSessionState<TMapDocument>,
  options: WriteSessionSnapshotOptions<TMapDocument> = {},
): WriteSessionSnapshotResult<TMapDocument> => {
  const snapshot = createPersistedSessionSnapshot(state, {
    clock: options.clock,
  })
  const json = serializeSessionSnapshot(snapshot)
  const filePath = sessionSnapshotFilePathFor(snapshot.sessionId, options)
  const directoryPath = dirname(filePath)
  const tempFileName = options.tempFileName ?? defaultTempFileName
  const tempFilePath = joinSafeUnderRoot(directoryPath, '', tempFileName())
  const flushToDisk = options.flushToDisk !== false

  mkdirSync(directoryPath, { recursive: true })

  let fd: number | undefined
  try {
    fd = openSync(tempFilePath, 'wx', 0o600)
    writeFileSync(fd, json, 'utf8')
    if (flushToDisk) fsyncSync(fd)
    closeSync(fd)
    fd = undefined

    options.onBeforePublish?.({
      directoryPath,
      filePath,
      tempFilePath,
      json,
      snapshot,
    })

    renameSync(tempFilePath, filePath)
    if (flushToDisk) flushDirectoryBestEffort(directoryPath)
  } catch (err) {
    closeFileBestEffort(fd)
    unlinkFileBestEffort(tempFilePath)
    throw err
  }

  return {
    directoryPath,
    filePath,
    snapshot,
    bytesWritten: Buffer.byteLength(json, 'utf8'),
  }
}
