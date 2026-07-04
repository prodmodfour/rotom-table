import { isSlug, SLUG_PATTERN_DESCRIPTION } from './paths'

export const LIVE_PLAY_PRESENCE_SCHEMA_VERSION = 1 as const

/**
 * Presence is short-lived table-feel state. It is intentionally separate from
 * live-play command envelopes and must never be treated as gameplay authority.
 */
export const LIVE_PLAY_PRESENCE_AUTHORITY = 'ephemeral-presentation' as const
export const LIVE_PLAY_PRESENCE_AUTHORITY_DESCRIPTION =
  'Live-play presence is ephemeral presentation state only; it is not an authoritative live-play command and must not mutate campaign, map, sheet, inventory, revision, or durable realtime state.' as const

export const LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE = 'live-play-presence-updated' as const

export const LIVE_PLAY_PRESENCE_ROLES = ['gm', 'player'] as const
export type LivePlayPresenceRole = (typeof LIVE_PLAY_PRESENCE_ROLES)[number]

export const LIVE_PLAY_PRESENCE_INTENT_KINDS = [
  'idle',
  'moving-token',
  'targeting',
  'measuring',
  'placing-ping',
  'viewing-sheet',
] as const
export type LivePlayPresenceIntentKind = (typeof LIVE_PLAY_PRESENCE_INTENT_KINDS)[number]

export const LIVE_PLAY_PRESENCE_ACCENTS = [
  'rose',
  'orange',
  'amber',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'fuchsia',
  'slate',
] as const
export type LivePlayPresenceAccent = (typeof LIVE_PLAY_PRESENCE_ACCENTS)[number]

export const LIVE_PLAY_PRESENCE_MAX_TOKEN_ID_CHARS = 96 as const
export const LIVE_PLAY_PRESENCE_MAX_DISPLAY_NAME_CHARS = 64 as const
export const LIVE_PLAY_PRESENCE_MAX_PING_LABEL_CHARS = 32 as const
export const LIVE_PLAY_PRESENCE_MAX_PING_ID_CHARS = 64 as const
export const LIVE_PLAY_PRESENCE_MAX_INTENT_COUNT = 256 as const
export const LIVE_PLAY_PRESENCE_MAX_INTENT_AREA_CELLS = 512 as const
export const LIVE_PLAY_PRESENCE_DEFAULT_PING_TTL_MS = 4_000 as const
export const LIVE_PLAY_PRESENCE_MAX_PING_TTL_MS = 8_000 as const
export const LIVE_PLAY_PRESENCE_CLIENT_ID_SUFFIX_MIN_CHARS = 4 as const
export const LIVE_PLAY_PRESENCE_CLIENT_ID_SUFFIX_MAX_CHARS = 12 as const
export const LIVE_PLAY_PRESENCE_CLIENT_ID_SUFFIX_DEFAULT_CHARS = 8 as const
export const LIVE_PLAY_PRESENCE_GRID_COORDINATE_LIMIT = 100_000 as const
export const LIVE_PLAY_PRESENCE_MAX_SNAPSHOT_ENTRIES = 128 as const

export const LIVE_PLAY_PRESENCE_TOKEN_ID_PATTERN_DESCRIPTION =
  '/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/' as const
export const LIVE_PLAY_PRESENCE_TOKEN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/
export const LIVE_PLAY_PRESENCE_PING_ID_PATTERN_DESCRIPTION =
  '/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/' as const
export const LIVE_PLAY_PRESENCE_PING_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
export const LIVE_PLAY_PRESENCE_CLIENT_ID_SUFFIX_PATTERN_DESCRIPTION =
  '/^[A-Za-z0-9_-]{4,12}$/ without the raw client_ prefix' as const
export const LIVE_PLAY_PRESENCE_CLIENT_ID_SUFFIX_RE = /^[A-Za-z0-9_-]{4,12}$/
export const LIVE_PLAY_PRESENCE_RAW_CLIENT_ID_PREFIX_RE = /^client_/i

export const LIVE_PLAY_PRESENCE_VALIDATION_CODES = [
  'not-object',
  'missing-field',
  'unknown-field',
  'forbidden-authority-field',
  'invalid-schema-version',
  'invalid-authority',
  'invalid-role',
  'invalid-client-id-suffix',
  'invalid-accent',
  'invalid-display-name',
  'invalid-token-id',
  'invalid-intent',
  'invalid-ping',
  'invalid-grid-cell',
  'invalid-sequence',
  'invalid-timestamp',
  'invalid-map-slug',
  'invalid-realtime-event',
  'too-many-entries',
] as const
export type LivePlayPresenceValidationCode = (typeof LIVE_PLAY_PRESENCE_VALIDATION_CODES)[number]

export interface LivePlayPresenceValidationIssue {
  readonly path: string
  readonly code: LivePlayPresenceValidationCode
  readonly message: string
}

export interface LivePlayPresenceParticipantSummary {
  readonly role: LivePlayPresenceRole
  /** Optional selected profile display name after display-safety sanitation. */
  readonly profileDisplayName?: string
  /** A short suffix of the client id; never the raw client id. */
  readonly clientIdSuffix: string
  /** Stable visual accent derived by the server/client from non-secret context. */
  readonly accent: LivePlayPresenceAccent
}

export interface LivePlayPresenceGridCell {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface LivePlayPresenceIntentAreaSummary {
  /** Rounded count of public map cells affected by an area preview. */
  readonly cellCount: number
}

export interface LivePlayPresenceIntentState {
  readonly kind: LivePlayPresenceIntentKind
  /** Visible source token only; never a raw profile, sheet, move, or command id. */
  readonly sourceTokenId?: string
  /** Safe count of public candidate tokens/cells, without exposing target ids. */
  readonly candidateCount?: number
  /** Safe count of selected or affected public targets, without exposing target ids. */
  readonly targetCount?: number
  /** Optional public map cell summary for movement, measuring, or area aim. */
  readonly cell?: LivePlayPresenceGridCell
  readonly area?: LivePlayPresenceIntentAreaSummary
}

export interface LivePlayPresencePingPayload {
  /** Transient ping id for local duplicate suppression only. */
  readonly id: string
  readonly cell: LivePlayPresenceGridCell
  readonly label?: string
  readonly createdAt: number
  readonly expiresAt: number
}

export interface LivePlayPresenceUpdate {
  readonly schemaVersion: typeof LIVE_PLAY_PRESENCE_SCHEMA_VERSION
  readonly authority: typeof LIVE_PLAY_PRESENCE_AUTHORITY
  readonly clientSequence: number
  readonly selectedTokenId: string | null
  readonly hoveredTokenId: string | null
  readonly intent: LivePlayPresenceIntentState
  readonly ping: LivePlayPresencePingPayload | null
}

export interface LivePlayPresenceEntry extends LivePlayPresenceUpdate {
  readonly participant: LivePlayPresenceParticipantSummary
  readonly lastSeenAt: number
  readonly expiresAt: number
}

export interface LivePlayPresenceSnapshot {
  readonly schemaVersion: typeof LIVE_PLAY_PRESENCE_SCHEMA_VERSION
  readonly authority: typeof LIVE_PLAY_PRESENCE_AUTHORITY
  readonly mapSlug: string
  readonly serverTime: number
  readonly entries: readonly LivePlayPresenceEntry[]
}

export interface LivePlayPresenceRealtimeEventDraft {
  readonly channel: `map:${string}`
  readonly type: typeof LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE
  readonly mapSlug: string
  readonly data: LivePlayPresenceSnapshot
}

export interface LivePlayPresenceRealtimeEvent extends LivePlayPresenceRealtimeEventDraft {
  readonly timestamp: number
}

export interface ParseLivePlayPresenceSuccess<TPayload> {
  readonly valid: true
  readonly payload: TPayload
  readonly issues: readonly []
}

export interface ParseLivePlayPresenceFailure {
  readonly valid: false
  readonly issues: readonly LivePlayPresenceValidationIssue[]
}

export type ParseLivePlayPresenceResult<TPayload> =
  | ParseLivePlayPresenceSuccess<TPayload>
  | ParseLivePlayPresenceFailure

type UnknownRecord = Record<string, unknown>
type MutableIssueList = LivePlayPresenceValidationIssue[]

const presenceRoleSet = new Set<unknown>(LIVE_PLAY_PRESENCE_ROLES)
const presenceIntentKindSet = new Set<unknown>(LIVE_PLAY_PRESENCE_INTENT_KINDS)
const presenceAccentSet = new Set<unknown>(LIVE_PLAY_PRESENCE_ACCENTS)

const UPDATE_FIELDS = new Set([
  'schemaVersion',
  'authority',
  'clientSequence',
  'selectedTokenId',
  'hoveredTokenId',
  'intent',
  'ping',
])
const PARTICIPANT_FIELDS = new Set(['role', 'profileDisplayName', 'clientIdSuffix', 'accent'])
const INTENT_FIELDS = new Set(['kind', 'sourceTokenId', 'candidateCount', 'targetCount', 'cell', 'area'])
const INTENT_AREA_FIELDS = new Set(['cellCount'])
const CELL_FIELDS = new Set(['x', 'y', 'z'])
const PING_FIELDS = new Set(['id', 'cell', 'label', 'createdAt', 'expiresAt'])
const ENTRY_FIELDS = new Set([...UPDATE_FIELDS, 'participant', 'lastSeenAt', 'expiresAt'])
const SNAPSHOT_FIELDS = new Set(['schemaVersion', 'authority', 'mapSlug', 'serverTime', 'entries'])
const REALTIME_EVENT_DRAFT_FIELDS = new Set(['channel', 'type', 'mapSlug', 'data'])
const REALTIME_EVENT_FIELDS = new Set([...REALTIME_EVENT_DRAFT_FIELDS, 'timestamp'])

const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  'sequence',
  'opId',
  'type',
  'baseRevision',
  'revision',
  'previousRevision',
  'timestamp',
  'scopes',
  'payload',
  'patches',
  'command',
  'commandBody',
  'commandPayload',
  'commandResult',
  'moveName',
  'moveSlug',
  'abilityName',
  'orderName',
  'maneuverName',
  'pokeballName',
  'candidateIds',
  'selectedTargetIds',
  'affectedIds',
  'targetIds',
  'targetId',
  'hitChances',
  'map',
  'mapDocument',
  'mapRevision',
  'placements',
  'voxels',
  'metadata',
  'sheet',
  'sheets',
  'sheetPayload',
  'sheetDocument',
  'pokemonSheet',
  'trainerSheet',
  'profileId',
  'playerProfile',
  'playerProfileId',
  'gmKey',
  'accessGate',
  'hostname',
  'host',
  'secret',
  'credentials',
  'password',
  'cookie',
])

const DISPLAY_NAME_DELIMITER_RE = /[<>]/g
const DISPLAY_TEXT_CONTROL_RE = /[\u0000-\u001F\u007F]/g
const DISPLAY_TEXT_FORMAT_CONTROL_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g
const DISPLAY_TEXT_WHITESPACE_RE = /[\s\u00A0]+/g
const CLIENT_ID_SAFE_CHARS_RE = /[^A-Za-z0-9_-]/g

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOwn = (record: UnknownRecord, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(record, key)
)

const addIssue = (
  issues: MutableIssueList,
  path: string,
  code: LivePlayPresenceValidationCode,
  message: string,
): void => {
  issues.push({ path, code, message })
}

const requireField = (
  record: UnknownRecord,
  key: string,
  path: string,
  issues: MutableIssueList,
): boolean => {
  if (hasOwn(record, key)) return true
  addIssue(issues, path, 'missing-field', `${path} is required.`)
  return false
}

const rejectUnknownFields = (
  record: UnknownRecord,
  allowed: ReadonlySet<string>,
  path: string,
  issues: MutableIssueList,
): void => {
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue
    const fieldPath = path ? `${path}.${key}` : key
    if (FORBIDDEN_AUTHORITY_FIELDS.has(key)) {
      addIssue(
        issues,
        fieldPath,
        'forbidden-authority-field',
        `${fieldPath} is not allowed in ephemeral live-play presence. Use authoritative live-play command routes for gameplay state.`,
      )
      continue
    }
    addIssue(issues, fieldPath, 'unknown-field', `${fieldPath} is not a supported live-play presence field.`)
  }
}

const isSafeNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
)

const isSafeGridCoordinate = (value: unknown): value is number => (
  typeof value === 'number'
  && Number.isSafeInteger(value)
  && Math.abs(value) <= LIVE_PLAY_PRESENCE_GRID_COORDINATE_LIMIT
)

const codePointLength = (value: string): number => Array.from(value).length

const sanitizeDisplayTextString = (value: string, maxChars: number): string => (
  Array.from(
    value
      .normalize('NFKC')
      .replace(DISPLAY_NAME_DELIMITER_RE, '')
      .replace(DISPLAY_TEXT_CONTROL_RE, ' ')
      .replace(DISPLAY_TEXT_FORMAT_CONTROL_RE, '')
      .replace(DISPLAY_TEXT_WHITESPACE_RE, ' ')
      .trim(),
  )
    .slice(0, maxChars)
    .join('')
    .trim()
)

const parseOptionalDisplayText = (
  value: unknown,
  path: string,
  maxChars: number,
  code: LivePlayPresenceValidationCode,
  issues: MutableIssueList,
): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    addIssue(issues, path, code, `${path} must be a string when present.`)
    return undefined
  }
  if (codePointLength(value) > maxChars) {
    addIssue(issues, path, code, `${path} must be at most ${maxChars} display characters.`)
    return undefined
  }
  const sanitized = sanitizeDisplayTextString(value, maxChars)
  return sanitized || undefined
}

const parseSchemaVersionAndAuthority = (
  record: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  requireField(record, 'schemaVersion', path ? `${path}.schemaVersion` : 'schemaVersion', issues)
  requireField(record, 'authority', path ? `${path}.authority` : 'authority', issues)

  if (hasOwn(record, 'schemaVersion') && record.schemaVersion !== LIVE_PLAY_PRESENCE_SCHEMA_VERSION) {
    addIssue(
      issues,
      path ? `${path}.schemaVersion` : 'schemaVersion',
      'invalid-schema-version',
      `${path ? `${path}.` : ''}schemaVersion must be ${LIVE_PLAY_PRESENCE_SCHEMA_VERSION}.`,
    )
  }
  if (hasOwn(record, 'authority') && record.authority !== LIVE_PLAY_PRESENCE_AUTHORITY) {
    addIssue(
      issues,
      path ? `${path}.authority` : 'authority',
      'invalid-authority',
      `${path ? `${path}.` : ''}authority must be ${LIVE_PLAY_PRESENCE_AUTHORITY}.`,
    )
  }
}

const parseTokenId = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): string | null => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !LIVE_PLAY_PRESENCE_TOKEN_ID_RE.test(value)) {
    addIssue(
      issues,
      path,
      'invalid-token-id',
      `${path} must match ${LIVE_PLAY_PRESENCE_TOKEN_ID_PATTERN_DESCRIPTION}.`,
    )
    return null
  }
  return value
}

const parseTimestamp = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): number | null => {
  if (!isSafeNonNegativeInteger(value)) {
    addIssue(issues, path, 'invalid-timestamp', `${path} must be a safe non-negative integer timestamp.`)
    return null
  }
  return value
}

const parseClientSequence = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): number | null => {
  if (!isSafeNonNegativeInteger(value)) {
    addIssue(issues, path, 'invalid-sequence', `${path} must be a safe non-negative integer sequence.`)
    return null
  }
  return value
}

const parseGridCellInternal = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): LivePlayPresenceGridCell | null => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-grid-cell', `${path} must be an object with safe integer x, y, and z values.`)
    return null
  }
  rejectUnknownFields(value, CELL_FIELDS, path, issues)
  for (const field of CELL_FIELDS) requireField(value, field, `${path}.${field}`, issues)

  if (!isSafeGridCoordinate(value.x) || !isSafeGridCoordinate(value.y) || !isSafeGridCoordinate(value.z)) {
    addIssue(
      issues,
      path,
      'invalid-grid-cell',
      `${path} must contain safe integer x, y, and z values within ±${LIVE_PLAY_PRESENCE_GRID_COORDINATE_LIMIT}.`,
    )
    return null
  }
  return { x: value.x, y: value.y, z: value.z }
}

const parseIntentCount = (
  value: unknown,
  path: string,
  maxValue: number,
  issues: MutableIssueList,
): number | null => {
  if (!isSafeNonNegativeInteger(value) || value > maxValue) {
    addIssue(issues, path, 'invalid-intent', `${path} must be a safe integer between 0 and ${maxValue}.`)
    return null
  }
  return value
}

const parseOptionalIntentCount = (
  value: unknown,
  path: string,
  maxValue: number,
  issues: MutableIssueList,
): number | undefined => {
  if (value === undefined || value === null) return undefined
  return parseIntentCount(value, path, maxValue, issues) ?? undefined
}

const parseIntentAreaInternal = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): LivePlayPresenceIntentAreaSummary | null => {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-intent', `${path} must be an object with a safe cellCount.`)
    return null
  }
  rejectUnknownFields(value, INTENT_AREA_FIELDS, path, issues)
  requireField(value, 'cellCount', `${path}.cellCount`, issues)

  const cellCount = parseIntentCount(value.cellCount, `${path}.cellCount`, LIVE_PLAY_PRESENCE_MAX_INTENT_AREA_CELLS, issues)
  if (cellCount === null) return null
  return { cellCount }
}

const parseOptionalIntentTokenId = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): string | undefined => {
  if (value === undefined || value === null) return undefined
  return parseTokenId(value, path, issues) ?? undefined
}

const parseOptionalIntentCell = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): LivePlayPresenceGridCell | undefined => {
  if (value === undefined || value === null) return undefined
  return parseGridCellInternal(value, path, issues) ?? undefined
}

const parseOptionalIntentArea = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): LivePlayPresenceIntentAreaSummary | undefined => {
  if (value === undefined || value === null) return undefined
  return parseIntentAreaInternal(value, path, issues) ?? undefined
}

const parseIntentInternal = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): LivePlayPresenceIntentState | null => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-intent', `${path} must be an object with an allowed kind.`)
    return null
  }
  rejectUnknownFields(value, INTENT_FIELDS, path, issues)
  requireField(value, 'kind', `${path}.kind`, issues)

  if (!presenceIntentKindSet.has(value.kind)) {
    addIssue(
      issues,
      `${path}.kind`,
      'invalid-intent',
      `${path}.kind must be one of ${LIVE_PLAY_PRESENCE_INTENT_KINDS.join(', ')}.`,
    )
    return null
  }

  const sourceTokenId = parseOptionalIntentTokenId(value.sourceTokenId, `${path}.sourceTokenId`, issues)
  const candidateCount = parseOptionalIntentCount(
    value.candidateCount,
    `${path}.candidateCount`,
    LIVE_PLAY_PRESENCE_MAX_INTENT_COUNT,
    issues,
  )
  const targetCount = parseOptionalIntentCount(
    value.targetCount,
    `${path}.targetCount`,
    LIVE_PLAY_PRESENCE_MAX_INTENT_COUNT,
    issues,
  )
  const cell = parseOptionalIntentCell(value.cell, `${path}.cell`, issues)
  const area = parseOptionalIntentArea(value.area, `${path}.area`, issues)

  return {
    kind: value.kind as LivePlayPresenceIntentKind,
    ...(sourceTokenId === undefined ? {} : { sourceTokenId }),
    ...(candidateCount === undefined ? {} : { candidateCount }),
    ...(targetCount === undefined ? {} : { targetCount }),
    ...(cell === undefined ? {} : { cell }),
    ...(area === undefined ? {} : { area }),
  }
}

const parsePingInternal = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): LivePlayPresencePingPayload | null => {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-ping', `${path} must be a ping object or null.`)
    return null
  }
  rejectUnknownFields(value, PING_FIELDS, path, issues)
  for (const field of ['id', 'cell', 'createdAt', 'expiresAt']) requireField(value, field, `${path}.${field}`, issues)

  const id = typeof value.id === 'string' && LIVE_PLAY_PRESENCE_PING_ID_RE.test(value.id)
    ? value.id
    : null
  if (id === null) {
    addIssue(issues, `${path}.id`, 'invalid-ping', `${path}.id must match ${LIVE_PLAY_PRESENCE_PING_ID_PATTERN_DESCRIPTION}.`)
  }

  const cell = parseGridCellInternal(value.cell, `${path}.cell`, issues)
  const label = parseOptionalDisplayText(
    value.label,
    `${path}.label`,
    LIVE_PLAY_PRESENCE_MAX_PING_LABEL_CHARS,
    'invalid-ping',
    issues,
  )
  const createdAt = parseTimestamp(value.createdAt, `${path}.createdAt`, issues)
  const expiresAt = parseTimestamp(value.expiresAt, `${path}.expiresAt`, issues)
  const durationMs = createdAt !== null && expiresAt !== null ? expiresAt - createdAt : null
  if (durationMs !== null && durationMs <= 0) {
    addIssue(issues, `${path}.expiresAt`, 'invalid-ping', `${path}.expiresAt must be newer than ${path}.createdAt.`)
  }
  if (durationMs !== null && durationMs > LIVE_PLAY_PRESENCE_MAX_PING_TTL_MS) {
    addIssue(
      issues,
      `${path}.expiresAt`,
      'invalid-ping',
      `${path} must expire within ${LIVE_PLAY_PRESENCE_MAX_PING_TTL_MS}ms of ${path}.createdAt.`,
    )
  }

  if (id === null || cell === null || createdAt === null || expiresAt === null || durationMs === null || durationMs <= 0 || durationMs > LIVE_PLAY_PRESENCE_MAX_PING_TTL_MS) return null
  return {
    id,
    cell,
    ...(label === undefined ? {} : { label }),
    createdAt,
    expiresAt,
  }
}

const parseUpdateInternal = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
  allowedFields: ReadonlySet<string> = UPDATE_FIELDS,
): LivePlayPresenceUpdate | null => {
  if (!isRecord(value)) {
    addIssue(issues, path || '$', 'not-object', `${path || 'Live-play presence update'} must be an object.`)
    return null
  }
  rejectUnknownFields(value, allowedFields, path, issues)
  parseSchemaVersionAndAuthority(value, path, issues)
  requireField(value, 'clientSequence', path ? `${path}.clientSequence` : 'clientSequence', issues)
  requireField(value, 'intent', path ? `${path}.intent` : 'intent', issues)

  const clientSequence = parseClientSequence(
    value.clientSequence,
    path ? `${path}.clientSequence` : 'clientSequence',
    issues,
  )
  const selectedTokenId = parseTokenId(
    value.selectedTokenId,
    path ? `${path}.selectedTokenId` : 'selectedTokenId',
    issues,
  )
  const hoveredTokenId = parseTokenId(
    value.hoveredTokenId,
    path ? `${path}.hoveredTokenId` : 'hoveredTokenId',
    issues,
  )
  const intent = parseIntentInternal(value.intent, path ? `${path}.intent` : 'intent', issues)
  const ping = parsePingInternal(value.ping, path ? `${path}.ping` : 'ping', issues)

  if (clientSequence === null || intent === null) return null
  return {
    schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
    authority: LIVE_PLAY_PRESENCE_AUTHORITY,
    clientSequence,
    selectedTokenId,
    hoveredTokenId,
    intent,
    ping,
  }
}

const parseParticipantInternal = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): LivePlayPresenceParticipantSummary | null => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'not-object', `${path} must be a participant summary object.`)
    return null
  }
  rejectUnknownFields(value, PARTICIPANT_FIELDS, path, issues)
  for (const field of ['role', 'clientIdSuffix', 'accent']) requireField(value, field, `${path}.${field}`, issues)

  const role = presenceRoleSet.has(value.role) ? value.role as LivePlayPresenceRole : null
  if (role === null) {
    addIssue(issues, `${path}.role`, 'invalid-role', `${path}.role must be gm or player.`)
  }

  const profileDisplayName = parseOptionalDisplayText(
    value.profileDisplayName,
    `${path}.profileDisplayName`,
    LIVE_PLAY_PRESENCE_MAX_DISPLAY_NAME_CHARS,
    'invalid-display-name',
    issues,
  )

  const clientIdSuffix = typeof value.clientIdSuffix === 'string'
    && LIVE_PLAY_PRESENCE_CLIENT_ID_SUFFIX_RE.test(value.clientIdSuffix)
    && !LIVE_PLAY_PRESENCE_RAW_CLIENT_ID_PREFIX_RE.test(value.clientIdSuffix)
    ? value.clientIdSuffix
    : null
  if (clientIdSuffix === null) {
    addIssue(
      issues,
      `${path}.clientIdSuffix`,
      'invalid-client-id-suffix',
      `${path}.clientIdSuffix must match ${LIVE_PLAY_PRESENCE_CLIENT_ID_SUFFIX_PATTERN_DESCRIPTION}.`,
    )
  }

  const accent = presenceAccentSet.has(value.accent) ? value.accent as LivePlayPresenceAccent : null
  if (accent === null) {
    addIssue(issues, `${path}.accent`, 'invalid-accent', `${path}.accent must be a supported presence accent.`)
  }

  if (role === null || clientIdSuffix === null || accent === null) return null
  return {
    role,
    ...(profileDisplayName === undefined ? {} : { profileDisplayName }),
    clientIdSuffix,
    accent,
  }
}

const parseEntryInternal = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): LivePlayPresenceEntry | null => {
  if (!isRecord(value)) {
    addIssue(issues, path || '$', 'not-object', `${path || 'Live-play presence entry'} must be an object.`)
    return null
  }
  rejectUnknownFields(value, ENTRY_FIELDS, path, issues)
  requireField(value, 'participant', path ? `${path}.participant` : 'participant', issues)
  requireField(value, 'lastSeenAt', path ? `${path}.lastSeenAt` : 'lastSeenAt', issues)
  requireField(value, 'expiresAt', path ? `${path}.expiresAt` : 'expiresAt', issues)

  const update = parseUpdateInternal(value, path, issues, ENTRY_FIELDS)
  const participant = parseParticipantInternal(value.participant, path ? `${path}.participant` : 'participant', issues)
  const lastSeenAt = parseTimestamp(value.lastSeenAt, path ? `${path}.lastSeenAt` : 'lastSeenAt', issues)
  const expiresAt = parseTimestamp(value.expiresAt, path ? `${path}.expiresAt` : 'expiresAt', issues)
  if (lastSeenAt !== null && expiresAt !== null && expiresAt <= lastSeenAt) {
    addIssue(
      issues,
      path ? `${path}.expiresAt` : 'expiresAt',
      'invalid-timestamp',
      `${path ? `${path}.` : ''}expiresAt must be newer than ${path ? `${path}.` : ''}lastSeenAt.`,
    )
  }

  if (update === null || participant === null || lastSeenAt === null || expiresAt === null || expiresAt <= lastSeenAt) return null
  return {
    ...update,
    participant,
    lastSeenAt,
    expiresAt,
  }
}

const parseSnapshotInternal = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): LivePlayPresenceSnapshot | null => {
  if (!isRecord(value)) {
    addIssue(issues, path || '$', 'not-object', `${path || 'Live-play presence snapshot'} must be an object.`)
    return null
  }
  rejectUnknownFields(value, SNAPSHOT_FIELDS, path, issues)
  parseSchemaVersionAndAuthority(value, path, issues)
  requireField(value, 'mapSlug', path ? `${path}.mapSlug` : 'mapSlug', issues)
  requireField(value, 'serverTime', path ? `${path}.serverTime` : 'serverTime', issues)
  requireField(value, 'entries', path ? `${path}.entries` : 'entries', issues)

  const mapSlug = isSlug(value.mapSlug) ? value.mapSlug : null
  if (mapSlug === null) {
    addIssue(
      issues,
      path ? `${path}.mapSlug` : 'mapSlug',
      'invalid-map-slug',
      `${path ? `${path}.` : ''}mapSlug must match ${SLUG_PATTERN_DESCRIPTION}.`,
    )
  }
  const serverTime = parseTimestamp(value.serverTime, path ? `${path}.serverTime` : 'serverTime', issues)

  let entries: LivePlayPresenceEntry[] | null = null
  if (!Array.isArray(value.entries)) {
    addIssue(issues, path ? `${path}.entries` : 'entries', 'not-object', `${path ? `${path}.` : ''}entries must be an array.`)
  } else if (value.entries.length > LIVE_PLAY_PRESENCE_MAX_SNAPSHOT_ENTRIES) {
    addIssue(
      issues,
      path ? `${path}.entries` : 'entries',
      'too-many-entries',
      `${path ? `${path}.` : ''}entries must contain at most ${LIVE_PLAY_PRESENCE_MAX_SNAPSHOT_ENTRIES} presence entries.`,
    )
  } else {
    entries = []
    value.entries.forEach((entry, index) => {
      const parsed = parseEntryInternal(entry, path ? `${path}.entries[${index}]` : `entries[${index}]`, issues)
      if (parsed !== null) entries?.push(parsed)
    })
  }

  if (mapSlug === null || serverTime === null || entries === null) return null
  return {
    schemaVersion: LIVE_PLAY_PRESENCE_SCHEMA_VERSION,
    authority: LIVE_PLAY_PRESENCE_AUTHORITY,
    mapSlug,
    serverTime,
    entries,
  }
}

const realtimeEventPath = (path: string, key: string): string => (path ? `${path}.${key}` : key)

function parsePresenceRealtimeEventInternal(
  value: unknown,
  path: string,
  issues: MutableIssueList,
  options: { readonly requireTimestamp: true },
): LivePlayPresenceRealtimeEvent | null
function parsePresenceRealtimeEventInternal(
  value: unknown,
  path: string,
  issues: MutableIssueList,
  options: { readonly requireTimestamp: false },
): LivePlayPresenceRealtimeEventDraft | null
function parsePresenceRealtimeEventInternal(
  value: unknown,
  path: string,
  issues: MutableIssueList,
  options: { readonly requireTimestamp: boolean },
): LivePlayPresenceRealtimeEvent | LivePlayPresenceRealtimeEventDraft | null {
  if (!isRecord(value)) {
    addIssue(issues, path || '$', 'not-object', `${path || 'Live-play presence realtime event'} must be an object.`)
    return null
  }

  rejectUnknownFields(value, options.requireTimestamp ? REALTIME_EVENT_FIELDS : REALTIME_EVENT_DRAFT_FIELDS, path, issues)
  for (const field of ['channel', 'type', 'mapSlug', 'data']) {
    requireField(value, field, realtimeEventPath(path, field), issues)
  }
  if (options.requireTimestamp) requireField(value, 'timestamp', realtimeEventPath(path, 'timestamp'), issues)

  const type = hasOwn(value, 'type') && value.type === LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE
    ? LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE
    : null
  if (hasOwn(value, 'type') && type === null) {
    addIssue(
      issues,
      realtimeEventPath(path, 'type'),
      'invalid-realtime-event',
      `${realtimeEventPath(path, 'type')} must be ${LIVE_PLAY_PRESENCE_REALTIME_EVENT_TYPE}.`,
    )
  }

  const mapSlug = hasOwn(value, 'mapSlug') && isSlug(value.mapSlug) ? value.mapSlug : null
  if (hasOwn(value, 'mapSlug') && mapSlug === null) {
    addIssue(
      issues,
      realtimeEventPath(path, 'mapSlug'),
      'invalid-map-slug',
      `${realtimeEventPath(path, 'mapSlug')} must match ${SLUG_PATTERN_DESCRIPTION}.`,
    )
  }

  const expectedChannel = mapSlug === null ? null : `map:${mapSlug}`
  const channel = hasOwn(value, 'channel') && typeof value.channel === 'string' && value.channel === expectedChannel
    ? value.channel as `map:${string}`
    : null
  if (hasOwn(value, 'channel') && channel === null) {
    addIssue(
      issues,
      realtimeEventPath(path, 'channel'),
      'invalid-realtime-event',
      expectedChannel === null
        ? `${realtimeEventPath(path, 'channel')} must be a map presence channel.`
        : `${realtimeEventPath(path, 'channel')} must be ${expectedChannel}.`,
    )
  }

  const data = hasOwn(value, 'data')
    ? parseSnapshotInternal(value.data, realtimeEventPath(path, 'data'), issues)
    : null
  if (data !== null && mapSlug !== null && data.mapSlug !== mapSlug) {
    addIssue(
      issues,
      realtimeEventPath(path, 'data.mapSlug'),
      'invalid-map-slug',
      `${realtimeEventPath(path, 'data.mapSlug')} must match ${realtimeEventPath(path, 'mapSlug')}.`,
    )
  }

  const timestamp = options.requireTimestamp && hasOwn(value, 'timestamp')
    ? parseTimestamp(value.timestamp, realtimeEventPath(path, 'timestamp'), issues)
    : null

  if (type === null || mapSlug === null || channel === null || data === null || data.mapSlug !== mapSlug) return null

  const event: LivePlayPresenceRealtimeEventDraft = {
    channel,
    type,
    mapSlug,
    data,
  }
  if (!options.requireTimestamp) return event
  if (timestamp === null) return null
  return { ...event, timestamp }
}

const toParseResult = <TPayload>(payload: TPayload | null, issues: MutableIssueList): ParseLivePlayPresenceResult<TPayload> => {
  if (payload === null || issues.length > 0) return { valid: false, issues }
  return { valid: true, payload, issues: [] }
}

export const isLivePlayPresenceRole = (value: unknown): value is LivePlayPresenceRole => (
  presenceRoleSet.has(value)
)

export const isLivePlayPresenceIntentKind = (value: unknown): value is LivePlayPresenceIntentKind => (
  presenceIntentKindSet.has(value)
)

export const isLivePlayPresenceAccent = (value: unknown): value is LivePlayPresenceAccent => (
  presenceAccentSet.has(value)
)

export const isLivePlayPresenceValidationCode = (
  value: unknown,
): value is LivePlayPresenceValidationCode => (
  (LIVE_PLAY_PRESENCE_VALIDATION_CODES as readonly unknown[]).includes(value)
)

export const sanitizeLivePlayPresenceDisplayName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  return sanitizeDisplayTextString(value, LIVE_PLAY_PRESENCE_MAX_DISPLAY_NAME_CHARS) || undefined
}

export const sanitizeLivePlayPresencePingLabel = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  return sanitizeDisplayTextString(value, LIVE_PLAY_PRESENCE_MAX_PING_LABEL_CHARS) || undefined
}

export const livePlayPresenceClientIdSuffix = (
  clientId: unknown,
  length: number = LIVE_PLAY_PRESENCE_CLIENT_ID_SUFFIX_DEFAULT_CHARS,
): string => {
  const clampedLength = Math.max(
    LIVE_PLAY_PRESENCE_CLIENT_ID_SUFFIX_MIN_CHARS,
    Math.min(LIVE_PLAY_PRESENCE_CLIENT_ID_SUFFIX_MAX_CHARS, Math.floor(length)),
  )
  const sanitized = typeof clientId === 'string'
    ? clientId.replace(LIVE_PLAY_PRESENCE_RAW_CLIENT_ID_PREFIX_RE, '').replace(CLIENT_ID_SAFE_CHARS_RE, '')
    : ''
  const suffix = sanitized.slice(-clampedLength)
  if (suffix.length >= LIVE_PLAY_PRESENCE_CLIENT_ID_SUFFIX_MIN_CHARS) return suffix
  return 'anon'
}

export const livePlayPresenceAccentForKey = (value: unknown): LivePlayPresenceAccent => {
  const text = typeof value === 'string' && value.length > 0 ? value : 'presence'
  let hash = 0
  for (const character of text) {
    hash = ((hash << 5) - hash + character.codePointAt(0)!) | 0
  }
  return LIVE_PLAY_PRESENCE_ACCENTS[Math.abs(hash) % LIVE_PLAY_PRESENCE_ACCENTS.length]
}

export interface BuildLivePlayPresenceParticipantSummaryInput {
  readonly role: LivePlayPresenceRole
  readonly clientId: string
  readonly profileDisplayName?: unknown
  readonly accentSeed?: unknown
}

export const buildLivePlayPresenceParticipantSummary = (
  input: BuildLivePlayPresenceParticipantSummaryInput,
): LivePlayPresenceParticipantSummary => {
  const clientIdSuffix = livePlayPresenceClientIdSuffix(input.clientId)
  const profileDisplayName = sanitizeLivePlayPresenceDisplayName(input.profileDisplayName)
  return {
    role: input.role,
    ...(profileDisplayName === undefined ? {} : { profileDisplayName }),
    clientIdSuffix,
    accent: livePlayPresenceAccentForKey(input.accentSeed ?? input.clientId),
  }
}

export const parseLivePlayPresenceParticipantSummary = (
  value: unknown,
): ParseLivePlayPresenceResult<LivePlayPresenceParticipantSummary> => {
  const issues: MutableIssueList = []
  return toParseResult(parseParticipantInternal(value, '$', issues), issues)
}

export const parseLivePlayPresenceIntentState = (
  value: unknown,
): ParseLivePlayPresenceResult<LivePlayPresenceIntentState> => {
  const issues: MutableIssueList = []
  return toParseResult(parseIntentInternal(value, '$', issues), issues)
}

export const parseLivePlayPresencePingPayload = (
  value: unknown,
): ParseLivePlayPresenceResult<LivePlayPresencePingPayload> => {
  const issues: MutableIssueList = []
  return toParseResult(parsePingInternal(value, '$', issues), issues)
}

export const parseLivePlayPresenceUpdate = (
  value: unknown,
): ParseLivePlayPresenceResult<LivePlayPresenceUpdate> => {
  const issues: MutableIssueList = []
  return toParseResult(parseUpdateInternal(value, '', issues), issues)
}

export const parseLivePlayPresenceEntry = (
  value: unknown,
): ParseLivePlayPresenceResult<LivePlayPresenceEntry> => {
  const issues: MutableIssueList = []
  return toParseResult(parseEntryInternal(value, '', issues), issues)
}

export const parseLivePlayPresenceSnapshot = (
  value: unknown,
): ParseLivePlayPresenceResult<LivePlayPresenceSnapshot> => {
  const issues: MutableIssueList = []
  return toParseResult(parseSnapshotInternal(value, '', issues), issues)
}

export const parseLivePlayPresenceRealtimeEventDraft = (
  value: unknown,
): ParseLivePlayPresenceResult<LivePlayPresenceRealtimeEventDraft> => {
  const issues: MutableIssueList = []
  return toParseResult(parsePresenceRealtimeEventInternal(value, '', issues, { requireTimestamp: false }), issues)
}

export const parseLivePlayPresenceRealtimeEvent = (
  value: unknown,
): ParseLivePlayPresenceResult<LivePlayPresenceRealtimeEvent> => {
  const issues: MutableIssueList = []
  return toParseResult(parsePresenceRealtimeEventInternal(value, '', issues, { requireTimestamp: true }), issues)
}

export const isLivePlayPresenceUpdate = (value: unknown): value is LivePlayPresenceUpdate => (
  parseLivePlayPresenceUpdate(value).valid
)

export const isLivePlayPresenceEntry = (value: unknown): value is LivePlayPresenceEntry => (
  parseLivePlayPresenceEntry(value).valid
)

export const isLivePlayPresenceSnapshot = (value: unknown): value is LivePlayPresenceSnapshot => (
  parseLivePlayPresenceSnapshot(value).valid
)

export const isLivePlayPresenceRealtimeEventDraft = (value: unknown): value is LivePlayPresenceRealtimeEventDraft => (
  parseLivePlayPresenceRealtimeEventDraft(value).valid
)

export const isLivePlayPresenceRealtimeEvent = (value: unknown): value is LivePlayPresenceRealtimeEvent => (
  parseLivePlayPresenceRealtimeEvent(value).valid
)
