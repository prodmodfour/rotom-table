import { isSlug, SLUG_PATTERN_DESCRIPTION } from './paths'
import { isSheetKind, type SheetKind } from './sheets'

type Brand<TName extends string> = string & { readonly __brand: TName }

export type PlayerProfileId = Brand<'PlayerProfileId'>
export type PlayerProfileDisplayName = Brand<'PlayerProfileDisplayName'>

export const PLAYER_PROFILE_SCHEMA_VERSION = 1 as const
export const PLAYER_PROFILE_ID_PREFIX = 'profile_'
export const PLAYER_PROFILE_ID_PATTERN_DESCRIPTION = '/^profile_[A-Za-z0-9_-]{8,64}$/'
export const PLAYER_PROFILE_ID_RE = /^profile_[A-Za-z0-9_-]{8,64}$/
export const PLAYER_PROFILE_DISPLAY_NAME_MIN_LENGTH = 1
export const PLAYER_PROFILE_DISPLAY_NAME_MAX_LENGTH = 64
export const PLAYER_PROFILE_DISPLAY_NAME_FALLBACK = 'Player' as PlayerProfileDisplayName

export interface LinkedCharacterRef {
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
}

export interface PlayerProfile {
  readonly schemaVersion: typeof PLAYER_PROFILE_SCHEMA_VERSION
  readonly id: PlayerProfileId
  readonly displayName: PlayerProfileDisplayName
  readonly linkedCharacters: readonly LinkedCharacterRef[]
}

export const PLAYER_PROFILE_SELECTION_SCHEMA_VERSION = 1 as const
export const PLAYER_PROFILE_SELECTION_LOCAL_STORAGE_KEY = 'rotom:player-profile:selection' as const

export interface RememberedPlayerProfileSelection {
  readonly schemaVersion: typeof PLAYER_PROFILE_SELECTION_SCHEMA_VERSION
  readonly profileId: PlayerProfileId
  readonly displayName: PlayerProfileDisplayName
  readonly rememberedAt: string
}

export type PlayerProfileSelectionValidationIssueCode =
  | 'invalid-json'
  | 'not-object'
  | 'unsupported-schema-version'
  | 'invalid-profile-id'
  | 'invalid-display-name'
  | 'invalid-remembered-at'

export interface PlayerProfileSelectionValidationIssue {
  readonly path: string
  readonly code: PlayerProfileSelectionValidationIssueCode
  readonly message: string
}

export type PlayerProfileSelectionValidationResult =
  | { readonly ok: true; readonly selection: RememberedPlayerProfileSelection }
  | { readonly ok: false; readonly issues: readonly PlayerProfileSelectionValidationIssue[] }

type UnknownRecord = Record<string, unknown>

const PLAYER_PROFILE_DISPLAY_NAME_DELIMITER_RE = /[<>]/g
const PLAYER_PROFILE_DISPLAY_NAME_CONTROL_RE = /[\u0000-\u001F\u007F]/g
const PLAYER_PROFILE_DISPLAY_NAME_FORMAT_CONTROL_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g
const PLAYER_PROFILE_DISPLAY_NAME_WHITESPACE_RE = /[\s\u00A0]+/g
const EXPECTED_SHEET_KIND = 'pokemon | trainer'
const EXPECTED_SHEET_SLUG = `sheet slug matching ${SLUG_PATTERN_DESCRIPTION}`

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

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRememberedAt = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value))

const compareStrings = (left: string, right: string): number => left.localeCompare(right)

export const isPlayerProfileId = (value: unknown): value is PlayerProfileId =>
  typeof value === 'string' && PLAYER_PROFILE_ID_RE.test(value)

export const parsePlayerProfileId = (value: unknown, label = 'profileId'): PlayerProfileId =>
  parseBrandedString(value, isPlayerProfileId, label, PLAYER_PROFILE_ID_PATTERN_DESCRIPTION)

export const sanitizePlayerProfileDisplayNameString = (value: string): string => {
  const normalized = value
    .normalize('NFKC')
    .replace(PLAYER_PROFILE_DISPLAY_NAME_DELIMITER_RE, '')
    .replace(PLAYER_PROFILE_DISPLAY_NAME_CONTROL_RE, ' ')
    .replace(PLAYER_PROFILE_DISPLAY_NAME_FORMAT_CONTROL_RE, '')
    .replace(PLAYER_PROFILE_DISPLAY_NAME_WHITESPACE_RE, ' ')
    .trim()

  return Array.from(normalized).slice(0, PLAYER_PROFILE_DISPLAY_NAME_MAX_LENGTH).join('').trim()
}

export const isPlayerProfileDisplayName = (
  value: unknown,
): value is PlayerProfileDisplayName =>
  typeof value === 'string' &&
  value.length >= PLAYER_PROFILE_DISPLAY_NAME_MIN_LENGTH &&
  Array.from(value).length <= PLAYER_PROFILE_DISPLAY_NAME_MAX_LENGTH &&
  sanitizePlayerProfileDisplayNameString(value) === value

export const sanitizePlayerProfileDisplayName = (
  value: unknown,
  fallback: string = PLAYER_PROFILE_DISPLAY_NAME_FALLBACK,
): PlayerProfileDisplayName => {
  const fallbackName =
    sanitizePlayerProfileDisplayNameString(fallback) || PLAYER_PROFILE_DISPLAY_NAME_FALLBACK
  if (typeof value !== 'string') return fallbackName as PlayerProfileDisplayName

  return (sanitizePlayerProfileDisplayNameString(value) || fallbackName) as PlayerProfileDisplayName
}

export const parsePlayerProfileDisplayName = (
  value: unknown,
  label = 'displayName',
): PlayerProfileDisplayName => {
  if (!isPlayerProfileDisplayName(value)) {
    throw new Error(
      `${label} must be ${PLAYER_PROFILE_DISPLAY_NAME_MIN_LENGTH}-${PLAYER_PROFILE_DISPLAY_NAME_MAX_LENGTH} safe display characters`,
    )
  }
  return value
}

export const isPlayerProfileSchemaVersion = (
  value: unknown,
): value is typeof PLAYER_PROFILE_SCHEMA_VERSION => value === PLAYER_PROFILE_SCHEMA_VERSION

export const parsePlayerProfileSchemaVersion = (
  value: unknown,
  label = 'schemaVersion',
): typeof PLAYER_PROFILE_SCHEMA_VERSION => {
  if (!isPlayerProfileSchemaVersion(value)) {
    throw new Error(`${label} must be ${PLAYER_PROFILE_SCHEMA_VERSION}`)
  }
  return value
}

export const linkedCharacterRefKey = (ref: LinkedCharacterRef): string =>
  `${ref.sheetKind}:${ref.sheetSlug}`

export const compareLinkedCharacterRefs = (
  left: LinkedCharacterRef,
  right: LinkedCharacterRef,
): number => compareStrings(linkedCharacterRefKey(left), linkedCharacterRefKey(right))

export const normalizeLinkedCharacterRef = (
  value: unknown,
  label = 'linkedCharacter',
): LinkedCharacterRef => {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`)
  }

  if (!isSheetKind(value.sheetKind)) {
    throw new Error(`${label}.sheetKind must be ${EXPECTED_SHEET_KIND}`)
  }

  if (!isSlug(value.sheetSlug)) {
    throw new Error(`${label}.sheetSlug must be ${EXPECTED_SHEET_SLUG}`)
  }

  return {
    sheetKind: value.sheetKind,
    sheetSlug: value.sheetSlug,
  }
}

export const isLinkedCharacterRef = (value: unknown): value is LinkedCharacterRef => {
  try {
    normalizeLinkedCharacterRef(value)
    return true
  } catch {
    return false
  }
}

export const assertUniqueLinkedCharacterRefs = (
  refs: readonly LinkedCharacterRef[],
  label = 'linkedCharacters',
): void => {
  const seen = new Set<string>()

  for (const ref of refs) {
    const key = linkedCharacterRefKey(ref)
    if (seen.has(key)) {
      throw new Error(`${label} must not contain duplicate character ref "${key}"`)
    }
    seen.add(key)
  }
}

export const normalizeLinkedCharacterRefs = (
  value: unknown,
  label = 'linkedCharacters',
): readonly LinkedCharacterRef[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`)
  }

  const refs = value.map((ref, index) => normalizeLinkedCharacterRef(ref, `${label}[${index}]`))
  assertUniqueLinkedCharacterRefs(refs, label)
  return refs.sort(compareLinkedCharacterRefs)
}

export const normalizePlayerProfile = (
  value: unknown,
  label = 'playerProfile',
): PlayerProfile => {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`)
  }

  return {
    schemaVersion: parsePlayerProfileSchemaVersion(value.schemaVersion, `${label}.schemaVersion`),
    id: parsePlayerProfileId(value.id, `${label}.id`),
    displayName: parsePlayerProfileDisplayName(value.displayName, `${label}.displayName`),
    linkedCharacters: normalizeLinkedCharacterRefs(
      value.linkedCharacters,
      `${label}.linkedCharacters`,
    ),
  }
}

export const isPlayerProfile = (value: unknown): value is PlayerProfile => {
  try {
    normalizePlayerProfile(value)
    return true
  } catch {
    return false
  }
}

export const createRememberedPlayerProfileSelection = (
  profile: Pick<PlayerProfile, 'id' | 'displayName'>,
  rememberedAt: string,
): RememberedPlayerProfileSelection => assertValidRememberedPlayerProfileSelection({
  schemaVersion: PLAYER_PROFILE_SELECTION_SCHEMA_VERSION,
  profileId: profile.id,
  displayName: profile.displayName,
  rememberedAt,
})

export const validateRememberedPlayerProfileSelection = (
  value: unknown,
): PlayerProfileSelectionValidationResult => {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ path: '', code: 'not-object', message: 'player profile selection must be an object' }],
    }
  }

  const issues: PlayerProfileSelectionValidationIssue[] = []

  if (value.schemaVersion !== PLAYER_PROFILE_SELECTION_SCHEMA_VERSION) {
    issues.push({
      path: 'schemaVersion',
      code: 'unsupported-schema-version',
      message: `schemaVersion must be ${PLAYER_PROFILE_SELECTION_SCHEMA_VERSION}`,
    })
  }

  if (!isPlayerProfileId(value.profileId)) {
    issues.push({
      path: 'profileId',
      code: 'invalid-profile-id',
      message: `profileId must match ${PLAYER_PROFILE_ID_PATTERN_DESCRIPTION}`,
    })
  }

  if (!isPlayerProfileDisplayName(value.displayName)) {
    issues.push({
      path: 'displayName',
      code: 'invalid-display-name',
      message: `displayName must be ${PLAYER_PROFILE_DISPLAY_NAME_MIN_LENGTH}-${PLAYER_PROFILE_DISPLAY_NAME_MAX_LENGTH} safe display characters`,
    })
  }

  if (!isRememberedAt(value.rememberedAt)) {
    issues.push({
      path: 'rememberedAt',
      code: 'invalid-remembered-at',
      message: 'rememberedAt must be a valid timestamp string',
    })
  }

  if (issues.length > 0) return { ok: false, issues }

  return {
    ok: true,
    selection: {
      schemaVersion: PLAYER_PROFILE_SELECTION_SCHEMA_VERSION,
      profileId: value.profileId as PlayerProfileId,
      displayName: value.displayName as PlayerProfileDisplayName,
      rememberedAt: value.rememberedAt as string,
    },
  }
}

export const assertValidRememberedPlayerProfileSelection = (
  value: unknown,
): RememberedPlayerProfileSelection => {
  const result = validateRememberedPlayerProfileSelection(value)
  if (result.ok) return result.selection

  throw new Error(result.issues.map((issue) => `${issue.path || 'selection'}: ${issue.message}`).join('; '))
}

export const serializeRememberedPlayerProfileSelection = (
  selection: RememberedPlayerProfileSelection,
): string => JSON.stringify(assertValidRememberedPlayerProfileSelection(selection))

const parseSerializedPlayerProfileSelectionJson = (
  serialized: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly issues: readonly PlayerProfileSelectionValidationIssue[] } => {
  try {
    return { ok: true, value: JSON.parse(serialized) }
  } catch {
    return {
      ok: false,
      issues: [{ path: '', code: 'invalid-json', message: 'player profile selection JSON is invalid' }],
    }
  }
}

export const deserializeRememberedPlayerProfileSelection = (
  serialized: string,
): PlayerProfileSelectionValidationResult => {
  const parsed = parseSerializedPlayerProfileSelectionJson(serialized)
  if (!parsed.ok) return parsed
  return validateRememberedPlayerProfileSelection(parsed.value)
}
