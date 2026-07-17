import { isOpId } from '../sessionCommands'
import {
  MOVE_ITEM_REFERENCE_LIMITS,
  MoveItemReferenceValidationError,
  isMoveCanonicalItemId,
  isMoveItemStableId,
  parseMoveItemOwnerReference,
  type MoveItemOwnerReference,
} from './items'

/** Map-owned item stacks produced by reviewed authoritative operations. */
export const MAP_GROUND_ITEM_LIMITS = Object.freeze({
  count: 256,
  canonicalNameChars: 160,
  ownerPlacementIdChars: 200,
  payloadChars: 2_048,
  quantity: MOVE_ITEM_REFERENCE_LIMITS.quantity,
})

export interface MapGroundItemPosition {
  /** Zero-based map cell coordinate. */
  readonly x: number
  /** Zero-based map height/elevation. */
  readonly y: number
  /** Zero-based map cell coordinate. */
  readonly z: number
}

/**
 * One authoritative item stack resting on a map.
 *
 * `sideId` and `ownerPlacementId` are provenance/presentation hints only. They
 * never grant control or make the hinted placement the current resource owner;
 * the map document owns every record in this collection.
 */
export interface MapGroundItem {
  readonly id: string
  readonly canonicalItemId: string
  readonly canonicalItemName: string
  readonly quantity: number
  readonly position: MapGroundItemPosition
  readonly sourceResource: MoveItemOwnerReference
  readonly sourceOperationId: string
  readonly sideId: string | null
  readonly ownerPlacementId: string | null
}

export type MapGroundItemValidationCode =
  | 'invalid-ground-item'
  | 'limit-exceeded'
  | 'duplicate-ground-item'

export class MapGroundItemValidationError extends Error {
  readonly code: MapGroundItemValidationCode
  readonly path: string
  readonly detail: string

  constructor(code: MapGroundItemValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'MapGroundItemValidationError'
    this.code = code
    this.path = path
    this.detail = detail
  }
}

type UnknownRecord = Record<string, unknown>

const GROUND_ITEM_FIELDS = [
  'id',
  'canonicalItemId',
  'canonicalItemName',
  'quantity',
  'position',
  'sourceResource',
  'sourceOperationId',
  'sideId',
  'ownerPlacementId',
] as const
const POSITION_FIELDS = ['x', 'y', 'z'] as const
const ENCOUNTER_SIDE_ID_PATTERN = /^[a-z0-9-]+$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const fail = (
  code: MapGroundItemValidationCode,
  path: string,
  detail: string,
): never => {
  throw new MapGroundItemValidationError(code, path, detail)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const assertExactFields = (
  value: UnknownRecord,
  fields: readonly string[],
  path: string,
): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return

  fail(
    'invalid-ground-item',
    path,
    `must contain exactly the supported fields (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
  )
}

const parseGroundItemId = (value: unknown, path: string): string => {
  if (!isMoveItemStableId(value)) {
    return fail(
      'invalid-ground-item',
      path,
      `must be a stable item ID of at most ${MOVE_ITEM_REFERENCE_LIMITS.itemIdChars} characters.`,
    )
  }
  return value
}

const parseCanonicalItemId = (value: unknown, path: string): string => {
  if (!isMoveCanonicalItemId(value)) {
    return fail(
      'invalid-ground-item',
      path,
      `must be a lowercase canonical item ID of at most ${MOVE_ITEM_REFERENCE_LIMITS.canonicalItemIdChars} characters.`,
    )
  }
  return value
}

const parseSourceOperationId = (value: unknown, path: string): string => {
  if (!isOpId(value)) {
    return fail('invalid-ground-item', path, 'must be a live-play operation ID.')
  }
  return value
}

const parseCanonicalName = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAP_GROUND_ITEM_LIMITS.canonicalNameChars
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-ground-item',
      path,
      `must be canonical display text of at most ${MAP_GROUND_ITEM_LIMITS.canonicalNameChars} characters without surrounding whitespace or control characters.`,
    )
  }
  return value
}

const parseQuantity = (value: unknown, path: string): number => {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 1
    || Number(value) > MAP_GROUND_ITEM_LIMITS.quantity
  ) {
    return fail(
      'limit-exceeded',
      path,
      `must be a safe integer from 1 through ${MAP_GROUND_ITEM_LIMITS.quantity}.`,
    )
  }
  return Number(value)
}

const parsePosition = (value: unknown, path: string): MapGroundItemPosition => {
  if (!isPlainRecord(value)) {
    return fail('invalid-ground-item', path, 'must be a plain object map position.')
  }
  assertExactFields(value, POSITION_FIELDS, path)

  const position = {} as { x: number; y: number; z: number }
  for (const axis of POSITION_FIELDS) {
    const coordinate = value[axis]
    if (!Number.isSafeInteger(coordinate) || Number(coordinate) < 0) {
      fail(
        'invalid-ground-item',
        `${path}.${axis}`,
        'must be a safe non-negative integer map coordinate.',
      )
    }
    position[axis] = Number(coordinate)
  }
  return position
}

const parseSourceResource = (
  value: unknown,
  path: string,
): MoveItemOwnerReference => {
  try {
    return parseMoveItemOwnerReference(value, path)
  }
  catch (error) {
    if (error instanceof MoveItemReferenceValidationError) {
      fail(
        error.code === 'limit-exceeded' ? 'limit-exceeded' : 'invalid-ground-item',
        error.path,
        error.message.slice(error.path.length + 2),
      )
    }
    throw error
  }
}

const parseNullableSideId = (value: unknown, path: string): string | null => {
  if (value === null) return null
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 64
    || !ENCOUNTER_SIDE_ID_PATTERN.test(value)
  ) {
    return fail(
      'invalid-ground-item',
      path,
      'must be null or a lowercase alphanumeric/hyphen encounter side ID of at most 64 characters.',
    )
  }
  return value
}

const parseNullableOwnerPlacementId = (
  value: unknown,
  path: string,
): string | null => {
  if (value === null) return null
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAP_GROUND_ITEM_LIMITS.ownerPlacementIdChars
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-ground-item',
      path,
      `must be null or a stable placement hint of at most ${MAP_GROUND_ITEM_LIMITS.ownerPlacementIdChars} characters.`,
    )
  }
  return value
}

/** Strictly parse and detach one bounded map-ground item record. */
export const parseMapGroundItem = (
  value: unknown,
  path = 'mapGroundItem',
): MapGroundItem => {
  if (!isPlainRecord(value)) {
    return fail('invalid-ground-item', path, 'must be a plain object.')
  }
  assertExactFields(value, GROUND_ITEM_FIELDS, path)

  const parsed: MapGroundItem = {
    id: parseGroundItemId(value.id, `${path}.id`),
    canonicalItemId: parseCanonicalItemId(value.canonicalItemId, `${path}.canonicalItemId`),
    canonicalItemName: parseCanonicalName(value.canonicalItemName, `${path}.canonicalItemName`),
    quantity: parseQuantity(value.quantity, `${path}.quantity`),
    position: parsePosition(value.position, `${path}.position`),
    sourceResource: parseSourceResource(value.sourceResource, `${path}.sourceResource`),
    sourceOperationId: parseSourceOperationId(
      value.sourceOperationId,
      `${path}.sourceOperationId`,
    ),
    sideId: parseNullableSideId(value.sideId, `${path}.sideId`),
    ownerPlacementId: parseNullableOwnerPlacementId(
      value.ownerPlacementId,
      `${path}.ownerPlacementId`,
    ),
  }

  if (JSON.stringify(parsed).length > MAP_GROUND_ITEM_LIMITS.payloadChars) {
    fail(
      'limit-exceeded',
      path,
      `encoded payload must contain at most ${MAP_GROUND_ITEM_LIMITS.payloadChars} characters.`,
    )
  }
  return parsed
}

/** Parse one bounded list and reject duplicate stable identities. */
export const parseMapGroundItems = (
  value: unknown,
  path = 'mapGroundItems',
): readonly MapGroundItem[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-ground-item', path, 'must be an array.')
  }
  if (value.length > MAP_GROUND_ITEM_LIMITS.count) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${MAP_GROUND_ITEM_LIMITS.count} entries.`,
    )
  }

  const ids = new Set<string>()
  return value.map((entry, index) => {
    const item = parseMapGroundItem(entry, `${path}[${index}]`)
    if (ids.has(item.id)) {
      fail(
        'duplicate-ground-item',
        `${path}[${index}].id`,
        `duplicates map-ground item ${item.id}.`,
      )
    }
    ids.add(item.id)
    return item
  })
}
