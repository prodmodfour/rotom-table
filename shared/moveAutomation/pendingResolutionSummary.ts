import {
  MOVE_SPEC_PHASES,
  type MoveSpecPhase,
} from './spec'

export const PENDING_MOVE_RESOLUTION_SCHEMA_VERSION = 1 as const

export const PENDING_MOVE_RESOLUTION_STATUSES = [
  'pending',
  'resuming',
  'committed',
  'cancelled',
  'expired',
  'conflicted',
  'abandoned',
] as const

export const PENDING_MOVE_RESOLUTION_SUMMARY_LIMITS = Object.freeze({
  identifierChars: 160,
  placementIdChars: 200,
  canonicalMoveChars: 160,
  responseWindows: 64,
})

export type PendingMoveResolutionStatus =
  (typeof PENDING_MOVE_RESOLUTION_STATUSES)[number]

export interface PendingMoveResolutionPublicSummary {
  readonly schemaVersion: typeof PENDING_MOVE_RESOLUTION_SCHEMA_VERSION
  readonly resolutionId: string
  readonly actorPlacementId: string
  readonly canonicalMoveId: string
  readonly phase: MoveSpecPhase
  readonly status: PendingMoveResolutionStatus
  readonly outstandingWindowCount: number
  readonly createdAt: number
  readonly updatedAt: number
}

export type PendingMoveResolutionValidationCode =
  | 'invalid-pending-resolution'
  | 'unsupported-schema-version'
  | 'unknown-status'
  | 'limit-exceeded'
  | 'not-json'
  | 'duplicate-id'
  | 'inconsistent-state'

export class PendingMoveResolutionValidationError extends Error {
  readonly code: PendingMoveResolutionValidationCode
  readonly path: string
  readonly detail: string

  constructor(
    code: PendingMoveResolutionValidationCode,
    path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`)
    this.name = 'PendingMoveResolutionValidationError'
    this.code = code
    this.path = path
    this.detail = detail
  }
}

type UnknownRecord = Record<string, unknown>

const SUMMARY_FIELDS = [
  'schemaVersion',
  'resolutionId',
  'actorPlacementId',
  'canonicalMoveId',
  'phase',
  'status',
  'outstandingWindowCount',
  'createdAt',
  'updatedAt',
] as const
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const STATUS_SET = new Set<string>(PENDING_MOVE_RESOLUTION_STATUSES)
const PHASE_SET = new Set<string>(MOVE_SPEC_PHASES)

const fail = (
  code: PendingMoveResolutionValidationCode,
  path: string,
  detail: string,
): never => {
  throw new PendingMoveResolutionValidationError(code, path, detail)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-pending-resolution', path, 'must be a plain object.')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('not-json', path, 'symbol properties are not allowed.')
  }
  const expected = new Set<string>(SUMMARY_FIELDS)
  const missing = SUMMARY_FIELDS.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length > 0 || unknown.length > 0) {
    const detail = [
      missing.length > 0 ? `missing ${missing.join(', ')}` : '',
      unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
    ].filter(Boolean).join('; ')
    fail(
      'invalid-pending-resolution',
      path,
      `must contain exactly the supported fields (${detail}).`,
    )
  }
  for (const field of SUMMARY_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
      ?? fail('not-json', `${path}.${field}`, 'must have a property descriptor.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail('not-json', `${path}.${field}`, 'must be an enumerable data property.')
    }
  }
  return value
}

const parseBoundedText = (
  value: unknown,
  path: string,
  maximum: number,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-pending-resolution',
      path,
      'must be a non-empty, trimmed string without control characters.',
    )
  }
  if (value.length > maximum) {
    fail('limit-exceeded', path, `must contain at most ${maximum} characters.`)
  }
  return value
}

const parseInteger = (
  value: unknown,
  path: string,
  maximum: number,
): number => {
  if (!Number.isSafeInteger(value)) {
    return fail('invalid-pending-resolution', path, 'must be a safe integer.')
  }
  const parsed = Number(value)
  if (parsed < 0 || parsed > maximum) {
    fail('limit-exceeded', path, `must be from 0 through ${maximum}.`)
  }
  return parsed
}

/** Strictly parse, detach, and freeze a map-visible pending-resolution summary. */
export const parsePendingMoveResolutionPublicSummary = (
  value: unknown,
  path = 'pendingResolutionSummary',
): PendingMoveResolutionPublicSummary => {
  const record = parseRecord(value, path)
  if (record.schemaVersion !== PENDING_MOVE_RESOLUTION_SCHEMA_VERSION) {
    fail(
      'unsupported-schema-version',
      `${path}.schemaVersion`,
      `must be ${PENDING_MOVE_RESOLUTION_SCHEMA_VERSION}.`,
    )
  }
  if (typeof record.phase !== 'string' || !PHASE_SET.has(record.phase)) {
    fail(
      'invalid-pending-resolution',
      `${path}.phase`,
      'must be a supported MoveSpec phase.',
    )
  }
  if (typeof record.status !== 'string' || !STATUS_SET.has(record.status)) {
    fail(
      'unknown-status',
      `${path}.status`,
      `must be one of ${PENDING_MOVE_RESOLUTION_STATUSES.join(', ')}.`,
    )
  }
  const createdAt = parseInteger(record.createdAt, `${path}.createdAt`, Number.MAX_SAFE_INTEGER)
  const updatedAt = parseInteger(record.updatedAt, `${path}.updatedAt`, Number.MAX_SAFE_INTEGER)
  if (updatedAt < createdAt) {
    fail('inconsistent-state', `${path}.updatedAt`, 'cannot precede createdAt.')
  }

  return Object.freeze({
    schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
    resolutionId: parseBoundedText(
      record.resolutionId,
      `${path}.resolutionId`,
      PENDING_MOVE_RESOLUTION_SUMMARY_LIMITS.identifierChars,
    ),
    actorPlacementId: parseBoundedText(
      record.actorPlacementId,
      `${path}.actorPlacementId`,
      PENDING_MOVE_RESOLUTION_SUMMARY_LIMITS.placementIdChars,
    ),
    canonicalMoveId: parseBoundedText(
      record.canonicalMoveId,
      `${path}.canonicalMoveId`,
      PENDING_MOVE_RESOLUTION_SUMMARY_LIMITS.canonicalMoveChars,
    ),
    phase: record.phase as MoveSpecPhase,
    status: record.status as PendingMoveResolutionStatus,
    outstandingWindowCount: parseInteger(
      record.outstandingWindowCount,
      `${path}.outstandingWindowCount`,
      PENDING_MOVE_RESOLUTION_SUMMARY_LIMITS.responseWindows,
    ),
    createdAt,
    updatedAt,
  })
}
