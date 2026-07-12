import {
  isLivePlayBaseRevision,
  isLivePlayMapSlug,
  isLivePlayOpId,
} from '../livePlayCommands'
import { isPlayerProfileId, type PlayerProfileId } from '../playerProfiles'
import { PENDING_MOVE_RESOLUTION_LIMITS } from './pendingResolution'

/**
 * Client intent for one durable response window. These commands carry stable
 * references only; the pending resolution remains the sole mechanics source.
 */
export const MOVE_RESPONSE_COMMAND_SCHEMA_VERSION = 1 as const

export const MOVE_RESPONSE_COMMAND_TYPES = {
  CHOOSE: 'choose',
  REACT: 'react',
  PASS: 'pass',
  GM_CANCEL: 'gm-cancel',
  GM_FORCE_RESOLVE: 'gm-force-resolve',
} as const

export const MOVE_RESPONSE_COMMAND_TYPE_VALUES = [
  MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
  MOVE_RESPONSE_COMMAND_TYPES.REACT,
  MOVE_RESPONSE_COMMAND_TYPES.PASS,
  MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL,
  MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE,
] as const

export const MOVE_RESPONSE_COMMAND_LIMITS = Object.freeze({
  resolutionIdChars: PENDING_MOVE_RESOLUTION_LIMITS.identifierChars,
  windowIdChars: PENDING_MOVE_RESOLUTION_LIMITS.identifierChars,
  optionIdChars: PENDING_MOVE_RESOLUTION_LIMITS.identifierChars,
})

export type MoveResponseCommandType =
  (typeof MOVE_RESPONSE_COMMAND_TYPE_VALUES)[number]

export interface MoveResponseCommandEnvelope<
  TType extends MoveResponseCommandType,
  TPayload,
> {
  readonly schemaVersion: typeof MOVE_RESPONSE_COMMAND_SCHEMA_VERSION
  readonly opId: string
  readonly mapSlug: string
  readonly baseRevision: number
  /** Selected player authorization context; omitted for GM commands. */
  readonly profileId?: PlayerProfileId
  readonly type: TType
  readonly payload: TPayload
}

export interface ChooseMoveResponsePayload {
  readonly resolutionId: string
  readonly windowId: string
  readonly optionId: string
}

export interface ReactMoveResponsePayload {
  readonly resolutionId: string
  readonly windowId: string
  readonly optionId: string
}

export interface PassMoveResponsePayload {
  readonly resolutionId: string
  readonly windowId: string
}

export interface GmCancelMoveResolutionPayload {
  readonly resolutionId: string
}

/** Force-resolve is a GM-authored force-pass for one stable window. */
export interface GmForceResolveMoveResolutionPayload {
  readonly resolutionId: string
  readonly windowId: string
}

export type ChooseMoveResponseCommand = MoveResponseCommandEnvelope<
  typeof MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
  ChooseMoveResponsePayload
>

export type ReactMoveResponseCommand = MoveResponseCommandEnvelope<
  typeof MOVE_RESPONSE_COMMAND_TYPES.REACT,
  ReactMoveResponsePayload
>

export type PassMoveResponseCommand = MoveResponseCommandEnvelope<
  typeof MOVE_RESPONSE_COMMAND_TYPES.PASS,
  PassMoveResponsePayload
>

export type GmCancelMoveResolutionCommand = MoveResponseCommandEnvelope<
  typeof MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL,
  GmCancelMoveResolutionPayload
>

export type GmForceResolveMoveResolutionCommand = MoveResponseCommandEnvelope<
  typeof MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE,
  GmForceResolveMoveResolutionPayload
>

export type MoveResponseCommand =
  | ChooseMoveResponseCommand
  | ReactMoveResponseCommand
  | PassMoveResponseCommand
  | GmCancelMoveResolutionCommand
  | GmForceResolveMoveResolutionCommand

export const MOVE_RESPONSE_COMMAND_VALIDATION_CODES = [
  'not-object',
  'missing-field',
  'unknown-field',
  'forbidden-field',
  'invalid-schema-version',
  'invalid-op-id',
  'invalid-map-slug',
  'invalid-base-revision',
  'unsupported-command-type',
  'invalid-identifier',
  'limit-exceeded',
] as const

export type MoveResponseCommandValidationCode =
  (typeof MOVE_RESPONSE_COMMAND_VALIDATION_CODES)[number]

export interface MoveResponseCommandValidationIssue {
  readonly path: string
  readonly code: MoveResponseCommandValidationCode
  readonly message: string
}

export interface MoveResponseCommandValidationSuccess<
  TCommand extends MoveResponseCommand = MoveResponseCommand,
> {
  readonly valid: true
  readonly command: TCommand
  readonly issues: readonly []
}

export interface MoveResponseCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly MoveResponseCommandValidationIssue[]
}

export type MoveResponseCommandValidationResult<
  TCommand extends MoveResponseCommand = MoveResponseCommand,
> = MoveResponseCommandValidationSuccess<TCommand> | MoveResponseCommandValidationFailure

export class MoveResponseCommandValidationError extends Error {
  readonly issues: readonly MoveResponseCommandValidationIssue[]

  constructor(issues: readonly MoveResponseCommandValidationIssue[]) {
    const summary = issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')
    super(`Invalid move response command: ${summary}`)
    this.name = 'MoveResponseCommandValidationError'
    this.issues = Object.freeze(issues.map(issue => Object.freeze({ ...issue })))
  }
}

type UnknownRecord = Record<string, unknown>
type MutableIssueList = MoveResponseCommandValidationIssue[]

const ROOT_FIELDS = [
  'schemaVersion',
  'opId',
  'mapSlug',
  'baseRevision',
  'type',
  'payload',
] as const
const ROOT_OPTIONAL_FIELDS = ['profileId'] as const
const OPTION_RESPONSE_PAYLOAD_FIELDS = [
  'resolutionId',
  'windowId',
  'optionId',
] as const
const WINDOW_RESPONSE_PAYLOAD_FIELDS = [
  'resolutionId',
  'windowId',
] as const
const CANCEL_RESPONSE_PAYLOAD_FIELDS = ['resolutionId'] as const

const FORBIDDEN_CLIENT_MECHANICS_FIELDS = new Set([
  'accuracy',
  'actor',
  'auditTrace',
  'branch',
  'choices',
  'conditionUpdates',
  'damage',
  'damageRoll',
  'effectOperations',
  'effects',
  'finalState',
  'hit',
  'hpUpdates',
  'mapPatch',
  'mapState',
  'mechanics',
  'operations',
  'patch',
  'patches',
  'recipients',
  'result',
  'rng',
  'roll',
  'rollLedger',
  'rolls',
  'scopes',
  'script',
  'sheetUpdates',
  'spec',
  'specHash',
  'state',
  'targetIds',
  'trace',
  'transaction',
])
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const COMMAND_TYPE_SET = new Set<unknown>(MOVE_RESPONSE_COMMAND_TYPE_VALUES)

const hasOwn = (record: UnknownRecord, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(record, key)
)

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const addIssue = (
  issues: MutableIssueList,
  path: string,
  code: MoveResponseCommandValidationCode,
  message: string,
): void => {
  issues.push({ path, code, message })
}

const collectExactFieldIssues = (
  record: UnknownRecord,
  fields: readonly string[],
  path: string,
  issues: MutableIssueList,
  optionalFields: readonly string[] = [],
): void => {
  const allowed = new Set([...fields, ...optionalFields])
  for (const field of fields) {
    if (!hasOwn(record, field)) {
      addIssue(issues, `${path}.${field}`, 'missing-field', `${path}.${field} is required.`)
    }
  }
  for (const field of Object.keys(record)) {
    if (allowed.has(field)) continue
    const fieldPath = `${path}.${field}`
    const forbidden = FORBIDDEN_CLIENT_MECHANICS_FIELDS.has(field)
    addIssue(
      issues,
      fieldPath,
      forbidden ? 'forbidden-field' : 'unknown-field',
      forbidden
        ? `${fieldPath} is server-owned mechanics data and must not be submitted by the client.`
        : `${fieldPath} is not a supported move response command field.`,
    )
  }
}

const collectIdentifier = (
  value: unknown,
  path: string,
  maximum: number,
  issues: MutableIssueList,
  stable: boolean,
): string | null => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    addIssue(
      issues,
      path,
      'invalid-identifier',
      `${path} must be a non-empty, trimmed identifier without control characters.`,
    )
    return null
  }
  if (value.length > maximum) {
    addIssue(
      issues,
      path,
      'limit-exceeded',
      `${path} must contain at most ${maximum} characters.`,
    )
    return null
  }
  if (stable && !STABLE_ID_PATTERN.test(value)) {
    addIssue(
      issues,
      path,
      'invalid-identifier',
      `${path} must be a lowercase stable identifier.`,
    )
    return null
  }
  return value
}

const payloadFieldsForType = (
  type: MoveResponseCommandType,
): readonly string[] => {
  if (
    type === MOVE_RESPONSE_COMMAND_TYPES.CHOOSE
    || type === MOVE_RESPONSE_COMMAND_TYPES.REACT
  ) return OPTION_RESPONSE_PAYLOAD_FIELDS
  if (
    type === MOVE_RESPONSE_COMMAND_TYPES.PASS
    || type === MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE
  ) return WINDOW_RESPONSE_PAYLOAD_FIELDS
  return CANCEL_RESPONSE_PAYLOAD_FIELDS
}

const parsePayload = (
  value: unknown,
  type: MoveResponseCommandType,
  issues: MutableIssueList,
): MoveResponseCommand['payload'] | null => {
  if (!isPlainRecord(value)) {
    addIssue(issues, '$.payload', 'not-object', '$.payload must be a plain object.')
    return null
  }

  const fields = payloadFieldsForType(type)
  collectExactFieldIssues(value, fields, '$.payload', issues)
  const resolutionId = collectIdentifier(
    value.resolutionId,
    '$.payload.resolutionId',
    MOVE_RESPONSE_COMMAND_LIMITS.resolutionIdChars,
    issues,
    false,
  )
  const windowId = fields.includes('windowId')
    ? collectIdentifier(
        value.windowId,
        '$.payload.windowId',
        MOVE_RESPONSE_COMMAND_LIMITS.windowIdChars,
        issues,
        true,
      )
    : null
  const optionId = fields.includes('optionId')
    ? collectIdentifier(
        value.optionId,
        '$.payload.optionId',
        MOVE_RESPONSE_COMMAND_LIMITS.optionIdChars,
        issues,
        true,
      )
    : null

  if (
    issues.some(issue => issue.path.startsWith('$.payload'))
    || resolutionId === null
    || (fields.includes('windowId') && windowId === null)
    || (fields.includes('optionId') && optionId === null)
  ) return null

  return Object.freeze({
    resolutionId,
    ...(windowId === null ? {} : { windowId }),
    ...(optionId === null ? {} : { optionId }),
  }) as MoveResponseCommand['payload']
}

export const isMoveResponseCommandType = (
  value: unknown,
): value is MoveResponseCommandType => COMMAND_TYPE_SET.has(value)

export const collectMoveResponseCommandIssues = (
  value: unknown,
  expectedType?: MoveResponseCommandType,
): readonly MoveResponseCommandValidationIssue[] => {
  const issues: MutableIssueList = []
  if (!isPlainRecord(value)) {
    return Object.freeze([{
      path: '$',
      code: 'not-object',
      message: 'Move response command must be a plain object.',
    }])
  }

  collectExactFieldIssues(value, ROOT_FIELDS, '$', issues, ROOT_OPTIONAL_FIELDS)

  if (value.schemaVersion !== MOVE_RESPONSE_COMMAND_SCHEMA_VERSION) {
    addIssue(
      issues,
      '$.schemaVersion',
      'invalid-schema-version',
      `$.schemaVersion must be ${MOVE_RESPONSE_COMMAND_SCHEMA_VERSION}.`,
    )
  }
  if (!isLivePlayOpId(value.opId)) {
    addIssue(issues, '$.opId', 'invalid-op-id', '$.opId must be a valid live-play operation ID.')
  }
  if (!isLivePlayMapSlug(value.mapSlug)) {
    addIssue(issues, '$.mapSlug', 'invalid-map-slug', '$.mapSlug must be a valid live-play map slug.')
  }
  if (!isLivePlayBaseRevision(value.baseRevision)) {
    addIssue(
      issues,
      '$.baseRevision',
      'invalid-base-revision',
      '$.baseRevision must be a safe non-negative map revision.',
    )
  }
  if (hasOwn(value, 'profileId') && !isPlayerProfileId(value.profileId)) {
    addIssue(
      issues,
      '$.profileId',
      'invalid-identifier',
      '$.profileId must be a valid player profile ID when provided.',
    )
  }

  if (!isMoveResponseCommandType(value.type)) {
    addIssue(
      issues,
      '$.type',
      'unsupported-command-type',
      `$.type must be one of ${MOVE_RESPONSE_COMMAND_TYPE_VALUES.join(', ')}.`,
    )
  }
  else {
    if (expectedType !== undefined && value.type !== expectedType) {
      addIssue(
        issues,
        '$.type',
        'unsupported-command-type',
        `This route accepts only ${expectedType} move response commands.`,
      )
    }
    parsePayload(value.payload, value.type, issues)
  }

  return Object.freeze(issues.map(issue => Object.freeze({ ...issue })))
}

export const validateMoveResponseCommand = <
  TCommand extends MoveResponseCommand = MoveResponseCommand,
>(
  value: unknown,
  expectedType?: MoveResponseCommandType,
): MoveResponseCommandValidationResult<TCommand> => {
  const issues = collectMoveResponseCommandIssues(value, expectedType)
  if (issues.length > 0 || !isPlainRecord(value) || !isMoveResponseCommandType(value.type)) {
    return { valid: false, issues }
  }

  const payloadIssues: MutableIssueList = []
  const payload = parsePayload(value.payload, value.type, payloadIssues)
  if (payload === null || payloadIssues.length > 0) {
    return {
      valid: false,
      issues: Object.freeze(payloadIssues.map(issue => Object.freeze({ ...issue }))),
    }
  }

  const command = Object.freeze({
    schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
    opId: value.opId as string,
    mapSlug: value.mapSlug as string,
    baseRevision: value.baseRevision as number,
    ...(isPlayerProfileId(value.profileId) ? { profileId: value.profileId } : {}),
    type: value.type,
    payload,
  }) as TCommand
  return { valid: true, command, issues: [] }
}

export const parseMoveResponseCommand = <
  TCommand extends MoveResponseCommand = MoveResponseCommand,
>(
  value: unknown,
  expectedType?: MoveResponseCommandType,
): TCommand => {
  const validation = validateMoveResponseCommand<TCommand>(value, expectedType)
  if (validation.valid) return validation.command
  throw new MoveResponseCommandValidationError(validation.issues)
}
