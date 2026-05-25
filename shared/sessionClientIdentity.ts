import {
  isClientId,
  isGmKey,
  isPlayerId,
  isSessionDisplayName,
  isSessionId,
  type ClientId,
  type GmKey,
  type PlayerId,
  type SessionDisplayName,
  type SessionId,
} from './sessionIdentity'
import { isSessionRevision, type SessionRevision } from './sessionRevisions'

export const SESSION_CLIENT_IDENTITY_SCHEMA_VERSION = 1 as const
export const SESSION_CLIENT_IDENTITY_COOKIE = 'rotom-session-identity' as const
export const SESSION_CLIENT_IDENTITY_LOCAL_STORAGE_KEY = 'rotom:session:identity' as const
export const SESSION_CLIENT_IDENTITY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

export const SESSION_CLIENT_IDENTITY_ROLES = ['gm', 'player'] as const
export type SessionClientIdentityRole = (typeof SESSION_CLIENT_IDENTITY_ROLES)[number]

export interface SessionClientIdentityBase {
  readonly schemaVersion: typeof SESSION_CLIENT_IDENTITY_SCHEMA_VERSION
  readonly role: SessionClientIdentityRole
  readonly sessionId: SessionId
  readonly clientId: ClientId
  readonly rememberedAt: string
  readonly lastSeenRevision?: SessionRevision
}

export interface GmSessionClientIdentity extends SessionClientIdentityBase {
  readonly role: 'gm'
  readonly gmKey: GmKey
}

export interface PlayerSessionClientIdentity extends SessionClientIdentityBase {
  readonly role: 'player'
  readonly playerId: PlayerId
  readonly displayName: SessionDisplayName
}

export type SessionClientIdentity = GmSessionClientIdentity | PlayerSessionClientIdentity

export type GmSessionClientIdentityCookieHint = Omit<GmSessionClientIdentity, 'gmKey'>
export type PlayerSessionClientIdentityCookieHint = PlayerSessionClientIdentity
export type SessionClientIdentityCookieHint =
  | GmSessionClientIdentityCookieHint
  | PlayerSessionClientIdentityCookieHint

export type SessionClientIdentityValidationIssueCode =
  | 'invalid-json'
  | 'not-object'
  | 'unsupported-schema-version'
  | 'invalid-role'
  | 'invalid-session-id'
  | 'invalid-client-id'
  | 'invalid-gm-key'
  | 'invalid-player-id'
  | 'invalid-display-name'
  | 'invalid-remembered-at'
  | 'invalid-last-seen-revision'
  | 'secret-in-cookie'

export interface SessionClientIdentityValidationIssue {
  readonly path: string
  readonly code: SessionClientIdentityValidationIssueCode
  readonly message: string
}

export type SessionClientIdentityValidationResult<TIdentity> =
  | { readonly ok: true; readonly identity: TIdentity }
  | { readonly ok: false; readonly issues: readonly SessionClientIdentityValidationIssue[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const addIssue = (
  issues: SessionClientIdentityValidationIssue[],
  path: string,
  code: SessionClientIdentityValidationIssueCode,
  message: string,
): void => {
  issues.push({ path, code, message })
}

const isRememberedAt = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value))

export const isSessionClientIdentityRole = (value: unknown): value is SessionClientIdentityRole =>
  value === 'gm' || value === 'player'

const validateBaseFields = (
  value: Record<string, unknown>,
  issues: SessionClientIdentityValidationIssue[],
): void => {
  if (value.schemaVersion !== SESSION_CLIENT_IDENTITY_SCHEMA_VERSION) {
    addIssue(
      issues,
      'schemaVersion',
      'unsupported-schema-version',
      `schemaVersion must be ${SESSION_CLIENT_IDENTITY_SCHEMA_VERSION}`,
    )
  }

  if (!isSessionClientIdentityRole(value.role)) {
    addIssue(issues, 'role', 'invalid-role', 'role must be gm or player')
  }

  if (!isSessionId(value.sessionId)) {
    addIssue(issues, 'sessionId', 'invalid-session-id', 'sessionId must be a valid SessionId')
  }

  if (!isClientId(value.clientId)) {
    addIssue(issues, 'clientId', 'invalid-client-id', 'clientId must be a valid ClientId')
  }

  if (!isRememberedAt(value.rememberedAt)) {
    addIssue(
      issues,
      'rememberedAt',
      'invalid-remembered-at',
      'rememberedAt must be a valid timestamp string',
    )
  }

  if (value.lastSeenRevision !== undefined && !isSessionRevision(value.lastSeenRevision)) {
    addIssue(
      issues,
      'lastSeenRevision',
      'invalid-last-seen-revision',
      'lastSeenRevision must be a safe non-negative session revision',
    )
  }
}

const buildBaseIdentity = (
  value: Record<string, unknown>,
): SessionClientIdentityBase => ({
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: value.role as SessionClientIdentityRole,
  sessionId: value.sessionId as SessionId,
  clientId: value.clientId as ClientId,
  rememberedAt: value.rememberedAt as string,
  ...(value.lastSeenRevision === undefined
    ? {}
    : { lastSeenRevision: value.lastSeenRevision as SessionRevision }),
})

export const validateSessionClientIdentity = (
  value: unknown,
): SessionClientIdentityValidationResult<SessionClientIdentity> => {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ path: '', code: 'not-object', message: 'session client identity must be an object' }],
    }
  }

  const issues: SessionClientIdentityValidationIssue[] = []
  validateBaseFields(value, issues)

  if (value.role === 'gm') {
    if (!isGmKey(value.gmKey)) {
      addIssue(issues, 'gmKey', 'invalid-gm-key', 'gmKey must be a valid GmKey')
    }
  } else if (value.role === 'player') {
    if (!isPlayerId(value.playerId)) {
      addIssue(issues, 'playerId', 'invalid-player-id', 'playerId must be a valid PlayerId')
    }
    if (!isSessionDisplayName(value.displayName)) {
      addIssue(
        issues,
        'displayName',
        'invalid-display-name',
        'displayName must be a safe session display name',
      )
    }
  }

  if (issues.length > 0) return { ok: false, issues }

  const base = buildBaseIdentity(value)
  if (base.role === 'gm') {
    return { ok: true, identity: { ...base, role: 'gm', gmKey: value.gmKey as GmKey } }
  }

  return {
    ok: true,
    identity: {
      ...base,
      role: 'player',
      playerId: value.playerId as PlayerId,
      displayName: value.displayName as SessionDisplayName,
    },
  }
}

export const validateSessionClientIdentityCookieHint = (
  value: unknown,
): SessionClientIdentityValidationResult<SessionClientIdentityCookieHint> => {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ path: '', code: 'not-object', message: 'session identity cookie hint must be an object' }],
    }
  }

  const issues: SessionClientIdentityValidationIssue[] = []
  validateBaseFields(value, issues)

  if (value.gmKey !== undefined || value.joinCode !== undefined) {
    addIssue(
      issues,
      value.gmKey !== undefined ? 'gmKey' : 'joinCode',
      'secret-in-cookie',
      'session identity cookies must not contain GM keys or join codes',
    )
  }

  if (value.role === 'player') {
    if (!isPlayerId(value.playerId)) {
      addIssue(issues, 'playerId', 'invalid-player-id', 'playerId must be a valid PlayerId')
    }
    if (!isSessionDisplayName(value.displayName)) {
      addIssue(
        issues,
        'displayName',
        'invalid-display-name',
        'displayName must be a safe session display name',
      )
    }
  }

  if (issues.length > 0) return { ok: false, issues }

  const base = buildBaseIdentity(value)
  if (base.role === 'gm') {
    return { ok: true, identity: { ...base, role: 'gm' } }
  }

  return {
    ok: true,
    identity: {
      ...base,
      role: 'player',
      playerId: value.playerId as PlayerId,
      displayName: value.displayName as SessionDisplayName,
    },
  }
}

export const assertValidSessionClientIdentity = (
  value: unknown,
): SessionClientIdentity => {
  const result = validateSessionClientIdentity(value)
  if (result.ok) return result.identity

  throw new Error(result.issues.map((issue) => `${issue.path || 'identity'}: ${issue.message}`).join('; '))
}

export const toSessionClientIdentityCookieHint = (
  identity: SessionClientIdentity,
): SessionClientIdentityCookieHint => {
  const validIdentity = assertValidSessionClientIdentity(identity)
  const base = {
    schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
    role: validIdentity.role,
    sessionId: validIdentity.sessionId,
    clientId: validIdentity.clientId,
    rememberedAt: validIdentity.rememberedAt,
    ...(validIdentity.lastSeenRevision === undefined
      ? {}
      : { lastSeenRevision: validIdentity.lastSeenRevision }),
  }

  if (validIdentity.role === 'gm') {
    return { ...base, role: 'gm' }
  }

  return {
    ...base,
    role: 'player',
    playerId: validIdentity.playerId,
    displayName: validIdentity.displayName,
  }
}

export const serializeSessionClientIdentity = (identity: SessionClientIdentity): string =>
  JSON.stringify(assertValidSessionClientIdentity(identity))

export const serializeSessionClientIdentityCookieHint = (
  identity: SessionClientIdentity | SessionClientIdentityCookieHint,
): string => {
  const hint =
    'gmKey' in identity
      ? toSessionClientIdentityCookieHint(identity as SessionClientIdentity)
      : validateSessionClientIdentityCookieHint(identity).ok
        ? identity
        : toSessionClientIdentityCookieHint(assertValidSessionClientIdentity(identity))
  return encodeURIComponent(JSON.stringify(hint))
}

const parseSerializedJson = (
  serialized: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly issues: readonly SessionClientIdentityValidationIssue[] } => {
  try {
    return { ok: true, value: JSON.parse(serialized) }
  } catch {
    return {
      ok: false,
      issues: [{ path: '', code: 'invalid-json', message: 'session client identity JSON is invalid' }],
    }
  }
}

export const deserializeSessionClientIdentity = (
  serialized: string,
): SessionClientIdentityValidationResult<SessionClientIdentity> => {
  const parsed = parseSerializedJson(serialized)
  if (!parsed.ok) return parsed
  return validateSessionClientIdentity(parsed.value)
}

export const deserializeSessionClientIdentityCookieHint = (
  encoded: string,
): SessionClientIdentityValidationResult<SessionClientIdentityCookieHint> => {
  let decoded: string
  try {
    decoded = decodeURIComponent(encoded)
  } catch {
    return {
      ok: false,
      issues: [{ path: '', code: 'invalid-json', message: 'session identity cookie encoding is invalid' }],
    }
  }

  const parsed = parseSerializedJson(decoded)
  if (!parsed.ok) return parsed
  return validateSessionClientIdentityCookieHint(parsed.value)
}

export const updateSessionClientIdentityRevision = (
  identity: SessionClientIdentity,
  lastSeenRevision: SessionRevision,
  rememberedAt: string = identity.rememberedAt,
): SessionClientIdentity => {
  const next = {
    ...assertValidSessionClientIdentity(identity),
    lastSeenRevision,
    rememberedAt,
  }
  return assertValidSessionClientIdentity(next)
}
