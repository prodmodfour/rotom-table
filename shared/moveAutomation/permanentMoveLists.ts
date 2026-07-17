/**
 * Strict wire-free contracts for reviewed, permanent move-list mutations.
 *
 * These values may appear only inside server-registered MoveSpecs/handlers.
 * Clients never submit a canonical move, slot, or provenance payload.
 */
export const MOVE_PERMANENT_MOVE_LIST_ACTIONS = [
  'add',
  'remove',
  'replace',
] as const

export const MOVE_PERMANENT_MOVE_ACQUISITION_KINDS = [
  'reviewed-rule',
  'encounter-history',
] as const

export const MOVE_PERMANENT_MOVE_LIST_SCHEMA_VERSION = 1 as const

export const MOVE_PERMANENT_MOVE_LIST_LIMITS = Object.freeze({
  canonicalMoveIdChars: 160,
  identifierChars: 200,
  trainerEntries: 256,
  pokemonEntries: 6,
})

export type MovePermanentMoveListAction =
  (typeof MOVE_PERMANENT_MOVE_LIST_ACTIONS)[number]
export type MovePermanentMoveAcquisitionKind =
  (typeof MOVE_PERMANENT_MOVE_ACQUISITION_KINDS)[number]

/** The learned move is fixed by reviewed rule data rather than a runtime fact. */
export interface MovePermanentMoveReviewedAcquisition {
  readonly kind: 'reviewed-rule'
}

/** The learned move is bound to one retained authoritative move-use record. */
export interface MovePermanentMoveHistoryAcquisition {
  readonly kind: 'encounter-history'
  readonly sourcePlacementId: string
  readonly sourceResolutionId: string
}

export type MovePermanentMoveAcquisition =
  | MovePermanentMoveReviewedAcquisition
  | MovePermanentMoveHistoryAcquisition

export interface MovePermanentMoveListAddPayload {
  readonly action: 'add'
  readonly moveId: string
  readonly acquisition: MovePermanentMoveAcquisition
}

export interface MovePermanentMoveListRemovePayload {
  readonly action: 'remove'
  readonly moveId: string
}

export interface MovePermanentMoveListReplacePayload {
  readonly action: 'replace'
  readonly replacedMoveId: string
  readonly moveId: string
  readonly acquisition: MovePermanentMoveAcquisition
}

export type MovePermanentMoveListEffectPayload =
  | MovePermanentMoveListAddPayload
  | MovePermanentMoveListRemovePayload
  | MovePermanentMoveListReplacePayload

/**
 * Durable provenance attached to a move row created by authoritative
 * automation. It explains the mutation without storing executable mechanics.
 */
export interface PermanentMoveListEntryProvenance {
  readonly schemaVersion: typeof MOVE_PERMANENT_MOVE_LIST_SCHEMA_VERSION
  readonly mutation: 'add' | 'replace'
  readonly sourceMoveId: string
  readonly sourcePlacementId: string
  readonly sourceResolutionId: string
  readonly sourceOperationId: string
  readonly acquiredFrom: MovePermanentMoveAcquisition
  readonly recordedAt: number
}

export type MovePermanentMoveListValidationCode =
  | 'invalid-permanent-move-list'
  | 'limit-exceeded'
  | 'unknown-field'

export class MovePermanentMoveListValidationError extends Error {
  readonly code: MovePermanentMoveListValidationCode
  readonly path: string

  constructor(
    code: MovePermanentMoveListValidationCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'MovePermanentMoveListValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const ACTION_SET = new Set<string>(MOVE_PERMANENT_MOVE_LIST_ACTIONS)
const ACQUISITION_KIND_SET = new Set<string>(MOVE_PERMANENT_MOVE_ACQUISITION_KINDS)
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const fail = (
  code: MovePermanentMoveListValidationCode,
  path: string,
  message: string,
): never => {
  throw new MovePermanentMoveListValidationError(code, path, message)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-permanent-move-list', path, 'must be a plain object.')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('unknown-field', path, 'symbol fields are not allowed.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      fail('invalid-permanent-move-list', `${path}.${key}`, 'must be an enumerable data field.')
    }
  }
  return value
}

const parseExactRecord = (
  value: unknown,
  fields: readonly string[],
  path: string,
): UnknownRecord => {
  const record = parseRecord(value, path)
  const allowed = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !allowed.has(field))
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'unknown-field',
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
  return record
}

const parseBoundedString = (
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
    return fail('invalid-permanent-move-list', path, 'must be a non-empty trimmed string.')
  }
  if (value.length > maximum) {
    fail('limit-exceeded', path, `must contain at most ${maximum} characters.`)
  }
  return value
}

const parseCanonicalMoveId = (value: unknown, path: string): string => (
  parseBoundedString(
    value,
    path,
    MOVE_PERMANENT_MOVE_LIST_LIMITS.canonicalMoveIdChars,
  )
)

const parseIdentifier = (value: unknown, path: string): string => (
  parseBoundedString(
    value,
    path,
    MOVE_PERMANENT_MOVE_LIST_LIMITS.identifierChars,
  )
)

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

export const parseMovePermanentMoveAcquisition = (
  value: unknown,
  path = 'permanentMoveList.acquisition',
): MovePermanentMoveAcquisition => {
  const record = parseRecord(value, path)
  const kind = record.kind
  if (typeof kind !== 'string' || !ACQUISITION_KIND_SET.has(kind)) {
    return fail(
      'invalid-permanent-move-list',
      `${path}.kind`,
      'must be reviewed-rule or encounter-history.',
    )
  }
  if (kind === 'reviewed-rule') {
    parseExactRecord(record, ['kind'], path)
    return deepFreeze({ kind })
  }
  const exact = parseExactRecord(
    record,
    ['kind', 'sourcePlacementId', 'sourceResolutionId'],
    path,
  )
  return deepFreeze({
    kind: 'encounter-history',
    sourcePlacementId: parseIdentifier(
      exact.sourcePlacementId,
      `${path}.sourcePlacementId`,
    ),
    sourceResolutionId: parseIdentifier(
      exact.sourceResolutionId,
      `${path}.sourceResolutionId`,
    ),
  })
}

/** Parse, detach, and deeply freeze one reviewed permanent move-list payload. */
export const parseMovePermanentMoveListEffectPayload = (
  value: unknown,
  path = 'permanentMoveList',
): MovePermanentMoveListEffectPayload => {
  const record = parseRecord(value, path)
  const action = record.action
  if (typeof action !== 'string' || !ACTION_SET.has(action)) {
    return fail(
      'invalid-permanent-move-list',
      `${path}.action`,
      'must be add, remove, or replace.',
    )
  }

  if (action === 'remove') {
    const exact = parseExactRecord(record, ['action', 'moveId'], path)
    return deepFreeze({
      action,
      moveId: parseCanonicalMoveId(exact.moveId, `${path}.moveId`),
    })
  }

  if (action === 'add') {
    const exact = parseExactRecord(record, ['action', 'moveId', 'acquisition'], path)
    return deepFreeze({
      action,
      moveId: parseCanonicalMoveId(exact.moveId, `${path}.moveId`),
      acquisition: parseMovePermanentMoveAcquisition(
        exact.acquisition,
        `${path}.acquisition`,
      ),
    })
  }

  const exact = parseExactRecord(
    record,
    ['action', 'replacedMoveId', 'moveId', 'acquisition'],
    path,
  )
  return deepFreeze({
    action: 'replace',
    replacedMoveId: parseCanonicalMoveId(
      exact.replacedMoveId,
      `${path}.replacedMoveId`,
    ),
    moveId: parseCanonicalMoveId(exact.moveId, `${path}.moveId`),
    acquisition: parseMovePermanentMoveAcquisition(
      exact.acquisition,
      `${path}.acquisition`,
    ),
  })
}
