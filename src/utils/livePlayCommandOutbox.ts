import { isAuthRole, type AuthRole } from '#shared/auth'
import {
  LIVE_PLAY_COMMAND_TYPES,
  isLivePlayMapCommandType,
  isLivePlayMapSlug,
  isLivePlayOpId,
  validateLivePlayCommandEnvelope,
  validateShopCheckoutCommandEnvelope,
  type LivePlayCommandType,
  type LivePlayMapCommandType,
  type LivePlayShopCheckoutCommandType,
} from '#shared/livePlayCommands'
import { isSlug } from '#shared/paths'
import { isPlayerProfileId, type PlayerProfileId } from '#shared/playerProfiles'

export const LIVE_PLAY_COMMAND_OUTBOX_DB_NAME = 'rotom-table-client' as const
export const LIVE_PLAY_COMMAND_OUTBOX_DB_VERSION = 1 as const
export const LIVE_PLAY_COMMAND_OUTBOX_STORE_NAME = 'livePlayCommandOutbox' as const
export const LIVE_PLAY_COMMAND_OUTBOX_SCHEMA_VERSION = 1 as const

export const LIVE_PLAY_COMMAND_OUTBOX_MAX_BODY_BYTES = 256 * 1024
export const LIVE_PLAY_COMMAND_OUTBOX_DEFAULT_MAX_ENTRIES = 100
export const LIVE_PLAY_COMMAND_OUTBOX_DEFAULT_LEASE_DURATION_MS = 30_000
export const LIVE_PLAY_COMMAND_OUTBOX_MIN_LEASE_DURATION_MS = 1
export const LIVE_PLAY_COMMAND_OUTBOX_MAX_LEASE_DURATION_MS = 5 * 60_000
export const LIVE_PLAY_COMMAND_OUTBOX_MAX_LAST_ERROR_LENGTH = 1_000
export const LIVE_PLAY_COMMAND_OUTBOX_MAX_LEASE_OWNER_LENGTH = 256
export const LIVE_PLAY_COMMAND_OUTBOX_RECOVERY_ERROR =
  'The previous send ended without a terminal response.'

export type LivePlayCommandOutboxState = 'queued' | 'sending' | 'uncertain'

export interface LivePlayCommandOutboxAuthContext {
  readonly role: AuthRole
  readonly profileId?: PlayerProfileId | null
}

export interface LivePlayCommandOutboxEntry {
  readonly schemaVersion: typeof LIVE_PLAY_COMMAND_OUTBOX_SCHEMA_VERSION
  readonly opId: string
  readonly mapSlug?: string
  readonly shopSlug?: string
  readonly commandType: LivePlayCommandType
  readonly requestPath: string
  readonly body: Record<string, unknown>
  readonly authContext: LivePlayCommandOutboxAuthContext
  readonly fingerprint: string
  readonly state: LivePlayCommandOutboxState
  readonly createdAt: number
  readonly updatedAt: number
  readonly attemptCount: number
  readonly lastAttemptAt?: number
  readonly lastError?: string
  readonly leaseOwner?: string
  readonly leaseExpiresAt?: number
}

export type LivePlayMapCommandOutboxEntry = LivePlayCommandOutboxEntry & {
  readonly mapSlug: string
  readonly shopSlug?: never
  readonly commandType: LivePlayMapCommandType
}

export type ShopCheckoutCommandOutboxEntry = LivePlayCommandOutboxEntry & {
  readonly mapSlug?: never
  readonly shopSlug: string
  readonly commandType: LivePlayShopCheckoutCommandType
}

export type LivePlayCommandOutboxCorruptRecordKind =
  | 'malformed'
  | 'unsupported-schema-version'

export interface LivePlayCommandOutboxCorruptRecord {
  readonly kind: LivePlayCommandOutboxCorruptRecordKind
  readonly opId?: string
  readonly schemaVersion?: unknown
  readonly message: string
}

export interface LivePlayCommandOutboxInspectResult {
  readonly entries: readonly LivePlayCommandOutboxEntry[]
  readonly corruptRecords: readonly LivePlayCommandOutboxCorruptRecord[]
}

export interface LivePlayCommandOutboxListFilter {
  readonly mapSlug?: string
  readonly shopSlug?: string
  readonly authContext?: LivePlayCommandOutboxAuthContext
  readonly states?: readonly LivePlayCommandOutboxState[]
}

export interface LivePlayCommandOutboxEnqueueInput {
  readonly requestPath: string
  readonly body: Record<string, unknown>
  readonly authContext: LivePlayCommandOutboxAuthContext
  readonly now?: number
}

export interface LivePlayCommandOutboxClaimInput {
  readonly opId: string
  readonly leaseOwner: string
  readonly now?: number
  readonly leaseDurationMs?: number
}

export type LivePlayCommandOutboxClaimResult =
  | {
      readonly claimed: true
      readonly entry: LivePlayCommandOutboxEntry
    }
  | {
      readonly claimed: false
      readonly reason: 'missing' | 'leased-by-another-owner'
    }

export interface LivePlayCommandOutboxMarkUncertainInput {
  readonly opId: string
  readonly leaseOwner: string
  readonly error: string
  readonly now?: number
}

export interface LivePlayCommandOutbox {
  enqueue(input: LivePlayCommandOutboxEnqueueInput): Promise<LivePlayCommandOutboxEntry>
  claimForSend(input: LivePlayCommandOutboxClaimInput): Promise<LivePlayCommandOutboxClaimResult>
  markUncertain(input: LivePlayCommandOutboxMarkUncertainInput): Promise<LivePlayCommandOutboxEntry | null>
  acknowledgeTerminal(opId: string): Promise<LivePlayCommandOutboxEntry | null>
  recoverExpiredLeases(now?: number): Promise<readonly LivePlayCommandOutboxEntry[]>
  get(opId: string): Promise<LivePlayCommandOutboxEntry | null>
  list(filter?: LivePlayCommandOutboxListFilter): Promise<readonly LivePlayCommandOutboxEntry[]>
  inspect(): Promise<LivePlayCommandOutboxInspectResult>
  hasPending(filter?: LivePlayCommandOutboxListFilter): Promise<boolean>
  count(filter?: LivePlayCommandOutboxListFilter): Promise<number>
  discard(opId: string): Promise<LivePlayCommandOutboxEntry | null>
  close(): void
}

export type LivePlayCommandOutboxErrorCode =
  | 'live-play-command-outbox-unavailable'
  | 'live-play-command-outbox-validation-error'
  | 'live-play-command-outbox-idempotency-conflict'
  | 'live-play-command-outbox-capacity-exceeded'
  | 'live-play-command-outbox-corrupt-record'
  | 'live-play-command-outbox-unsupported-record'

export class LivePlayCommandOutboxError extends Error {
  readonly code: LivePlayCommandOutboxErrorCode

  constructor(code: LivePlayCommandOutboxErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LivePlayCommandOutboxError'
    this.code = code
  }
}

export class LivePlayCommandOutboxUnavailableError extends LivePlayCommandOutboxError {
  constructor(message: string, options?: ErrorOptions) {
    super('live-play-command-outbox-unavailable', message, options)
    this.name = 'LivePlayCommandOutboxUnavailableError'
  }
}

export class LivePlayCommandOutboxValidationError extends LivePlayCommandOutboxError {
  constructor(message: string, options?: ErrorOptions) {
    super('live-play-command-outbox-validation-error', message, options)
    this.name = 'LivePlayCommandOutboxValidationError'
  }
}

export class LivePlayCommandOutboxIdempotencyConflictError extends LivePlayCommandOutboxError {
  constructor(message: string, options?: ErrorOptions) {
    super('live-play-command-outbox-idempotency-conflict', message, options)
    this.name = 'LivePlayCommandOutboxIdempotencyConflictError'
  }
}

export class LivePlayCommandOutboxCapacityExceededError extends LivePlayCommandOutboxError {
  constructor(message: string, options?: ErrorOptions) {
    super('live-play-command-outbox-capacity-exceeded', message, options)
    this.name = 'LivePlayCommandOutboxCapacityExceededError'
  }
}

export class LivePlayCommandOutboxCorruptRecordError extends LivePlayCommandOutboxError {
  constructor(message: string, options?: ErrorOptions) {
    super('live-play-command-outbox-corrupt-record', message, options)
    this.name = 'LivePlayCommandOutboxCorruptRecordError'
  }
}

export class LivePlayCommandOutboxUnsupportedRecordError extends LivePlayCommandOutboxError {
  constructor(message: string, options?: ErrorOptions) {
    super('live-play-command-outbox-unsupported-record', message, options)
    this.name = 'LivePlayCommandOutboxUnsupportedRecordError'
  }
}

export interface CreateLivePlayCommandOutboxOptions {
  readonly databaseName?: string
  readonly indexedDBFactory?: IDBFactory
  readonly maxEntries?: number
}

type UnknownRecord = Record<string, unknown>

type LivePlayCommandOutboxIdentity =
  | {
      readonly kind: 'map'
      readonly opId: string
      readonly mapSlug: string
      readonly commandType: LivePlayMapCommandType
    }
  | {
      readonly kind: 'shop'
      readonly opId: string
      readonly shopSlug: string
      readonly commandType: LivePlayShopCheckoutCommandType
    }

type StoredRecordParseResult =
  | { readonly ok: true; readonly entry: LivePlayCommandOutboxEntry }
  | { readonly ok: false; readonly corruptRecord: LivePlayCommandOutboxCorruptRecord }

const OUTBOX_STATES = ['queued', 'sending', 'uncertain'] as const satisfies readonly LivePlayCommandOutboxState[]
const OUTBOX_STATE_SET = new Set<unknown>(OUTBOX_STATES)

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const isSafeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isOutboxState = (value: unknown): value is LivePlayCommandOutboxState =>
  OUTBOX_STATE_SET.has(value)

export const isShopCheckoutCommandOutboxEntry = (
  entry: LivePlayCommandOutboxEntry,
): entry is ShopCheckoutCommandOutboxEntry => (
  entry.commandType === LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT && typeof entry.shopSlug === 'string'
)

export const isLivePlayMapCommandOutboxEntry = (
  entry: LivePlayCommandOutboxEntry,
): entry is LivePlayMapCommandOutboxEntry => (
  isLivePlayMapCommandType(entry.commandType) && typeof entry.mapSlug === 'string'
)

const describeValue = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const validationError = (message: string): LivePlayCommandOutboxValidationError =>
  new LivePlayCommandOutboxValidationError(message)

const assertSafeTimestamp = (value: number | undefined, label: string): number => {
  const timestamp = value ?? Date.now()
  if (!isSafeNonNegativeInteger(timestamp)) {
    throw validationError(`${label} must be a safe non-negative integer timestamp.`)
  }
  return timestamp
}

const assertLivePlayOpId = (opId: string): string => {
  if (!isLivePlayOpId(opId)) {
    throw validationError('opId must match the shared live-play operation-ID format.')
  }
  return opId
}

const assertLeaseOwner = (leaseOwner: string): string => {
  if (
    typeof leaseOwner !== 'string' ||
    leaseOwner.trim().length === 0 ||
    leaseOwner.length > LIVE_PLAY_COMMAND_OUTBOX_MAX_LEASE_OWNER_LENGTH
  ) {
    throw validationError(
      `leaseOwner must be a non-empty string of at most ${LIVE_PLAY_COMMAND_OUTBOX_MAX_LEASE_OWNER_LENGTH} characters.`,
    )
  }
  return leaseOwner
}

const assertLeaseDuration = (leaseDurationMs: number | undefined): number => {
  const duration = leaseDurationMs ?? LIVE_PLAY_COMMAND_OUTBOX_DEFAULT_LEASE_DURATION_MS
  if (
    !isSafeNonNegativeInteger(duration) ||
    duration < LIVE_PLAY_COMMAND_OUTBOX_MIN_LEASE_DURATION_MS ||
    duration > LIVE_PLAY_COMMAND_OUTBOX_MAX_LEASE_DURATION_MS
  ) {
    throw validationError(
      `leaseDurationMs must be between ${LIVE_PLAY_COMMAND_OUTBOX_MIN_LEASE_DURATION_MS} and ${LIVE_PLAY_COMMAND_OUTBOX_MAX_LEASE_DURATION_MS} milliseconds.`,
    )
  }
  return duration
}

const assertMaxEntries = (value: number | undefined): number => {
  const maxEntries = value ?? LIVE_PLAY_COMMAND_OUTBOX_DEFAULT_MAX_ENTRIES
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw validationError('maxEntries must be a positive safe integer.')
  }
  return maxEntries
}

const assertRequestPath = (requestPath: string): string => {
  if (typeof requestPath !== 'string') {
    throw validationError('requestPath must be a string.')
  }

  if (!requestPath.startsWith('/api/')) {
    throw validationError('requestPath must be a same-origin API path beginning with /api/.')
  }

  if (requestPath.includes('?') || requestPath.includes('#')) {
    throw validationError('requestPath must not contain a query string or fragment.')
  }

  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(requestPath) ||
    requestPath.startsWith('//') ||
    requestPath.includes('://')
  ) {
    throw validationError('requestPath must not contain a protocol or hostname.')
  }

  if (/\p{C}/u.test(requestPath)) {
    throw validationError('requestPath must not contain control characters.')
  }

  return requestPath
}

const assertJsonValue = (
  value: unknown,
  path: string,
  seen: WeakSet<object> = new WeakSet<object>(),
): void => {
  if (value === null) return

  const valueType = typeof value
  if (valueType === 'string' || valueType === 'boolean') return

  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw validationError(`${path} must be a finite JSON number.`)
    }
    return
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw validationError(`${path} must not contain circular references.`)
    }
    seen.add(value)
    try {
      for (let index = 0; index < value.length; index += 1) {
        if (!hasOwn(value as unknown as UnknownRecord, String(index))) {
          throw validationError(`${path} must not contain sparse array holes.`)
        }
        assertJsonValue(value[index], `${path}[${index}]`, seen)
      }
    } finally {
      seen.delete(value)
    }
    return
  }

  if (isPlainRecord(value)) {
    if (seen.has(value)) {
      throw validationError(`${path} must not contain circular references.`)
    }
    seen.add(value)
    try {
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw validationError(`${path} must not contain symbol keys.`)
      }

      for (const [key, child] of Object.entries(value)) {
        if (child === undefined) {
          throw validationError(`${path}.${key} must not be undefined.`)
        }
        assertJsonValue(child, `${path}.${key}`, seen)
      }
    } finally {
      seen.delete(value)
    }
    return
  }

  throw validationError(`${path} must be JSON serialisable; received ${describeValue(value)}.`)
}

const jsonStringByteLength = (value: string): number => new TextEncoder().encode(value).byteLength

const stringifyBodyForStorage = (body: Record<string, unknown>): string => {
  if (!isPlainRecord(body)) {
    throw validationError('body must be a plain JSON object.')
  }

  assertJsonValue(body, 'body')

  const serialized = JSON.stringify(body)
  if (serialized === undefined) {
    throw validationError('body must be JSON serialisable.')
  }

  const byteLength = jsonStringByteLength(serialized)
  if (byteLength > LIVE_PLAY_COMMAND_OUTBOX_MAX_BODY_BYTES) {
    throw validationError(
      `body must be at most ${LIVE_PLAY_COMMAND_OUTBOX_MAX_BODY_BYTES} bytes when JSON serialised.`,
    )
  }

  return serialized
}

const cloneJson = <TValue>(value: TValue): TValue => JSON.parse(JSON.stringify(value)) as TValue

const cloneBodyForStorage = (body: Record<string, unknown>): Record<string, unknown> =>
  cloneJson(body)

const normalizeAuthContext = (
  authContext: LivePlayCommandOutboxAuthContext,
): LivePlayCommandOutboxAuthContext => {
  if (!isPlainRecord(authContext)) {
    throw validationError('authContext must be an object.')
  }

  if (!isAuthRole(authContext.role)) {
    throw validationError('authContext.role must be a valid auth role.')
  }

  const profileId = authContext.profileId ?? null
  if (profileId !== null && !isPlayerProfileId(profileId)) {
    throw validationError('authContext.profileId must be a valid player profile ID when present.')
  }

  return {
    role: authContext.role,
    profileId,
  }
}

const authContextsEqual = (
  left: LivePlayCommandOutboxAuthContext,
  right: LivePlayCommandOutboxAuthContext,
): boolean => left.role === right.role && (left.profileId ?? null) === (right.profileId ?? null)

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      throw validationError('fingerprint input must be JSON serialisable.')
    }
    return serialized
  }

  if (Array.isArray(value)) {
    return `[${value.map((child) => stableStringify(child)).join(',')}]`
  }

  const record = value as UnknownRecord
  const properties = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')

  return `{${properties}}`
}

export const createLivePlayCommandOutboxFingerprint = (input: {
  readonly requestPath: string
  readonly body: Record<string, unknown>
  readonly authContext: LivePlayCommandOutboxAuthContext
}): string => {
  const requestPath = assertRequestPath(input.requestPath)
  stringifyBodyForStorage(input.body)
  return stableStringify({
    authContext: normalizeAuthContext(input.authContext),
    body: cloneBodyForStorage(input.body),
    requestPath,
  })
}

const validatedCommandIdentityFromBody = (
  body: Record<string, unknown>,
): LivePlayCommandOutboxIdentity => {
  if (body.type === LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT) {
    const result = validateShopCheckoutCommandEnvelope(body)
    if (!result.valid) {
      const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
      throw validationError(`body is not a valid shop checkout live-play command envelope: ${summary}`)
    }

    const opId = result.command.opId
    const payload = result.command.payload
    if (!isLivePlayOpId(opId)) {
      throw validationError('body.opId must match the shared live-play operation-ID format.')
    }
    if (!isPlainRecord(payload) || !isSlug(payload.shopSlug)) {
      throw validationError('body.payload.shopSlug must match the shared slug format.')
    }

    return {
      kind: 'shop',
      opId,
      shopSlug: payload.shopSlug,
      commandType: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
    }
  }

  const result = validateLivePlayCommandEnvelope(body)
  if (!result.valid) {
    const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
    throw validationError(`body is not a valid live-play command envelope: ${summary}`)
  }

  const opId = result.command.opId
  const mapSlug = result.command.mapSlug
  const commandType = result.command.type

  if (!isLivePlayOpId(opId)) {
    throw validationError('body.opId must match the shared live-play operation-ID format.')
  }
  if (!isLivePlayMapSlug(mapSlug)) {
    throw validationError('body.mapSlug must match the shared live-play map slug format.')
  }
  if (!isLivePlayMapCommandType(commandType)) {
    throw validationError('body.type must be a supported map live-play command type.')
  }

  return { kind: 'map', opId, mapSlug, commandType }
}

const sanitizeLastError = (error: string): string => {
  const trimmed = String(error).trim()
  const message = trimmed.length > 0
    ? trimmed
    : 'The command outcome is uncertain because the send failed before a terminal response.'
  return Array.from(message).slice(0, LIVE_PLAY_COMMAND_OUTBOX_MAX_LAST_ERROR_LENGTH).join('')
}

const sortEntries = (
  entries: readonly LivePlayCommandOutboxEntry[],
): readonly LivePlayCommandOutboxEntry[] => [...entries].sort((left, right) => {
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
  if (left.opId < right.opId) return -1
  if (left.opId > right.opId) return 1
  return 0
})

const cloneEntry = (entry: LivePlayCommandOutboxEntry): LivePlayCommandOutboxEntry =>
  cloneJson(entry)

const cloneEntries = (
  entries: readonly LivePlayCommandOutboxEntry[],
): readonly LivePlayCommandOutboxEntry[] => entries.map((entry) => cloneEntry(entry))

const cloneInspectResult = (
  result: LivePlayCommandOutboxInspectResult,
): LivePlayCommandOutboxInspectResult => ({
  entries: cloneEntries(result.entries),
  corruptRecords: cloneJson(result.corruptRecords),
})

const identityFieldsFromEntry = (
  entry: LivePlayCommandOutboxEntry,
): Pick<LivePlayCommandOutboxEntry, 'mapSlug' | 'shopSlug'> => (
  isShopCheckoutCommandOutboxEntry(entry)
    ? { shopSlug: entry.shopSlug }
    : { mapSlug: entry.mapSlug }
)

const identityFieldsFromBody = (
  identity: LivePlayCommandOutboxIdentity,
): Pick<LivePlayCommandOutboxEntry, 'mapSlug' | 'shopSlug'> => (
  identity.kind === 'shop'
    ? { shopSlug: identity.shopSlug }
    : { mapSlug: identity.mapSlug }
)

const assertStoredEntry = (raw: unknown): LivePlayCommandOutboxEntry => {
  if (!isPlainRecord(raw)) {
    throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox record is not an object.')
  }

  if (raw.schemaVersion !== LIVE_PLAY_COMMAND_OUTBOX_SCHEMA_VERSION) {
    throw new LivePlayCommandOutboxCorruptRecordError(
      `Stored outbox record schemaVersion must be ${LIVE_PLAY_COMMAND_OUTBOX_SCHEMA_VERSION}.`,
    )
  }

  const body = raw.body
  if (!isPlainRecord(body)) {
    throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox record body is not an object.')
  }

  const serializedBody = stringifyBodyForStorage(body)
  const bodyClone = JSON.parse(serializedBody) as Record<string, unknown>
  const identity = validatedCommandIdentityFromBody(bodyClone)

  if (raw.opId !== identity.opId) {
    throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox opId does not match body.opId.')
  }
  if (identity.kind === 'map') {
    if (raw.mapSlug !== identity.mapSlug) {
      throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox mapSlug does not match body.mapSlug.')
    }
    if (hasOwn(raw, 'shopSlug')) {
      throw new LivePlayCommandOutboxCorruptRecordError('Stored map outbox record must not contain shopSlug.')
    }
  } else {
    if (raw.shopSlug !== identity.shopSlug) {
      throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox shopSlug does not match body.payload.shopSlug.')
    }
    if (hasOwn(raw, 'mapSlug')) {
      throw new LivePlayCommandOutboxCorruptRecordError('Stored shop checkout outbox record must not contain mapSlug.')
    }
  }
  if (raw.commandType !== identity.commandType) {
    throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox commandType does not match body.type.')
  }

  if (typeof raw.requestPath !== 'string') {
    throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox requestPath is not a string.')
  }
  const requestPath = assertRequestPath(raw.requestPath)

  if (!isPlainRecord(raw.authContext)) {
    throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox authContext is not an object.')
  }
  const authContext = normalizeAuthContext(
    raw.authContext as unknown as LivePlayCommandOutboxAuthContext,
  )

  if (typeof raw.fingerprint !== 'string' || raw.fingerprint.length === 0) {
    throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox fingerprint is invalid.')
  }
  const expectedFingerprint = createLivePlayCommandOutboxFingerprint({
    requestPath,
    body: bodyClone,
    authContext,
  })
  if (raw.fingerprint !== expectedFingerprint) {
    throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox fingerprint does not match command identity data.')
  }

  if (!isOutboxState(raw.state)) {
    throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox state is invalid.')
  }
  if (!isSafeNonNegativeInteger(raw.createdAt)) {
    throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox createdAt is invalid.')
  }
  if (!isSafeNonNegativeInteger(raw.updatedAt)) {
    throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox updatedAt is invalid.')
  }
  if (!isSafeNonNegativeInteger(raw.attemptCount)) {
    throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox attemptCount is invalid.')
  }

  const entry: LivePlayCommandOutboxEntry = {
    schemaVersion: LIVE_PLAY_COMMAND_OUTBOX_SCHEMA_VERSION,
    opId: identity.opId,
    ...identityFieldsFromBody(identity),
    commandType: identity.commandType,
    requestPath,
    body: bodyClone,
    authContext,
    fingerprint: raw.fingerprint,
    state: raw.state,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    attemptCount: raw.attemptCount,
  }

  if (hasOwn(raw, 'lastAttemptAt')) {
    if (!isSafeNonNegativeInteger(raw.lastAttemptAt)) {
      throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox lastAttemptAt is invalid.')
    }
    Object.assign(entry, { lastAttemptAt: raw.lastAttemptAt })
  }

  if (hasOwn(raw, 'lastError')) {
    if (
      typeof raw.lastError !== 'string' ||
      raw.lastError.length > LIVE_PLAY_COMMAND_OUTBOX_MAX_LAST_ERROR_LENGTH
    ) {
      throw new LivePlayCommandOutboxCorruptRecordError('Stored outbox lastError is invalid.')
    }
    Object.assign(entry, { lastError: raw.lastError })
  }

  if (entry.state === 'sending') {
    if (
      typeof raw.leaseOwner !== 'string' ||
      raw.leaseOwner.trim().length === 0 ||
      raw.leaseOwner.length > LIVE_PLAY_COMMAND_OUTBOX_MAX_LEASE_OWNER_LENGTH
    ) {
      throw new LivePlayCommandOutboxCorruptRecordError('Stored sending outbox leaseOwner is invalid.')
    }
    if (!isSafeNonNegativeInteger(raw.leaseExpiresAt)) {
      throw new LivePlayCommandOutboxCorruptRecordError('Stored sending outbox leaseExpiresAt is invalid.')
    }
    Object.assign(entry, {
      leaseOwner: raw.leaseOwner,
      leaseExpiresAt: raw.leaseExpiresAt,
    })
  } else if (hasOwn(raw, 'leaseOwner') || hasOwn(raw, 'leaseExpiresAt')) {
    throw new LivePlayCommandOutboxCorruptRecordError(
      'Stored non-sending outbox record must not contain lease fields.',
    )
  }

  return entry
}

const parseStoredRecord = (raw: unknown): StoredRecordParseResult => {
  const opId = isPlainRecord(raw) && typeof raw.opId === 'string' ? raw.opId : undefined
  const schemaVersion = isPlainRecord(raw) ? raw.schemaVersion : undefined

  if (
    isPlainRecord(raw) &&
    typeof raw.schemaVersion === 'number' &&
    Number.isSafeInteger(raw.schemaVersion) &&
    raw.schemaVersion > LIVE_PLAY_COMMAND_OUTBOX_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      corruptRecord: {
        kind: 'unsupported-schema-version',
        ...(opId === undefined ? {} : { opId }),
        schemaVersion: raw.schemaVersion,
        message: `Stored outbox record uses unsupported schemaVersion ${raw.schemaVersion}.`,
      },
    }
  }

  try {
    return { ok: true, entry: assertStoredEntry(raw) }
  } catch (error) {
    return {
      ok: false,
      corruptRecord: {
        kind: 'malformed',
        ...(opId === undefined ? {} : { opId }),
        ...(schemaVersion === undefined ? {} : { schemaVersion }),
        message: error instanceof Error ? error.message : 'Stored outbox record is malformed.',
      },
    }
  }
}

const parseExistingRecordForMutation = (raw: unknown): LivePlayCommandOutboxEntry => {
  const parsed = parseStoredRecord(raw)
  if (parsed.ok) return parsed.entry

  if (parsed.corruptRecord.kind === 'unsupported-schema-version') {
    throw new LivePlayCommandOutboxUnsupportedRecordError(
      `Cannot mutate unsupported live-play command outbox record for opId ${parsed.corruptRecord.opId ?? '(unknown)'}.`,
    )
  }

  throw new LivePlayCommandOutboxCorruptRecordError(
    `Cannot mutate malformed live-play command outbox record for opId ${parsed.corruptRecord.opId ?? '(unknown)'}.`,
  )
}

const entryMatchesFilter = (
  entry: LivePlayCommandOutboxEntry,
  filter: LivePlayCommandOutboxListFilter | undefined,
): boolean => {
  if (filter?.mapSlug !== undefined && entry.mapSlug !== filter.mapSlug) return false
  if (filter?.shopSlug !== undefined && entry.shopSlug !== filter.shopSlug) return false

  if (filter?.authContext !== undefined) {
    const authContext = normalizeAuthContext(filter.authContext)
    if (!authContextsEqual(entry.authContext, authContext)) return false
  }

  if (filter?.states !== undefined) {
    for (const state of filter.states) {
      if (!isOutboxState(state)) {
        throw validationError('states must contain only live-play command outbox states.')
      }
    }
    if (!filter.states.includes(entry.state)) return false
  }

  return true
}

const idbErrorMessage = (action: string, error: unknown): string => {
  if (error instanceof Error && error.message.length > 0) {
    return `${action}: ${error.message}`
  }
  return action
}

const unavailableError = (action: string, error?: unknown): LivePlayCommandOutboxUnavailableError =>
  new LivePlayCommandOutboxUnavailableError(idbErrorMessage(action, error), {
    cause: error instanceof Error ? error : undefined,
  })

const requestToPromise = <TResult>(request: IDBRequest<TResult>, action: string): Promise<TResult> =>
  new Promise<TResult>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(unavailableError(action, request.error ?? undefined))
  })

const transactionComplete = (transaction: IDBTransaction, action: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(unavailableError(action, transaction.error ?? undefined))
    transaction.onerror = () => {
      // IndexedDB will usually follow this with abort; keep the abort handler as the single reject path.
    }
  })

const ensureOutboxObjectStore = (database: IDBDatabase): void => {
  const store = database.objectStoreNames.contains(LIVE_PLAY_COMMAND_OUTBOX_STORE_NAME)
    ? undefined
    : database.createObjectStore(LIVE_PLAY_COMMAND_OUTBOX_STORE_NAME, { keyPath: 'opId' })

  if (store === undefined) return

  store.createIndex('mapSlug', 'mapSlug', { unique: false })
  store.createIndex('shopSlug', 'shopSlug', { unique: false })
  store.createIndex('state', 'state', { unique: false })
  store.createIndex('updatedAt', 'updatedAt', { unique: false })
  store.createIndex('createdAt', 'createdAt', { unique: false })
}

const resolveDefaultIndexedDBFactory = (): IDBFactory => {
  try {
    const factory = (globalThis as { readonly indexedDB?: IDBFactory }).indexedDB
    if (factory === undefined || factory === null) {
      throw new LivePlayCommandOutboxUnavailableError(
        'IndexedDB is not available for the live-play command outbox in this environment.',
      )
    }
    return factory
  } catch (error) {
    if (error instanceof LivePlayCommandOutboxUnavailableError) throw error
    throw unavailableError(
      'IndexedDB is not available for the live-play command outbox in this environment',
      error,
    )
  }
}

const cloneEntryForStorage = (entry: LivePlayCommandOutboxEntry): LivePlayCommandOutboxEntry =>
  cloneEntry(entry)

class IndexedDbLivePlayCommandOutbox implements LivePlayCommandOutbox {
  private readonly databaseName: string
  private readonly indexedDBFactory?: IDBFactory
  private readonly maxEntries: number
  private database: IDBDatabase | null = null
  private openPromise: Promise<IDBDatabase> | null = null

  constructor(options: CreateLivePlayCommandOutboxOptions = {}) {
    this.databaseName = options.databaseName ?? LIVE_PLAY_COMMAND_OUTBOX_DB_NAME
    this.indexedDBFactory = options.indexedDBFactory
    this.maxEntries = assertMaxEntries(options.maxEntries)
  }

  async enqueue(input: LivePlayCommandOutboxEnqueueInput): Promise<LivePlayCommandOutboxEntry> {
    const requestPath = assertRequestPath(input.requestPath)
    stringifyBodyForStorage(input.body)
    const body = cloneBodyForStorage(input.body)
    const identity = validatedCommandIdentityFromBody(body)
    const authContext = normalizeAuthContext(input.authContext)
    const now = assertSafeTimestamp(input.now, 'now')
    const fingerprint = createLivePlayCommandOutboxFingerprint({ requestPath, body, authContext })

    const entry: LivePlayCommandOutboxEntry = {
      schemaVersion: LIVE_PLAY_COMMAND_OUTBOX_SCHEMA_VERSION,
      opId: identity.opId,
      ...identityFieldsFromBody(identity),
      commandType: identity.commandType,
      requestPath,
      body,
      authContext,
      fingerprint,
      state: 'queued',
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
    }

    return this.runTransaction('readwrite', async (store) => {
      const existingRaw = await requestToPromise(
        store.get(identity.opId),
        'Failed to read the live-play command outbox entry during enqueue',
      )

      if (existingRaw !== undefined) {
        const existing = parseExistingRecordForMutation(existingRaw)
        if (existing.fingerprint === fingerprint) return cloneEntry(existing)

        throw new LivePlayCommandOutboxIdempotencyConflictError(
          `Cannot enqueue live-play command ${identity.opId}: the opId is already associated with a different command fingerprint.`,
        )
      }

      const retainedEntryCount = await requestToPromise(
        store.count(),
        'Failed to count live-play command outbox entries during enqueue',
      )
      if (retainedEntryCount >= this.maxEntries) {
        throw new LivePlayCommandOutboxCapacityExceededError(
          `Cannot enqueue live-play command ${identity.opId}: the outbox is at its ${this.maxEntries}-entry capacity.`,
        )
      }

      const storedEntry = cloneEntryForStorage(entry)
      await requestToPromise(
        store.add(storedEntry),
        'Failed to write the live-play command outbox entry during enqueue',
      )
      return storedEntry
    })
  }

  async claimForSend(input: LivePlayCommandOutboxClaimInput): Promise<LivePlayCommandOutboxClaimResult> {
    const opId = assertLivePlayOpId(input.opId)
    const leaseOwner = assertLeaseOwner(input.leaseOwner)
    const now = assertSafeTimestamp(input.now, 'now')
    const leaseDurationMs = assertLeaseDuration(input.leaseDurationMs)
    const leaseExpiresAt = now + leaseDurationMs
    if (!Number.isSafeInteger(leaseExpiresAt)) {
      throw validationError('leaseExpiresAt would exceed the safe integer timestamp range.')
    }

    return this.runTransaction('readwrite', async (store) => {
      const existingRaw = await requestToPromise(
        store.get(opId),
        'Failed to read the live-play command outbox entry during claim',
      )
      if (existingRaw === undefined) return { claimed: false, reason: 'missing' } as const

      const existing = parseStoredRecord(existingRaw)
      if (!existing.ok) return { claimed: false, reason: 'missing' } as const

      const entry = existing.entry
      const canClaim =
        entry.state === 'queued' ||
        entry.state === 'uncertain' ||
        (entry.state === 'sending' &&
          entry.leaseExpiresAt !== undefined &&
          entry.leaseExpiresAt <= now)

      if (!canClaim) return { claimed: false, reason: 'leased-by-another-owner' } as const

      const claimedEntry: LivePlayCommandOutboxEntry = {
        schemaVersion: entry.schemaVersion,
        opId: entry.opId,
        ...identityFieldsFromEntry(entry),
        commandType: entry.commandType,
        requestPath: entry.requestPath,
        body: entry.body,
        authContext: entry.authContext,
        fingerprint: entry.fingerprint,
        state: 'sending',
        createdAt: entry.createdAt,
        updatedAt: now,
        attemptCount: entry.attemptCount + 1,
        lastAttemptAt: now,
        leaseOwner,
        leaseExpiresAt,
      }
      const storedEntry = cloneEntryForStorage(claimedEntry)
      await requestToPromise(
        store.put(storedEntry),
        'Failed to write the live-play command outbox entry during claim',
      )
      return { claimed: true, entry: storedEntry } as const
    })
  }

  async markUncertain(
    input: LivePlayCommandOutboxMarkUncertainInput,
  ): Promise<LivePlayCommandOutboxEntry | null> {
    const opId = assertLivePlayOpId(input.opId)
    const leaseOwner = assertLeaseOwner(input.leaseOwner)
    const now = assertSafeTimestamp(input.now, 'now')
    const lastError = sanitizeLastError(input.error)

    return this.runTransaction('readwrite', async (store) => {
      const existingRaw = await requestToPromise(
        store.get(opId),
        'Failed to read the live-play command outbox entry during uncertain transition',
      )
      if (existingRaw === undefined) return null

      const existing = parseStoredRecord(existingRaw)
      if (!existing.ok) return null

      const entry = existing.entry
      if (entry.state !== 'sending' || entry.leaseOwner !== leaseOwner) {
        return cloneEntry(entry)
      }

      const uncertainEntry: LivePlayCommandOutboxEntry = {
        schemaVersion: entry.schemaVersion,
        opId: entry.opId,
        ...identityFieldsFromEntry(entry),
        commandType: entry.commandType,
        requestPath: entry.requestPath,
        body: entry.body,
        authContext: entry.authContext,
        fingerprint: entry.fingerprint,
        state: 'uncertain',
        createdAt: entry.createdAt,
        updatedAt: now,
        attemptCount: entry.attemptCount,
        ...(entry.lastAttemptAt === undefined ? {} : { lastAttemptAt: entry.lastAttemptAt }),
        lastError,
      }
      const storedEntry = cloneEntryForStorage(uncertainEntry)
      await requestToPromise(
        store.put(storedEntry),
        'Failed to write the live-play command outbox entry during uncertain transition',
      )
      return storedEntry
    })
  }

  async acknowledgeTerminal(opId: string): Promise<LivePlayCommandOutboxEntry | null> {
    const validatedOpId = assertLivePlayOpId(opId)

    return this.runTransaction('readwrite', async (store) => {
      const existingRaw = await requestToPromise(
        store.get(validatedOpId),
        'Failed to read the live-play command outbox entry during terminal acknowledgement',
      )
      if (existingRaw === undefined) return null

      const existing = parseStoredRecord(existingRaw)
      if (!existing.ok) return null

      await requestToPromise(
        store.delete(validatedOpId),
        'Failed to delete the live-play command outbox entry during terminal acknowledgement',
      )
      return existing.entry
    })
  }

  async recoverExpiredLeases(nowInput?: number): Promise<readonly LivePlayCommandOutboxEntry[]> {
    const now = assertSafeTimestamp(nowInput, 'now')

    return this.runTransaction('readwrite', async (store) => {
      const allRaw = await requestToPromise(
        store.getAll(),
        'Failed to list live-play command outbox entries during lease recovery',
      )
      const recoveredEntries: LivePlayCommandOutboxEntry[] = []

      for (const raw of allRaw) {
        const parsed = parseStoredRecord(raw)
        if (!parsed.ok) continue

        const entry = parsed.entry
        if (entry.state !== 'sending' || entry.leaseExpiresAt === undefined || entry.leaseExpiresAt > now) {
          continue
        }

        const recoveredEntry: LivePlayCommandOutboxEntry = {
          schemaVersion: entry.schemaVersion,
          opId: entry.opId,
          ...identityFieldsFromEntry(entry),
          commandType: entry.commandType,
          requestPath: entry.requestPath,
          body: entry.body,
          authContext: entry.authContext,
          fingerprint: entry.fingerprint,
          state: 'uncertain',
          createdAt: entry.createdAt,
          updatedAt: now,
          attemptCount: entry.attemptCount,
          ...(entry.lastAttemptAt === undefined ? {} : { lastAttemptAt: entry.lastAttemptAt }),
          lastError: LIVE_PLAY_COMMAND_OUTBOX_RECOVERY_ERROR,
        }
        const storedEntry = cloneEntryForStorage(recoveredEntry)
        await requestToPromise(
          store.put(storedEntry),
          'Failed to write the live-play command outbox entry during lease recovery',
        )
        recoveredEntries.push(storedEntry)
      }

      return sortEntries(recoveredEntries)
    })
  }

  async get(opId: string): Promise<LivePlayCommandOutboxEntry | null> {
    const validatedOpId = assertLivePlayOpId(opId)

    return this.runTransaction('readonly', async (store) => {
      const raw = await requestToPromise(
        store.get(validatedOpId),
        'Failed to read the live-play command outbox entry',
      )
      if (raw === undefined) return null
      const parsed = parseStoredRecord(raw)
      return parsed.ok ? parsed.entry : null
    })
  }

  async list(
    filter?: LivePlayCommandOutboxListFilter,
  ): Promise<readonly LivePlayCommandOutboxEntry[]> {
    return this.runTransaction('readonly', async (store) => {
      const allRaw = await requestToPromise(
        store.getAll(),
        'Failed to list live-play command outbox entries',
      )
      const entries = allRaw.flatMap((raw) => {
        const parsed = parseStoredRecord(raw)
        if (!parsed.ok) return []
        return entryMatchesFilter(parsed.entry, filter) ? [parsed.entry] : []
      })
      return sortEntries(entries)
    })
  }

  async inspect(): Promise<LivePlayCommandOutboxInspectResult> {
    return this.runTransaction('readonly', async (store) => {
      const allRaw = await requestToPromise(
        store.getAll(),
        'Failed to inspect live-play command outbox entries',
      )
      const entries: LivePlayCommandOutboxEntry[] = []
      const corruptRecords: LivePlayCommandOutboxCorruptRecord[] = []

      for (const raw of allRaw) {
        const parsed = parseStoredRecord(raw)
        if (parsed.ok) entries.push(parsed.entry)
        else corruptRecords.push(parsed.corruptRecord)
      }

      return {
        entries: sortEntries(entries),
        corruptRecords,
      }
    }, cloneInspectResult)
  }

  async hasPending(filter?: LivePlayCommandOutboxListFilter): Promise<boolean> {
    return (await this.count(filter)) > 0
  }

  async count(filter?: LivePlayCommandOutboxListFilter): Promise<number> {
    const entries = await this.list(filter)
    return entries.length
  }

  async discard(opId: string): Promise<LivePlayCommandOutboxEntry | null> {
    const validatedOpId = assertLivePlayOpId(opId)

    return this.runTransaction('readwrite', async (store) => {
      const existingRaw = await requestToPromise(
        store.get(validatedOpId),
        'Failed to read the live-play command outbox entry during discard',
      )
      if (existingRaw === undefined) return null

      const parsed = parseStoredRecord(existingRaw)
      await requestToPromise(
        store.delete(validatedOpId),
        'Failed to delete the live-play command outbox entry during discard',
      )
      return parsed.ok ? parsed.entry : null
    })
  }

  close(): void {
    this.database?.close()
    this.database = null
    this.openPromise = null
  }

  private async runTransaction<TResult>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => Promise<TResult>,
    cloneResult: (result: TResult) => TResult = cloneJson,
  ): Promise<TResult> {
    const database = await this.openDatabase()

    let transaction: IDBTransaction
    try {
      transaction = database.transaction(LIVE_PLAY_COMMAND_OUTBOX_STORE_NAME, mode)
    } catch (error) {
      this.database = null
      this.openPromise = null
      throw unavailableError('Failed to start the live-play command outbox IndexedDB transaction', error)
    }

    const done = transactionComplete(
      transaction,
      'The live-play command outbox IndexedDB transaction failed',
    )

    try {
      const result = await operation(transaction.objectStore(LIVE_PLAY_COMMAND_OUTBOX_STORE_NAME))
      await done
      return cloneResult(result)
    } catch (error) {
      done.catch(() => {})
      try {
        transaction.abort()
      } catch {
        // The transaction may already have completed or aborted.
      }

      if (error instanceof LivePlayCommandOutboxError) throw error
      throw unavailableError('The live-play command outbox IndexedDB operation failed', error)
    }
  }

  private async openDatabase(): Promise<IDBDatabase> {
    if (this.database !== null) return this.database
    if (this.openPromise !== null) return this.openPromise

    const factory = this.indexedDBFactory ?? resolveDefaultIndexedDBFactory()

    this.openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false
      let request: IDBOpenDBRequest

      const rejectOnce = (error: LivePlayCommandOutboxUnavailableError): void => {
        if (settled) return
        settled = true
        this.openPromise = null
        reject(error)
      }

      const resolveOnce = (database: IDBDatabase): void => {
        if (settled) {
          database.close()
          return
        }
        settled = true
        this.database = database
        resolve(database)
      }

      try {
        request = factory.open(this.databaseName, LIVE_PLAY_COMMAND_OUTBOX_DB_VERSION)
      } catch (error) {
        rejectOnce(unavailableError('Failed to open the live-play command outbox IndexedDB database', error))
        return
      }

      request.onupgradeneeded = () => {
        try {
          ensureOutboxObjectStore(request.result)
        } catch (error) {
          rejectOnce(
            unavailableError('Failed to migrate the live-play command outbox IndexedDB database', error),
          )
        }
      }

      request.onblocked = () => {
        rejectOnce(
          new LivePlayCommandOutboxUnavailableError(
            'Opening the live-play command outbox IndexedDB database is blocked by another connection.',
          ),
        )
      }

      request.onerror = () => {
        rejectOnce(
          unavailableError(
            'Failed to open the live-play command outbox IndexedDB database',
            request.error ?? undefined,
          ),
        )
      }

      request.onsuccess = () => {
        const database = request.result
        database.onversionchange = () => {
          database.close()
          if (this.database === database) this.database = null
          if (this.openPromise !== null) this.openPromise = null
        }
        resolveOnce(database)
      }
    })

    return this.openPromise
  }
}

export const createLivePlayCommandOutbox = (
  options: CreateLivePlayCommandOutboxOptions = {},
): LivePlayCommandOutbox => new IndexedDbLivePlayCommandOutbox(options)

let browserSingleton: LivePlayCommandOutbox | null = null

export const getLivePlayCommandOutbox = (): LivePlayCommandOutbox => {
  browserSingleton ??= createLivePlayCommandOutbox()
  return browserSingleton
}
