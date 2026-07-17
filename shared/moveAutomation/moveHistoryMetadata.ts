import {
  ENCOUNTER_ACTION_TYPES,
  type EncounterActionType,
} from './encounterResources'

/**
 * Canonical provenance retained for every authoritative move lifecycle fact.
 *
 * Move origin describes why this resolution exists. Move-list source describes
 * the reviewed list from which its canonical move was selected. Keeping those
 * concepts separate lets copied and random child moves retain both ancestry
 * and candidate provenance without consulting UI or prose logs.
 */
export const MOVE_HISTORY_ORIGIN_KINDS = [
  'direct',
  'copied',
  'random',
] as const

export const MOVE_HISTORY_MOVE_LIST_SOURCE_KINDS = [
  'placement',
  'encounter-overlay',
  'reviewed-pool',
  'history',
] as const

export const MOVE_HISTORY_METADATA_LIMITS = Object.freeze({
  identifierChars: 160,
  canonicalMoveChars: 160,
  specVersion: 1_000_000,
  branchSelections: 128,
})

export type MoveHistoryOriginKind = (typeof MOVE_HISTORY_ORIGIN_KINDS)[number]
export type MoveHistoryMoveListSourceKind =
  (typeof MOVE_HISTORY_MOVE_LIST_SOURCE_KINDS)[number]

export type MoveHistoryOrigin =
  | { readonly kind: 'direct' }
  | {
      readonly kind: 'copied' | 'random'
      /** Resolution that supplied or selected this child move. */
      readonly sourceResolutionId: string
    }

export type MoveHistoryMoveListSource =
  | {
      readonly kind: 'placement'
      readonly placementId: string
    }
  | {
      readonly kind: 'encounter-overlay'
      readonly placementId: string
      readonly effectId: string
    }
  | {
      readonly kind: 'reviewed-pool'
      readonly poolId: string
    }
  | {
      readonly kind: 'history'
      readonly placementId: string
      readonly resolutionId: string
    }

export interface MoveHistoryIdentity {
  readonly resolutionId: string
  readonly canonicalId: string
  readonly specVersion: number
  readonly actorPlacementId: string
  readonly actionType: EncounterActionType
  readonly origin: MoveHistoryOrigin
  readonly moveListSource: MoveHistoryMoveListSource
}

export interface MoveHistoryBranchSelection {
  readonly selectionId: string
  /** Null identifies one resolution-wide branch decision. */
  readonly recipientId: string | null
  readonly branchId: string
}

export type MoveHistoryMetadataValidationCode =
  | 'invalid-move-history-metadata'
  | 'limit-exceeded'
  | 'duplicate-id'

export class MoveHistoryMetadataValidationError extends Error {
  readonly code: MoveHistoryMetadataValidationCode
  readonly path: string
  readonly detail: string

  constructor(
    code: MoveHistoryMetadataValidationCode,
    path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`)
    this.name = 'MoveHistoryMetadataValidationError'
    this.code = code
    this.path = path
    this.detail = detail
  }
}

type UnknownRecord = Record<string, unknown>

const IDENTITY_FIELDS = [
  'resolutionId',
  'canonicalId',
  'specVersion',
  'actorPlacementId',
  'actionType',
  'origin',
  'moveListSource',
] as const
const DIRECT_ORIGIN_FIELDS = ['kind'] as const
const DERIVED_ORIGIN_FIELDS = ['kind', 'sourceResolutionId'] as const
const PLACEMENT_SOURCE_FIELDS = ['kind', 'placementId'] as const
const OVERLAY_SOURCE_FIELDS = ['kind', 'placementId', 'effectId'] as const
const POOL_SOURCE_FIELDS = ['kind', 'poolId'] as const
const HISTORY_SOURCE_FIELDS = ['kind', 'placementId', 'resolutionId'] as const
const BRANCH_FIELDS = ['selectionId', 'recipientId', 'branchId'] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ACTION_TYPE_SET = new Set<string>(ENCOUNTER_ACTION_TYPES)
const ORIGIN_KIND_SET = new Set<string>(MOVE_HISTORY_ORIGIN_KINDS)
const MOVE_LIST_SOURCE_KIND_SET = new Set<string>(MOVE_HISTORY_MOVE_LIST_SOURCE_KINDS)

const fail = (
  code: MoveHistoryMetadataValidationCode,
  path: string,
  detail: string,
): never => {
  throw new MoveHistoryMetadataValidationError(code, path, detail)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-move-history-metadata', path, 'must be a plain object.')
  }
  return value
}

const parseExactRecord = (
  value: unknown,
  fields: readonly string[],
  path: string,
): UnknownRecord => {
  const record = parseRecord(value, path)
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !expected.has(field))
  if (missing.length > 0 || unknown.length > 0) {
    const details = [
      missing.length > 0 ? `missing ${missing.join(', ')}` : '',
      unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
    ].filter(Boolean).join('; ')
    fail(
      'invalid-move-history-metadata',
      path,
      `must contain exactly the supported fields (${details}).`,
    )
  }
  return record
}

const parseBoundedText = (
  value: unknown,
  path: string,
  maximum = MOVE_HISTORY_METADATA_LIMITS.identifierChars,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-move-history-metadata',
      path,
      'must be a non-empty, trimmed string without control characters.',
    )
  }
  if (value.length > maximum) {
    fail('limit-exceeded', path, `must contain at most ${maximum} characters.`)
  }
  return value
}

const parseStableId = (value: unknown, path: string): string => {
  const id = parseBoundedText(value, path)
  if (!STABLE_ID_PATTERN.test(id)) {
    fail('invalid-move-history-metadata', path, 'must be a lowercase stable identifier.')
  }
  return id
}

const parsePlacementId = (value: unknown, path: string): string => parseBoundedText(value, path)

const parseSpecVersion = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value)) {
    return fail('invalid-move-history-metadata', path, 'must be a safe integer.')
  }
  const version = Number(value)
  if (version < 1 || version > MOVE_HISTORY_METADATA_LIMITS.specVersion) {
    fail(
      'limit-exceeded',
      path,
      `must be from 1 through ${MOVE_HISTORY_METADATA_LIMITS.specVersion}.`,
    )
  }
  return version
}

export const parseMoveHistoryOrigin = (
  value: unknown,
  path = 'moveHistory.origin',
): MoveHistoryOrigin => {
  const input = parseRecord(value, path)
  if (typeof input.kind !== 'string' || !ORIGIN_KIND_SET.has(input.kind)) {
    return fail(
      'invalid-move-history-metadata',
      `${path}.kind`,
      'must be direct, copied, or random.',
    )
  }
  if (input.kind === 'direct') {
    parseExactRecord(input, DIRECT_ORIGIN_FIELDS, path)
    return { kind: 'direct' }
  }
  const derived = parseExactRecord(input, DERIVED_ORIGIN_FIELDS, path)
  return {
    kind: input.kind as 'copied' | 'random',
    sourceResolutionId: parseStableId(
      derived.sourceResolutionId,
      `${path}.sourceResolutionId`,
    ),
  }
}

export const parseMoveHistoryMoveListSource = (
  value: unknown,
  path = 'moveHistory.moveListSource',
): MoveHistoryMoveListSource => {
  const input = parseRecord(value, path)
  if (typeof input.kind !== 'string' || !MOVE_LIST_SOURCE_KIND_SET.has(input.kind)) {
    return fail(
      'invalid-move-history-metadata',
      `${path}.kind`,
      'must be placement, encounter-overlay, reviewed-pool, or history.',
    )
  }
  if (input.kind === 'placement') {
    const source = parseExactRecord(input, PLACEMENT_SOURCE_FIELDS, path)
    return {
      kind: 'placement',
      placementId: parsePlacementId(source.placementId, `${path}.placementId`),
    }
  }
  if (input.kind === 'encounter-overlay') {
    const source = parseExactRecord(input, OVERLAY_SOURCE_FIELDS, path)
    return {
      kind: 'encounter-overlay',
      placementId: parsePlacementId(source.placementId, `${path}.placementId`),
      effectId: parseStableId(source.effectId, `${path}.effectId`),
    }
  }
  if (input.kind === 'reviewed-pool') {
    const source = parseExactRecord(input, POOL_SOURCE_FIELDS, path)
    return {
      kind: 'reviewed-pool',
      poolId: parseStableId(source.poolId, `${path}.poolId`),
    }
  }
  const source = parseExactRecord(input, HISTORY_SOURCE_FIELDS, path)
  return {
    kind: 'history',
    placementId: parsePlacementId(source.placementId, `${path}.placementId`),
    resolutionId: parseStableId(source.resolutionId, `${path}.resolutionId`),
  }
}

export const parseMoveHistoryIdentity = (
  value: unknown,
  path = 'moveHistory.identity',
): MoveHistoryIdentity => {
  const input = parseExactRecord(value, IDENTITY_FIELDS, path)
  const resolutionId = parseStableId(input.resolutionId, `${path}.resolutionId`)
  const origin = parseMoveHistoryOrigin(input.origin, `${path}.origin`)
  const moveListSource = parseMoveHistoryMoveListSource(
    input.moveListSource,
    `${path}.moveListSource`,
  )
  if (origin.kind !== 'direct' && origin.sourceResolutionId === resolutionId) {
    fail(
      'invalid-move-history-metadata',
      `${path}.origin.sourceResolutionId`,
      'a copied or random move cannot originate from its own resolution.',
    )
  }
  if (moveListSource.kind === 'history' && moveListSource.resolutionId === resolutionId) {
    fail(
      'invalid-move-history-metadata',
      `${path}.moveListSource.resolutionId`,
      'a move cannot source itself from history.',
    )
  }
  if (
    origin.kind === 'copied'
    && (
      moveListSource.kind !== 'history'
      || moveListSource.resolutionId !== origin.sourceResolutionId
    )
  ) {
    fail(
      'invalid-move-history-metadata',
      `${path}.moveListSource`,
      'a copied move must name its source resolution through the history move-list source.',
    )
  }
  if (typeof input.actionType !== 'string' || !ACTION_TYPE_SET.has(input.actionType)) {
    fail(
      'invalid-move-history-metadata',
      `${path}.actionType`,
      `must be one of ${ENCOUNTER_ACTION_TYPES.join(', ')}.`,
    )
  }
  return {
    resolutionId,
    canonicalId: parseBoundedText(
      input.canonicalId,
      `${path}.canonicalId`,
      MOVE_HISTORY_METADATA_LIMITS.canonicalMoveChars,
    ),
    specVersion: parseSpecVersion(input.specVersion, `${path}.specVersion`),
    actorPlacementId: parsePlacementId(
      input.actorPlacementId,
      `${path}.actorPlacementId`,
    ),
    actionType: input.actionType as EncounterActionType,
    origin,
    moveListSource,
  }
}

export const parseMoveHistoryBranchSelections = (
  value: unknown,
  path = 'moveHistory.branches',
): readonly MoveHistoryBranchSelection[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-move-history-metadata', path, 'must be an array.')
  }
  if (value.length > MOVE_HISTORY_METADATA_LIMITS.branchSelections) {
    fail(
      'limit-exceeded',
      path,
      `must contain at most ${MOVE_HISTORY_METADATA_LIMITS.branchSelections} entries.`,
    )
  }
  const seen = new Set<string>()
  return value.map((entry, index) => {
    const entryPath = `${path}[${index}]`
    const input = parseExactRecord(entry, BRANCH_FIELDS, entryPath)
    const selection: MoveHistoryBranchSelection = {
      selectionId: parseStableId(input.selectionId, `${entryPath}.selectionId`),
      recipientId: input.recipientId === null
        ? null
        : parsePlacementId(input.recipientId, `${entryPath}.recipientId`),
      branchId: parseStableId(input.branchId, `${entryPath}.branchId`),
    }
    const key = `${selection.selectionId}\u0000${selection.recipientId ?? ''}`
    if (seen.has(key)) {
      fail(
        'duplicate-id',
        entryPath,
        'must not duplicate a selection and recipient pair.',
      )
    }
    seen.add(key)
    return selection
  })
}

const sameOrigin = (left: MoveHistoryOrigin, right: MoveHistoryOrigin): boolean => (
  left.kind === right.kind
  && (
    left.kind === 'direct'
      ? right.kind === 'direct'
      : right.kind === left.kind && right.sourceResolutionId === left.sourceResolutionId
  )
)

const sameMoveListSource = (
  left: MoveHistoryMoveListSource,
  right: MoveHistoryMoveListSource,
): boolean => {
  if (left.kind !== right.kind) return false
  if (left.kind === 'placement') {
    return right.kind === 'placement' && right.placementId === left.placementId
  }
  if (left.kind === 'encounter-overlay') {
    return right.kind === 'encounter-overlay'
      && right.placementId === left.placementId
      && right.effectId === left.effectId
  }
  if (left.kind === 'reviewed-pool') {
    return right.kind === 'reviewed-pool' && right.poolId === left.poolId
  }
  return right.kind === 'history'
    && right.placementId === left.placementId
    && right.resolutionId === left.resolutionId
}

export const moveHistoryIdentitiesEqual = (
  left: MoveHistoryIdentity,
  right: MoveHistoryIdentity,
): boolean => (
  left.resolutionId === right.resolutionId
  && left.canonicalId === right.canonicalId
  && left.specVersion === right.specVersion
  && left.actorPlacementId === right.actorPlacementId
  && left.actionType === right.actionType
  && sameOrigin(left.origin, right.origin)
  && sameMoveListSource(left.moveListSource, right.moveListSource)
)
