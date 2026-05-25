type Brand<TName extends string> = string & { readonly __brand: TName }

export type SessionId = Brand<'SessionId'>
export type PlayerId = Brand<'PlayerId'>
export type ClientId = Brand<'ClientId'>
export type JoinCode = Brand<'JoinCode'>
export type GmKey = Brand<'GmKey'>
export type SessionDisplayName = Brand<'SessionDisplayName'>
export type DisplayNameSafeValue = SessionDisplayName
export type SafeDisplayName = SessionDisplayName
export type PlayerDisplayName = SessionDisplayName

export const SESSION_ID_PREFIX = 'session_'
export const PLAYER_ID_PREFIX = 'player_'
export const CLIENT_ID_PREFIX = 'client_'
export const GM_KEY_PREFIX = 'gmkey_'

export const SESSION_ID_PATTERN_DESCRIPTION = '/^session_[A-Za-z0-9_-]{12,64}$/'
export const PLAYER_ID_PATTERN_DESCRIPTION = '/^player_[A-Za-z0-9_-]{8,64}$/'
export const CLIENT_ID_PATTERN_DESCRIPTION = '/^client_[A-Za-z0-9_-]{8,64}$/'
export const JOIN_CODE_PATTERN_DESCRIPTION = '/^[A-HJ-NP-Z2-9]{6,12}$/'
export const GM_KEY_PATTERN_DESCRIPTION = '/^gmkey_[A-Za-z0-9_-]{24,128}$/'

export const SESSION_ID_RE = /^session_[A-Za-z0-9_-]{12,64}$/
export const PLAYER_ID_RE = /^player_[A-Za-z0-9_-]{8,64}$/
export const CLIENT_ID_RE = /^client_[A-Za-z0-9_-]{8,64}$/
export const JOIN_CODE_RE = /^[A-HJ-NP-Z2-9]{6,12}$/
export const GM_KEY_RE = /^gmkey_[A-Za-z0-9_-]{24,128}$/

export const SESSION_DISPLAY_NAME_MIN_LENGTH = 1
export const SESSION_DISPLAY_NAME_MAX_LENGTH = 32
export const SESSION_DISPLAY_NAME_FALLBACK = 'Player' as SessionDisplayName

const JOIN_CODE_INPUT_SEPARATOR_RE = /[\s-]+/g
const SESSION_DISPLAY_NAME_DELIMITER_RE = /[<>]/g
const SESSION_DISPLAY_NAME_CONTROL_RE = /[\u0000-\u001F\u007F]/g
const SESSION_DISPLAY_NAME_FORMAT_CONTROL_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g
const SESSION_DISPLAY_NAME_WHITESPACE_RE = /[\s\u00A0]+/g

const parseBrandedString = <TValue extends string>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is TValue,
  label: string,
  patternDescription: string,
): TValue => {
  if (!predicate(value)) {
    throw new Error(`${label} must match ${patternDescription}`)
  }
  return value
}

export const isSessionId = (value: unknown): value is SessionId =>
  typeof value === 'string' && SESSION_ID_RE.test(value)

export const isPlayerId = (value: unknown): value is PlayerId =>
  typeof value === 'string' && PLAYER_ID_RE.test(value)

export const isClientId = (value: unknown): value is ClientId =>
  typeof value === 'string' && CLIENT_ID_RE.test(value)

export const normalizeJoinCodeInput = (value: unknown): string =>
  typeof value === 'string'
    ? value.normalize('NFKC').toUpperCase().replace(JOIN_CODE_INPUT_SEPARATOR_RE, '')
    : ''

export const isJoinCode = (value: unknown): value is JoinCode =>
  typeof value === 'string' && JOIN_CODE_RE.test(value)

export const isGmKey = (value: unknown): value is GmKey =>
  typeof value === 'string' && GM_KEY_RE.test(value)

export const sanitizeSessionDisplayNameString = (value: string): string => {
  const normalized = value
    .normalize('NFKC')
    .replace(SESSION_DISPLAY_NAME_DELIMITER_RE, '')
    .replace(SESSION_DISPLAY_NAME_CONTROL_RE, ' ')
    .replace(SESSION_DISPLAY_NAME_FORMAT_CONTROL_RE, '')
    .replace(SESSION_DISPLAY_NAME_WHITESPACE_RE, ' ')
    .trim()

  return Array.from(normalized).slice(0, SESSION_DISPLAY_NAME_MAX_LENGTH).join('').trim()
}

export const isSessionDisplayName = (value: unknown): value is SessionDisplayName =>
  typeof value === 'string' &&
  value.length >= SESSION_DISPLAY_NAME_MIN_LENGTH &&
  Array.from(value).length <= SESSION_DISPLAY_NAME_MAX_LENGTH &&
  sanitizeSessionDisplayNameString(value) === value

export const sanitizeSessionDisplayName = (
  value: unknown,
  fallback: string = SESSION_DISPLAY_NAME_FALLBACK,
): SessionDisplayName => {
  const fallbackName = sanitizeSessionDisplayNameString(fallback) || SESSION_DISPLAY_NAME_FALLBACK
  if (typeof value !== 'string') return fallbackName as SessionDisplayName

  return (sanitizeSessionDisplayNameString(value) || fallbackName) as SessionDisplayName
}

export const parseSessionId = (value: unknown, label = 'sessionId'): SessionId =>
  parseBrandedString(value, isSessionId, label, SESSION_ID_PATTERN_DESCRIPTION)

export const parsePlayerId = (value: unknown, label = 'playerId'): PlayerId =>
  parseBrandedString(value, isPlayerId, label, PLAYER_ID_PATTERN_DESCRIPTION)

export const parseClientId = (value: unknown, label = 'clientId'): ClientId =>
  parseBrandedString(value, isClientId, label, CLIENT_ID_PATTERN_DESCRIPTION)

export const parseJoinCode = (value: unknown, label = 'joinCode'): JoinCode => {
  const normalized = normalizeJoinCodeInput(value)
  return parseBrandedString(normalized, isJoinCode, label, JOIN_CODE_PATTERN_DESCRIPTION)
}

export const parseGmKey = (value: unknown, label = 'gmKey'): GmKey =>
  parseBrandedString(value, isGmKey, label, GM_KEY_PATTERN_DESCRIPTION)

export const parseSessionDisplayName = (
  value: unknown,
  label = 'displayName',
): SessionDisplayName => {
  if (!isSessionDisplayName(value)) {
    throw new Error(
      `${label} must be ${SESSION_DISPLAY_NAME_MIN_LENGTH}-${SESSION_DISPLAY_NAME_MAX_LENGTH} safe display characters`,
    )
  }
  return value
}
