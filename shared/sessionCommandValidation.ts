import type { SessionCommandValidationIssue } from './sessionCommandResults'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  isOpId,
  isSessionCommandScopeLane,
  isSessionCommandType,
  type SessionCommandEnvelope,
} from './sessionCommands'
import { isClientId, isPlayerId, isSessionDisplayName, isSessionId } from './sessionIdentity'
import { isSessionRole, isVisibleResourceKind } from './sessionPermissions'
import { isRevision } from './sessionRevisions'
import { isSheetKind } from './sheets'

export const SESSION_COMMAND_REQUIRED_FIELDS = [
  'schemaVersion',
  'sessionId',
  'actor',
  'type',
  'opId',
  'baseRevision',
  'scopes',
  'payload',
] as const

export type SessionCommandRequiredField = (typeof SESSION_COMMAND_REQUIRED_FIELDS)[number]

export const SESSION_COMMAND_VALIDATION_CODES = [
  'not-object',
  'missing-field',
  'invalid-schema-version',
  'invalid-session-id',
  'invalid-command-type',
  'invalid-op-id',
  'invalid-base-revision',
  'invalid-actor',
  'invalid-client-id',
  'invalid-player-id',
  'invalid-display-name',
  'invalid-scopes',
  'invalid-scope-lane',
  'invalid-resource-ref',
  'invalid-metadata',
  'invalid-payload',
] as const

export type SessionCommandValidationCode = (typeof SESSION_COMMAND_VALIDATION_CODES)[number]

export interface SessionCommandValidationSuccess<TCommand extends SessionCommandEnvelope = SessionCommandEnvelope> {
  readonly valid: true
  readonly command: TCommand
  readonly issues: readonly []
}

export interface SessionCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly SessionCommandValidationIssue[]
}

export type SessionCommandValidationResult<
  TCommand extends SessionCommandEnvelope = SessionCommandEnvelope,
> = SessionCommandValidationSuccess<TCommand> | SessionCommandValidationFailure

type MutableIssueList = SessionCommandValidationIssue[]

type UnknownRecord = Record<string, unknown>

const EXPECTED_OBJECT = 'object'
const EXPECTED_NON_EMPTY_STRING = 'non-empty string'
const EXPECTED_METADATA_VALUE = 'string, finite number, boolean, or null'

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

export const isSessionCommandValidationCode = (
  value: unknown,
): value is SessionCommandValidationCode =>
  (SESSION_COMMAND_VALIDATION_CODES as readonly unknown[]).includes(value)

export const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isMetadataAttributeValue = (value: unknown): value is string | number | boolean | null =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))

const describeReceived = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const addIssue = (
  issues: MutableIssueList,
  path: string,
  code: SessionCommandValidationCode,
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

const addInvalidStringIssue = (
  issues: MutableIssueList,
  path: string,
  code: SessionCommandValidationCode,
  expected: string,
  received: unknown,
): void => {
  addIssue(issues, path, code, `${path} must be ${expected}.`, expected, received)
}

const validateRequiredFields = (record: UnknownRecord, issues: MutableIssueList): void => {
  for (const field of SESSION_COMMAND_REQUIRED_FIELDS) {
    if (!hasOwn(record, field)) {
      addIssue(
        issues,
        field,
        'missing-field',
        `${field} is required on session command envelopes.`,
      )
    }
  }

  if (hasOwn(record, 'payload') && record.payload === undefined) {
    addIssue(issues, 'payload', 'invalid-payload', 'payload must be provided.', 'defined value', undefined)
  }
}

const validateActor = (value: unknown, issues: MutableIssueList): void => {
  if (!isRecord(value)) {
    addIssue(issues, 'actor', 'invalid-actor', 'actor must be an object.', EXPECTED_OBJECT, value)
    return
  }

  if (!isSessionRole(value.role)) {
    addIssue(
      issues,
      'actor.role',
      'invalid-actor',
      'actor.role must be gm or player.',
      'gm | player',
      value.role,
    )
  }

  if (!isClientId(value.clientId)) {
    addInvalidStringIssue(issues, 'actor.clientId', 'invalid-client-id', 'ClientId', value.clientId)
  }

  if (value.role === 'player') {
    if (!isPlayerId(value.playerId)) {
      addInvalidStringIssue(issues, 'actor.playerId', 'invalid-player-id', 'PlayerId', value.playerId)
    }

    if (!isSessionDisplayName(value.displayName)) {
      addInvalidStringIssue(
        issues,
        'actor.displayName',
        'invalid-display-name',
        'safe session display name',
        value.displayName,
      )
    }
  }
}

const validateResourceRef = (
  value: unknown,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-resource-ref', `${path} must be an object.`, EXPECTED_OBJECT, value)
    return
  }

  if (!isVisibleResourceKind(value.kind)) {
    addIssue(
      issues,
      `${path}.kind`,
      'invalid-resource-ref',
      `${path}.kind must be map, sheet, or token.`,
      'map | sheet | token',
      value.kind,
    )
    return
  }

  if (value.kind === 'map') {
    if (!isNonEmptyString(value.mapSlug)) {
      addInvalidStringIssue(
        issues,
        `${path}.mapSlug`,
        'invalid-resource-ref',
        EXPECTED_NON_EMPTY_STRING,
        value.mapSlug,
      )
    }
    return
  }

  if (value.kind === 'sheet') {
    if (!isSheetKind(value.sheetKind)) {
      addIssue(
        issues,
        `${path}.sheetKind`,
        'invalid-resource-ref',
        `${path}.sheetKind must be pokemon or trainer.`,
        'pokemon | trainer',
        value.sheetKind,
      )
    }

    if (!isNonEmptyString(value.sheetSlug)) {
      addInvalidStringIssue(
        issues,
        `${path}.sheetSlug`,
        'invalid-resource-ref',
        EXPECTED_NON_EMPTY_STRING,
        value.sheetSlug,
      )
    }
    return
  }

  if (!isNonEmptyString(value.tokenId)) {
    addInvalidStringIssue(
      issues,
      `${path}.tokenId`,
      'invalid-resource-ref',
      EXPECTED_NON_EMPTY_STRING,
      value.tokenId,
    )
  }

  if (hasOwn(value, 'mapSlug') && !isNonEmptyString(value.mapSlug)) {
    addInvalidStringIssue(
      issues,
      `${path}.mapSlug`,
      'invalid-resource-ref',
      EXPECTED_NON_EMPTY_STRING,
      value.mapSlug,
    )
  }

  if (hasOwn(value, 'sheetKind') && !isSheetKind(value.sheetKind)) {
    addIssue(
      issues,
      `${path}.sheetKind`,
      'invalid-resource-ref',
      `${path}.sheetKind must be pokemon or trainer when provided.`,
      'pokemon | trainer',
      value.sheetKind,
    )
  }

  if (hasOwn(value, 'sheetSlug') && !isNonEmptyString(value.sheetSlug)) {
    addInvalidStringIssue(
      issues,
      `${path}.sheetSlug`,
      'invalid-resource-ref',
      EXPECTED_NON_EMPTY_STRING,
      value.sheetSlug,
    )
  }
}

const validateScope = (value: unknown, path: string, issues: MutableIssueList): void => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'invalid-scopes', `${path} must be an object.`, EXPECTED_OBJECT, value)
    return
  }

  if (!isSessionCommandScopeLane(value.lane)) {
    addIssue(
      issues,
      `${path}.lane`,
      'invalid-scope-lane',
      `${path}.lane must be a known session command scope lane.`,
      'session | map | token | sheet | initiative | hazard | field-effect | terrain | assignment',
      value.lane,
    )
  }

  if (hasOwn(value, 'resource')) {
    validateResourceRef(value.resource, `${path}.resource`, issues)
  }

  if (hasOwn(value, 'field') && !isNonEmptyString(value.field)) {
    addInvalidStringIssue(
      issues,
      `${path}.field`,
      'invalid-scopes',
      EXPECTED_NON_EMPTY_STRING,
      value.field,
    )
  }

  if (hasOwn(value, 'mapSlug') && !isNonEmptyString(value.mapSlug)) {
    addInvalidStringIssue(
      issues,
      `${path}.mapSlug`,
      'invalid-scopes',
      EXPECTED_NON_EMPTY_STRING,
      value.mapSlug,
    )
  }

  if (hasOwn(value, 'playerId') && !isPlayerId(value.playerId)) {
    addInvalidStringIssue(issues, `${path}.playerId`, 'invalid-player-id', 'PlayerId', value.playerId)
  }
}

const validateScopes = (value: unknown, issues: MutableIssueList): void => {
  if (!Array.isArray(value)) {
    addIssue(issues, 'scopes', 'invalid-scopes', 'scopes must be an array.', 'array', value)
    return
  }

  if (value.length === 0) {
    addIssue(
      issues,
      'scopes',
      'invalid-scopes',
      'scopes must contain at least one conflict/permission scope.',
      'non-empty array',
      value,
    )
    return
  }

  value.forEach((scope, index) => validateScope(scope, `scopes[${index}]`, issues))
}

const validateMetadata = (value: unknown, issues: MutableIssueList): void => {
  if (!isRecord(value)) {
    addIssue(issues, 'metadata', 'invalid-metadata', 'metadata must be an object.', EXPECTED_OBJECT, value)
    return
  }

  if (hasOwn(value, 'clientIssuedAt') && typeof value.clientIssuedAt !== 'string') {
    addInvalidStringIssue(issues, 'metadata.clientIssuedAt', 'invalid-metadata', 'string', value.clientIssuedAt)
  }

  if (
    hasOwn(value, 'clientSequence') &&
    !(typeof value.clientSequence === 'number' && Number.isSafeInteger(value.clientSequence) && value.clientSequence >= 0)
  ) {
    addIssue(
      issues,
      'metadata.clientSequence',
      'invalid-metadata',
      'metadata.clientSequence must be a safe non-negative integer.',
      'safe non-negative integer',
      value.clientSequence,
    )
  }

  if (hasOwn(value, 'traceId') && typeof value.traceId !== 'string') {
    addInvalidStringIssue(issues, 'metadata.traceId', 'invalid-metadata', 'string', value.traceId)
  }

  if (!hasOwn(value, 'attributes')) return

  if (!isRecord(value.attributes)) {
    addIssue(
      issues,
      'metadata.attributes',
      'invalid-metadata',
      'metadata.attributes must be an object when provided.',
      EXPECTED_OBJECT,
      value.attributes,
    )
    return
  }

  for (const [key, attributeValue] of Object.entries(value.attributes)) {
    if (!isMetadataAttributeValue(attributeValue)) {
      addIssue(
        issues,
        `metadata.attributes.${key}`,
        'invalid-metadata',
        `metadata.attributes.${key} must be ${EXPECTED_METADATA_VALUE}.`,
        EXPECTED_METADATA_VALUE,
        attributeValue,
      )
    }
  }
}

export const collectSessionCommandEnvelopeIssues = (
  value: unknown,
): readonly SessionCommandValidationIssue[] => {
  const issues: MutableIssueList = []

  if (!isRecord(value)) {
    addIssue(
      issues,
      '$',
      'not-object',
      'session command envelope must be an object.',
      EXPECTED_OBJECT,
      value,
    )
    return issues
  }

  validateRequiredFields(value, issues)

  if (hasOwn(value, 'schemaVersion') && value.schemaVersion !== SESSION_COMMAND_ENVELOPE_VERSION) {
    addIssue(
      issues,
      'schemaVersion',
      'invalid-schema-version',
      `schemaVersion must be ${SESSION_COMMAND_ENVELOPE_VERSION}.`,
      String(SESSION_COMMAND_ENVELOPE_VERSION),
      value.schemaVersion,
    )
  }

  if (hasOwn(value, 'sessionId') && !isSessionId(value.sessionId)) {
    addInvalidStringIssue(issues, 'sessionId', 'invalid-session-id', 'SessionId', value.sessionId)
  }

  if (hasOwn(value, 'actor')) {
    validateActor(value.actor, issues)
  }

  if (hasOwn(value, 'type') && !isSessionCommandType(value.type)) {
    addInvalidStringIssue(issues, 'type', 'invalid-command-type', 'SessionCommandType', value.type)
  }

  if (hasOwn(value, 'opId') && !isOpId(value.opId)) {
    addInvalidStringIssue(issues, 'opId', 'invalid-op-id', 'OpId', value.opId)
  }

  if (hasOwn(value, 'baseRevision') && !isRevision(value.baseRevision)) {
    addIssue(
      issues,
      'baseRevision',
      'invalid-base-revision',
      'baseRevision must be a safe non-negative integer revision.',
      'safe non-negative integer revision',
      value.baseRevision,
    )
  }

  if (hasOwn(value, 'scopes')) {
    validateScopes(value.scopes, issues)
  }

  if (hasOwn(value, 'metadata') && value.metadata !== undefined) {
    validateMetadata(value.metadata, issues)
  }

  return issues
}

export const validateSessionCommandEnvelope = <
  TCommand extends SessionCommandEnvelope = SessionCommandEnvelope,
>(
  value: unknown,
): SessionCommandValidationResult<TCommand> => {
  const issues = collectSessionCommandEnvelopeIssues(value)
  if (issues.length > 0) {
    return { valid: false, issues }
  }

  return { valid: true, command: value as TCommand, issues: [] }
}

export const isValidSessionCommandEnvelope = (value: unknown): value is SessionCommandEnvelope =>
  collectSessionCommandEnvelopeIssues(value).length === 0

export const assertValidSessionCommandEnvelope = <
  TCommand extends SessionCommandEnvelope = SessionCommandEnvelope,
>(
  value: unknown,
  label = 'session command envelope',
): TCommand => {
  const result = validateSessionCommandEnvelope<TCommand>(value)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}
