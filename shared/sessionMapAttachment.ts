import { isSlug, SLUG_PATTERN_DESCRIPTION } from './paths'
import {
  isClientId,
  isGmKey,
  isSessionId,
  type ClientId,
  type GmKey,
  type PlayerId,
  type SessionId,
} from './sessionIdentity'
import type { MapRevision, SessionRevision } from './sessionRevisions'
import type { SelectedSessionMapSlug, SessionMapSlug } from './sessionState'

export const SESSION_MAP_ATTACHMENT_SELECTED_MAP_BEHAVIORS = [
  'select-attached-map',
  'preserve-current-selection',
] as const

export type SessionMapAttachmentSelectedMapBehavior =
  (typeof SESSION_MAP_ATTACHMENT_SELECTED_MAP_BEHAVIORS)[number]

export const DEFAULT_SESSION_MAP_ATTACHMENT_SELECTED_MAP_BEHAVIOR =
  'select-attached-map' as const satisfies SessionMapAttachmentSelectedMapBehavior

export const SESSION_MAP_ATTACHMENT_VISIBILITY_BEHAVIORS = [
  'gm-only',
  'visible-to-joined-players',
  'visible-to-all-players',
] as const

export type SessionMapAttachmentVisibilityBehavior =
  (typeof SESSION_MAP_ATTACHMENT_VISIBILITY_BEHAVIORS)[number]

export const DEFAULT_SESSION_MAP_ATTACHMENT_VISIBILITY_BEHAVIOR =
  'visible-to-all-players' as const satisfies SessionMapAttachmentVisibilityBehavior

export const ATTACH_SESSION_MAP_REQUIRED_FIELDS = [
  'sessionId',
  'gmKey',
  'mapSlug',
] as const

export type AttachSessionMapRequiredField = (typeof ATTACH_SESSION_MAP_REQUIRED_FIELDS)[number]

export const ATTACH_SESSION_MAP_UNTRUSTED_DOCUMENT_FIELDS = [
  'map',
  'maps',
  'document',
  'mapDocument',
  'mapState',
] as const

export type AttachSessionMapUntrustedDocumentField =
  (typeof ATTACH_SESSION_MAP_UNTRUSTED_DOCUMENT_FIELDS)[number]

export const ATTACH_SESSION_MAP_VALIDATION_CODES = [
  'not-object',
  'missing-field',
  'invalid-session-id',
  'invalid-gm-key',
  'invalid-gm-client-id',
  'invalid-map-slug',
  'invalid-selected-map-behavior',
  'invalid-visibility-behavior',
  'untrusted-map-document',
] as const

export type AttachSessionMapValidationCode =
  (typeof ATTACH_SESSION_MAP_VALIDATION_CODES)[number]

export interface AttachSessionMapInput {
  readonly sessionId?: unknown
  readonly gmKey?: unknown
  readonly gmClientId?: unknown
  readonly mapSlug?: unknown
  readonly selectedMapBehavior?: unknown
  readonly visibilityBehavior?: unknown
}

export interface AttachSessionMapRequest {
  readonly sessionId: SessionId
  readonly gmKey: GmKey
  readonly gmClientId?: ClientId
  /**
   * Identifies the persisted map that the session host must load from storage.
   * The attachment flow never accepts a client-provided map document as live
   * session authority when a persisted map can be loaded by this slug.
   */
  readonly mapSlug: SessionMapSlug
  readonly selectedMapBehavior: SessionMapAttachmentSelectedMapBehavior
  readonly visibilityBehavior: SessionMapAttachmentVisibilityBehavior
}

export interface AttachSessionMapSessionResult {
  readonly sessionId: SessionId
  readonly revision: SessionRevision
  readonly selectedMapSlug: SelectedSessionMapSlug
  readonly mapCount: number
}

export interface AttachedSessionMapResult {
  readonly mapSlug: SessionMapSlug
  readonly revision: MapRevision
  readonly selected: boolean
}

export interface AttachSessionMapSelectionResult {
  readonly behavior: SessionMapAttachmentSelectedMapBehavior
  readonly previousSelectedMapSlug: SelectedSessionMapSlug
  readonly selectedMapSlug: SelectedSessionMapSlug
}

export interface AttachSessionMapVisibilityResult {
  readonly behavior: SessionMapAttachmentVisibilityBehavior
  readonly grantsJoinedPlayers: boolean
  readonly grantsFuturePlayers: boolean
  readonly visiblePlayerIds: readonly PlayerId[]
}

export interface AttachSessionMapSnapshotResult {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface AttachSessionMapResult {
  readonly session: AttachSessionMapSessionResult
  readonly map: AttachedSessionMapResult
  readonly selection: AttachSessionMapSelectionResult
  readonly visibility: AttachSessionMapVisibilityResult
  readonly snapshot?: AttachSessionMapSnapshotResult
}

export interface AttachSessionMapValidationIssue {
  readonly path: string
  readonly code: AttachSessionMapValidationCode
  readonly message: string
  readonly expected?: string
  readonly received?: string
}

export interface AttachSessionMapValidationSuccess {
  readonly valid: true
  readonly input: AttachSessionMapRequest
  readonly issues: readonly []
}

export interface AttachSessionMapValidationFailure {
  readonly valid: false
  readonly issues: readonly AttachSessionMapValidationIssue[]
}

export type AttachSessionMapValidationResult =
  | AttachSessionMapValidationSuccess
  | AttachSessionMapValidationFailure

type UnknownRecord = Record<string, unknown>
type MutableIssueList = AttachSessionMapValidationIssue[]

const EXPECTED_OBJECT = 'object'
const EXPECTED_SESSION_ID = 'SessionId'
const EXPECTED_GM_KEY = 'GmKey'
const EXPECTED_CLIENT_ID = 'ClientId'
const EXPECTED_MAP_SLUG = `persisted map slug matching ${SLUG_PATTERN_DESCRIPTION}`
const EXPECTED_SELECTED_MAP_BEHAVIOR = SESSION_MAP_ATTACHMENT_SELECTED_MAP_BEHAVIORS.join(' | ')
const EXPECTED_VISIBILITY_BEHAVIOR = SESSION_MAP_ATTACHMENT_VISIBILITY_BEHAVIORS.join(' | ')

const SELECTED_MAP_BEHAVIOR_SET = new Set<unknown>(
  SESSION_MAP_ATTACHMENT_SELECTED_MAP_BEHAVIORS,
)
const VISIBILITY_BEHAVIOR_SET = new Set<unknown>(SESSION_MAP_ATTACHMENT_VISIBILITY_BEHAVIORS)
const ATTACH_SESSION_MAP_VALIDATION_CODE_SET = new Set<unknown>(
  ATTACH_SESSION_MAP_VALIDATION_CODES,
)

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const describeReceived = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const addIssue = (
  issues: MutableIssueList,
  path: string,
  code: AttachSessionMapValidationCode,
  message: string,
  expected?: string,
  received?: unknown,
): void => {
  issues.push({
    path,
    code,
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(received === undefined ? {} : { received: describeReceived(received) }),
  })
}

const validateRequiredFields = (record: UnknownRecord, issues: MutableIssueList): void => {
  for (const field of ATTACH_SESSION_MAP_REQUIRED_FIELDS) {
    if (!hasOwn(record, field)) {
      addIssue(
        issues,
        field,
        'missing-field',
        `${field} is required to attach a persisted map to a live session.`,
      )
    }
  }
}

const addInvalidStringIssue = (
  issues: MutableIssueList,
  path: string,
  code: AttachSessionMapValidationCode,
  expected: string,
  received: unknown,
): void => {
  addIssue(issues, path, code, `${path} must be ${expected}.`, expected, received)
}

const isEmptyOptionalValue = (value: unknown): boolean =>
  value === undefined || value === null || value === ''

export const isSessionMapAttachmentSelectedMapBehavior = (
  value: unknown,
): value is SessionMapAttachmentSelectedMapBehavior => SELECTED_MAP_BEHAVIOR_SET.has(value)

export const isSessionMapAttachmentVisibilityBehavior = (
  value: unknown,
): value is SessionMapAttachmentVisibilityBehavior => VISIBILITY_BEHAVIOR_SET.has(value)

export const isAttachSessionMapValidationCode = (
  value: unknown,
): value is AttachSessionMapValidationCode => ATTACH_SESSION_MAP_VALIDATION_CODE_SET.has(value)

export const shouldSelectAttachedSessionMap = (
  behavior: SessionMapAttachmentSelectedMapBehavior,
): boolean => behavior === 'select-attached-map'

export const shouldGrantAttachedMapVisibilityToJoinedPlayers = (
  behavior: SessionMapAttachmentVisibilityBehavior,
): boolean =>
  behavior === 'visible-to-joined-players' || behavior === 'visible-to-all-players'

export const shouldGrantAttachedMapVisibilityToFuturePlayers = (
  behavior: SessionMapAttachmentVisibilityBehavior,
): boolean => behavior === 'visible-to-all-players'

export const collectAttachSessionMapInputIssues = (
  value: unknown,
): readonly AttachSessionMapValidationIssue[] => {
  const issues: MutableIssueList = []

  if (!isRecord(value)) {
    addIssue(
      issues,
      '$',
      'not-object',
      'attach session map input must be an object.',
      EXPECTED_OBJECT,
      value,
    )
    return issues
  }

  validateRequiredFields(value, issues)

  if (hasOwn(value, 'sessionId') && !isSessionId(value.sessionId)) {
    addInvalidStringIssue(
      issues,
      'sessionId',
      'invalid-session-id',
      EXPECTED_SESSION_ID,
      value.sessionId,
    )
  }

  if (hasOwn(value, 'gmKey') && !isGmKey(value.gmKey)) {
    addInvalidStringIssue(issues, 'gmKey', 'invalid-gm-key', EXPECTED_GM_KEY, value.gmKey)
  }

  if (
    hasOwn(value, 'gmClientId') &&
    !isEmptyOptionalValue(value.gmClientId) &&
    !isClientId(value.gmClientId)
  ) {
    addInvalidStringIssue(
      issues,
      'gmClientId',
      'invalid-gm-client-id',
      EXPECTED_CLIENT_ID,
      value.gmClientId,
    )
  }

  if (hasOwn(value, 'mapSlug') && !isSlug(value.mapSlug)) {
    addInvalidStringIssue(
      issues,
      'mapSlug',
      'invalid-map-slug',
      EXPECTED_MAP_SLUG,
      value.mapSlug,
    )
  }

  if (
    hasOwn(value, 'selectedMapBehavior') &&
    !isEmptyOptionalValue(value.selectedMapBehavior) &&
    !isSessionMapAttachmentSelectedMapBehavior(value.selectedMapBehavior)
  ) {
    addIssue(
      issues,
      'selectedMapBehavior',
      'invalid-selected-map-behavior',
      `selectedMapBehavior must be ${EXPECTED_SELECTED_MAP_BEHAVIOR}.`,
      EXPECTED_SELECTED_MAP_BEHAVIOR,
      value.selectedMapBehavior,
    )
  }

  if (
    hasOwn(value, 'visibilityBehavior') &&
    !isEmptyOptionalValue(value.visibilityBehavior) &&
    !isSessionMapAttachmentVisibilityBehavior(value.visibilityBehavior)
  ) {
    addIssue(
      issues,
      'visibilityBehavior',
      'invalid-visibility-behavior',
      `visibilityBehavior must be ${EXPECTED_VISIBILITY_BEHAVIOR}.`,
      EXPECTED_VISIBILITY_BEHAVIOR,
      value.visibilityBehavior,
    )
  }

  for (const field of ATTACH_SESSION_MAP_UNTRUSTED_DOCUMENT_FIELDS) {
    if (!hasOwn(value, field)) continue

    addIssue(
      issues,
      field,
      'untrusted-map-document',
      'Attach map input must identify a persisted map by mapSlug; the session host loads the map document from storage.',
      'mapSlug only',
      value[field],
    )
  }

  return issues
}

const normalizeSelectedMapBehavior = (
  value: unknown,
): SessionMapAttachmentSelectedMapBehavior =>
  isEmptyOptionalValue(value)
    ? DEFAULT_SESSION_MAP_ATTACHMENT_SELECTED_MAP_BEHAVIOR
    : value as SessionMapAttachmentSelectedMapBehavior

const normalizeVisibilityBehavior = (
  value: unknown,
): SessionMapAttachmentVisibilityBehavior =>
  isEmptyOptionalValue(value)
    ? DEFAULT_SESSION_MAP_ATTACHMENT_VISIBILITY_BEHAVIOR
    : value as SessionMapAttachmentVisibilityBehavior

const toAttachSessionMapRequest = (record: UnknownRecord): AttachSessionMapRequest => ({
  sessionId: record.sessionId as SessionId,
  gmKey: record.gmKey as GmKey,
  ...(isEmptyOptionalValue(record.gmClientId) ? {} : { gmClientId: record.gmClientId as ClientId }),
  mapSlug: record.mapSlug as SessionMapSlug,
  selectedMapBehavior: normalizeSelectedMapBehavior(record.selectedMapBehavior),
  visibilityBehavior: normalizeVisibilityBehavior(record.visibilityBehavior),
})

export const validateAttachSessionMapInput = (
  value: unknown,
): AttachSessionMapValidationResult => {
  const issues = collectAttachSessionMapInputIssues(value)
  if (issues.length > 0) {
    return { valid: false, issues }
  }

  return { valid: true, input: toAttachSessionMapRequest(value as UnknownRecord), issues: [] }
}

export const isValidAttachSessionMapInput = (value: unknown): value is AttachSessionMapInput =>
  validateAttachSessionMapInput(value).valid

export const assertValidAttachSessionMapInput = (
  value: unknown,
  label = 'attach session map input',
): AttachSessionMapRequest => {
  const result = validateAttachSessionMapInput(value)
  if (result.valid) return result.input

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}
