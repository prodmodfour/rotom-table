import { isSlug } from '../paths'
import { isRevision } from '../sessionRevisions'
import type { GridAnchor } from '~/types/map'

/** Versioned server-authored contract for one durable hazard-cell selection. */
export const MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION = 1 as const

export const MOVE_HAZARD_CELL_SELECTION_COUNT_KINDS = ['exact', 'up-to'] as const
export const MOVE_HAZARD_CELL_SELECTION_ADJACENCY_KINDS = [
  'orthogonal',
  'including-diagonal',
] as const
export const MOVE_HAZARD_CELL_SELECTION_CONNECTEDNESS_KINDS = [
  'none',
  'no-isolated',
  'connected',
] as const
export const MOVE_HAZARD_CELL_SELECTION_OCCUPANCY_KINDS = [
  'allow-occupied',
  'empty-of-placements',
] as const
export const MOVE_HAZARD_CELL_SELECTION_GEOMETRY_KINDS = [
  'horizontal-plane',
  'reviewed-cells',
] as const

export const MOVE_HAZARD_CELL_SELECTION_LIMITS = Object.freeze({
  identifierChars: 160,
  placementIdChars: 200,
  canonicalMoveIdChars: 160,
  coordinateMagnitude: 1_000_000,
  range: 1_000,
  selectedCells: 128,
  geometryCells: 512,
  options: 512,
})

export type MoveHazardCellSelectionCountKind =
  (typeof MOVE_HAZARD_CELL_SELECTION_COUNT_KINDS)[number]
export type MoveHazardCellSelectionAdjacency =
  (typeof MOVE_HAZARD_CELL_SELECTION_ADJACENCY_KINDS)[number]
export type MoveHazardCellSelectionConnectedness =
  (typeof MOVE_HAZARD_CELL_SELECTION_CONNECTEDNESS_KINDS)[number]
export type MoveHazardCellSelectionOccupancy =
  (typeof MOVE_HAZARD_CELL_SELECTION_OCCUPANCY_KINDS)[number]
export type MoveHazardCellSelectionGeometryKind =
  (typeof MOVE_HAZARD_CELL_SELECTION_GEOMETRY_KINDS)[number]

export interface MoveHazardCellSelectionExactCount {
  readonly kind: 'exact'
  readonly count: number
}

export interface MoveHazardCellSelectionUpToCount {
  readonly kind: 'up-to'
  readonly minimum: number
  readonly maximum: number
}

export type MoveHazardCellSelectionCount =
  | MoveHazardCellSelectionExactCount
  | MoveHazardCellSelectionUpToCount

/** Generate every legal cell on the origin's horizontal plane within range. */
export interface MoveHazardCellSelectionHorizontalPlaneGeometry {
  readonly kind: 'horizontal-plane'
}

/**
 * A reviewed server rule may provide a bounded geometry whitelist. Runtime move
 * prose and client-authored cells never enter this list.
 */
export interface MoveHazardCellSelectionReviewedCellsGeometry {
  readonly kind: 'reviewed-cells'
  readonly cells: readonly GridAnchor[]
}

export type MoveHazardCellSelectionGeometry =
  | MoveHazardCellSelectionHorizontalPlaneGeometry
  | MoveHazardCellSelectionReviewedCellsGeometry

export interface MoveHazardCellSelectionMapContext {
  readonly slug: string
  readonly revision: number
}

/** Private move bindings retained with the durable window. */
export interface MoveHazardCellSelectionMoveContext {
  readonly resolutionId: string
  readonly actorPlacementId: string
  readonly canonicalMoveId: string
  readonly operationId: string
  readonly cellSetId: string
}

/** Move bindings safe to expose after the normal response-window authorization. */
export interface MoveHazardCellSelectionPublicMoveContext {
  readonly resolutionId: string
  readonly actorPlacementId: string
  readonly canonicalMoveId: string
}

export interface MoveHazardCellSelectionRules {
  readonly count: MoveHazardCellSelectionCount
  /** Inclusive PTU grid distance from the server-selected origin. */
  readonly range: number
  readonly adjacency: MoveHazardCellSelectionAdjacency
  readonly connectedness: MoveHazardCellSelectionConnectedness
  readonly occupancy: MoveHazardCellSelectionOccupancy
  readonly geometry: MoveHazardCellSelectionGeometry
}

export interface MoveHazardCellSelectionConstraints extends MoveHazardCellSelectionRules {
  /** Server-selected range origin, not a coordinate accepted from response intent. */
  readonly origin: GridAnchor
}

/** Strict server-authored declaration used to materialize a durable window. */
export interface MoveHazardCellSelectionDeclaration {
  readonly schemaVersion: typeof MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION
  readonly windowId: string
  readonly promptKey: string
  readonly map: MoveHazardCellSelectionMapContext
  readonly move: MoveHazardCellSelectionMoveContext
  readonly constraints: MoveHazardCellSelectionConstraints
}

/** A client may return this option's ID, never its server-owned cell value. */
export interface MoveHazardCellSelectionOption {
  readonly id: string
  readonly cell: GridAnchor
}

/** Private durable window retaining the reviewed declaration and option values. */
export interface MoveHazardCellSelectionWindow {
  readonly schemaVersion: typeof MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION
  readonly declaration: MoveHazardCellSelectionDeclaration
  readonly options: readonly MoveHazardCellSelectionOption[]
}

export interface MoveHazardCellSelectionPublicGeometry {
  readonly kind: MoveHazardCellSelectionGeometryKind
}

/** Authorized bounded projection consumed by the future multi-cell overlay. */
export interface MoveHazardCellSelectionPublicWindow {
  readonly schemaVersion: typeof MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION
  readonly windowId: string
  readonly promptKey: string
  readonly map: MoveHazardCellSelectionMapContext
  readonly move: MoveHazardCellSelectionPublicMoveContext
  readonly count: MoveHazardCellSelectionCount
  readonly origin: GridAnchor
  readonly range: number
  readonly adjacency: MoveHazardCellSelectionAdjacency
  readonly connectedness: MoveHazardCellSelectionConnectedness
  readonly occupancy: MoveHazardCellSelectionOccupancy
  readonly geometry: MoveHazardCellSelectionPublicGeometry
  readonly options: readonly MoveHazardCellSelectionOption[]
}

export type MoveHazardCellSelectionValidationCode =
  | 'invalid-hazard-cell-selection'
  | 'unsupported-schema-version'
  | 'unknown-kind'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'inconsistent-window'

export class MoveHazardCellSelectionValidationError extends Error {
  readonly code: MoveHazardCellSelectionValidationCode
  readonly path: string
  readonly detail: string

  constructor(
    code: MoveHazardCellSelectionValidationCode,
    path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`)
    this.name = 'MoveHazardCellSelectionValidationError'
    this.code = code
    this.path = path
    this.detail = detail
  }
}

type UnknownRecord = Record<string, unknown>
type OptionNamespace = Pick<MoveHazardCellSelectionDeclaration, 'windowId' | 'map'> & {
  readonly move: Pick<
    MoveHazardCellSelectionMoveContext,
    'resolutionId' | 'actorPlacementId' | 'canonicalMoveId'
  >
}

const DECLARATION_FIELDS = [
  'schemaVersion',
  'windowId',
  'promptKey',
  'map',
  'move',
  'constraints',
] as const
const MAP_CONTEXT_FIELDS = ['slug', 'revision'] as const
const MOVE_CONTEXT_FIELDS = [
  'resolutionId',
  'actorPlacementId',
  'canonicalMoveId',
  'operationId',
  'cellSetId',
] as const
const PUBLIC_MOVE_CONTEXT_FIELDS = [
  'resolutionId',
  'actorPlacementId',
  'canonicalMoveId',
] as const
const RULE_FIELDS = [
  'count',
  'range',
  'adjacency',
  'connectedness',
  'occupancy',
  'geometry',
] as const
const CONSTRAINT_FIELDS = [
  ...RULE_FIELDS,
  'origin',
] as const
const EXACT_COUNT_FIELDS = ['kind', 'count'] as const
const UP_TO_COUNT_FIELDS = ['kind', 'minimum', 'maximum'] as const
const HORIZONTAL_GEOMETRY_FIELDS = ['kind'] as const
const REVIEWED_GEOMETRY_FIELDS = ['kind', 'cells'] as const
const CELL_FIELDS = ['x', 'y', 'z'] as const
const OPTION_FIELDS = ['id', 'cell'] as const
const WINDOW_FIELDS = ['schemaVersion', 'declaration', 'options'] as const
const PUBLIC_GEOMETRY_FIELDS = ['kind'] as const
const PUBLIC_WINDOW_FIELDS = [
  'schemaVersion',
  'windowId',
  'promptKey',
  'map',
  'move',
  'count',
  'origin',
  'range',
  'adjacency',
  'connectedness',
  'occupancy',
  'geometry',
  'options',
] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const COUNT_KIND_SET = new Set<unknown>(MOVE_HAZARD_CELL_SELECTION_COUNT_KINDS)
const ADJACENCY_SET = new Set<unknown>(MOVE_HAZARD_CELL_SELECTION_ADJACENCY_KINDS)
const CONNECTEDNESS_SET = new Set<unknown>(MOVE_HAZARD_CELL_SELECTION_CONNECTEDNESS_KINDS)
const OCCUPANCY_SET = new Set<unknown>(MOVE_HAZARD_CELL_SELECTION_OCCUPANCY_KINDS)
const GEOMETRY_KIND_SET = new Set<unknown>(MOVE_HAZARD_CELL_SELECTION_GEOMETRY_KINDS)

const fail = (
  code: MoveHazardCellSelectionValidationCode,
  path: string,
  detail: string,
): never => {
  throw new MoveHazardCellSelectionValidationError(code, path, detail)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const exactRecord = (
  value: unknown,
  fields: readonly string[],
  path: string,
): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-hazard-cell-selection', path, 'must be a plain object.')
  }
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length === 0 && unknown.length === 0) return value
  const detail = [
    missing.length > 0 ? `missing ${missing.join(', ')}` : '',
    unknown.length > 0 ? `unknown ${unknown.join(', ')}` : '',
  ].filter(Boolean).join('; ')
  return fail(
    'invalid-hazard-cell-selection',
    path,
    `must contain exactly the supported fields (${detail}).`,
  )
}

const boundedText = (
  value: unknown,
  path: string,
  maximum: number,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-hazard-cell-selection',
      path,
      `must be a non-empty trimmed string of at most ${maximum} characters without control characters.`,
    )
  }
  return value
}

const stableId = (value: unknown, path: string): string => {
  const parsed = boundedText(
    value,
    path,
    MOVE_HAZARD_CELL_SELECTION_LIMITS.identifierChars,
  )
  if (!STABLE_ID_PATTERN.test(parsed)) {
    return fail(
      'invalid-hazard-cell-selection',
      path,
      'must be a lowercase stable identifier.',
    )
  }
  return parsed
}

const boundedInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number => {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    return fail(
      'limit-exceeded',
      path,
      `must be a safe integer from ${minimum} through ${maximum}.`,
    )
  }
  return value
}

const parseCell = (value: unknown, path: string): GridAnchor => {
  const record = exactRecord(value, CELL_FIELDS, path)
  const limit = MOVE_HAZARD_CELL_SELECTION_LIMITS.coordinateMagnitude
  return Object.freeze({
    x: boundedInteger(record.x, `${path}.x`, -limit, limit),
    y: boundedInteger(record.y, `${path}.y`, -limit, limit),
    z: boundedInteger(record.z, `${path}.z`, -limit, limit),
  })
}

export const moveHazardCellSelectionCellKey = (cell: GridAnchor): string => (
  `${cell.x},${cell.y},${cell.z}`
)

/** Canonical map order: elevation, row, then column. */
export const compareMoveHazardCellSelectionCells = (
  left: GridAnchor,
  right: GridAnchor,
): number => left.y - right.y || left.z - right.z || left.x - right.x

/** Strict parser reused by reviewed hazard-zone geometry declarations. */
export const parseMoveHazardCellSelectionCount = (
  value: unknown,
  path = 'hazardCellSelection.count',
): MoveHazardCellSelectionCount => {
  if (!isPlainRecord(value) || !COUNT_KIND_SET.has(value.kind)) {
    return fail(
      'unknown-kind',
      `${path}.kind`,
      `must be one of: ${MOVE_HAZARD_CELL_SELECTION_COUNT_KINDS.join(', ')}.`,
    )
  }
  if (value.kind === 'exact') {
    const record = exactRecord(value, EXACT_COUNT_FIELDS, path)
    return Object.freeze({
      kind: 'exact',
      count: boundedInteger(
        record.count,
        `${path}.count`,
        1,
        MOVE_HAZARD_CELL_SELECTION_LIMITS.selectedCells,
      ),
    })
  }
  const record = exactRecord(value, UP_TO_COUNT_FIELDS, path)
  const minimum = boundedInteger(
    record.minimum,
    `${path}.minimum`,
    0,
    MOVE_HAZARD_CELL_SELECTION_LIMITS.selectedCells,
  )
  const maximum = boundedInteger(
    record.maximum,
    `${path}.maximum`,
    1,
    MOVE_HAZARD_CELL_SELECTION_LIMITS.selectedCells,
  )
  if (minimum > maximum) {
    return fail('inconsistent-window', path, 'minimum cannot exceed maximum.')
  }
  return Object.freeze({ kind: 'up-to', minimum, maximum })
}

const parseGeometry = (
  value: unknown,
  path: string,
): MoveHazardCellSelectionGeometry => {
  if (!isPlainRecord(value) || !GEOMETRY_KIND_SET.has(value.kind)) {
    return fail(
      'unknown-kind',
      `${path}.kind`,
      `must be one of: ${MOVE_HAZARD_CELL_SELECTION_GEOMETRY_KINDS.join(', ')}.`,
    )
  }
  if (value.kind === 'horizontal-plane') {
    exactRecord(value, HORIZONTAL_GEOMETRY_FIELDS, path)
    return Object.freeze({ kind: 'horizontal-plane' })
  }
  const record = exactRecord(value, REVIEWED_GEOMETRY_FIELDS, path)
  if (!Array.isArray(record.cells)) {
    return fail('invalid-hazard-cell-selection', `${path}.cells`, 'must be an array.')
  }
  if (
    record.cells.length === 0
    || record.cells.length > MOVE_HAZARD_CELL_SELECTION_LIMITS.geometryCells
  ) {
    return fail(
      'limit-exceeded',
      `${path}.cells`,
      `must contain 1 through ${MOVE_HAZARD_CELL_SELECTION_LIMITS.geometryCells} cells.`,
    )
  }
  const cells = record.cells.map((cell, index) => parseCell(cell, `${path}.cells[${index}]`))
  const keys = cells.map(moveHazardCellSelectionCellKey)
  if (new Set(keys).size !== keys.length) {
    return fail('duplicate-id', `${path}.cells`, 'must not contain duplicate cells.')
  }
  return Object.freeze({ kind: 'reviewed-cells', cells: Object.freeze(cells) })
}

const parseMapContext = (
  value: unknown,
  path: string,
): MoveHazardCellSelectionMapContext => {
  const record = exactRecord(value, MAP_CONTEXT_FIELDS, path)
  if (!isSlug(record.slug)) {
    return fail('invalid-hazard-cell-selection', `${path}.slug`, 'must be a valid map slug.')
  }
  if (!isRevision(record.revision)) {
    return fail(
      'invalid-hazard-cell-selection',
      `${path}.revision`,
      'must be a safe non-negative map revision.',
    )
  }
  return Object.freeze({ slug: record.slug, revision: record.revision })
}

const parseMoveContext = (
  value: unknown,
  path: string,
): MoveHazardCellSelectionMoveContext => {
  const record = exactRecord(value, MOVE_CONTEXT_FIELDS, path)
  return Object.freeze({
    resolutionId: boundedText(
      record.resolutionId,
      `${path}.resolutionId`,
      MOVE_HAZARD_CELL_SELECTION_LIMITS.identifierChars,
    ),
    actorPlacementId: boundedText(
      record.actorPlacementId,
      `${path}.actorPlacementId`,
      MOVE_HAZARD_CELL_SELECTION_LIMITS.placementIdChars,
    ),
    canonicalMoveId: boundedText(
      record.canonicalMoveId,
      `${path}.canonicalMoveId`,
      MOVE_HAZARD_CELL_SELECTION_LIMITS.canonicalMoveIdChars,
    ),
    operationId: stableId(record.operationId, `${path}.operationId`),
    cellSetId: stableId(record.cellSetId, `${path}.cellSetId`),
  })
}

const parsePublicMoveContext = (
  value: unknown,
  path: string,
): MoveHazardCellSelectionPublicMoveContext => {
  const record = exactRecord(value, PUBLIC_MOVE_CONTEXT_FIELDS, path)
  return Object.freeze({
    resolutionId: boundedText(
      record.resolutionId,
      `${path}.resolutionId`,
      MOVE_HAZARD_CELL_SELECTION_LIMITS.identifierChars,
    ),
    actorPlacementId: boundedText(
      record.actorPlacementId,
      `${path}.actorPlacementId`,
      MOVE_HAZARD_CELL_SELECTION_LIMITS.placementIdChars,
    ),
    canonicalMoveId: boundedText(
      record.canonicalMoveId,
      `${path}.canonicalMoveId`,
      MOVE_HAZARD_CELL_SELECTION_LIMITS.canonicalMoveIdChars,
    ),
  })
}

/** Strictly parse the reusable reviewed rules attached to a hazard operation. */
export const parseMoveHazardCellSelectionRules = (
  value: unknown,
  path = 'hazardCellSelection.rules',
): MoveHazardCellSelectionRules => {
  const record = exactRecord(value, RULE_FIELDS, path)
  if (!ADJACENCY_SET.has(record.adjacency)) {
    return fail(
      'unknown-kind',
      `${path}.adjacency`,
      `must be one of: ${MOVE_HAZARD_CELL_SELECTION_ADJACENCY_KINDS.join(', ')}.`,
    )
  }
  if (!CONNECTEDNESS_SET.has(record.connectedness)) {
    return fail(
      'unknown-kind',
      `${path}.connectedness`,
      `must be one of: ${MOVE_HAZARD_CELL_SELECTION_CONNECTEDNESS_KINDS.join(', ')}.`,
    )
  }
  if (!OCCUPANCY_SET.has(record.occupancy)) {
    return fail(
      'unknown-kind',
      `${path}.occupancy`,
      `must be one of: ${MOVE_HAZARD_CELL_SELECTION_OCCUPANCY_KINDS.join(', ')}.`,
    )
  }
  const count = parseMoveHazardCellSelectionCount(record.count, `${path}.count`)
  const geometry = parseGeometry(record.geometry, `${path}.geometry`)
  const maximumCount = count.kind === 'exact' ? count.count : count.maximum
  if (geometry.kind === 'reviewed-cells' && maximumCount > geometry.cells.length) {
    return fail(
      'inconsistent-window',
      `${path}.count`,
      'cannot request more cells than the reviewed geometry contains.',
    )
  }
  return Object.freeze({
    count,
    range: boundedInteger(
      record.range,
      `${path}.range`,
      0,
      MOVE_HAZARD_CELL_SELECTION_LIMITS.range,
    ),
    adjacency: record.adjacency as MoveHazardCellSelectionAdjacency,
    connectedness: record.connectedness as MoveHazardCellSelectionConnectedness,
    occupancy: record.occupancy as MoveHazardCellSelectionOccupancy,
    geometry,
  })
}

const parseConstraints = (
  value: unknown,
  path: string,
): MoveHazardCellSelectionConstraints => {
  const record = exactRecord(value, CONSTRAINT_FIELDS, path)
  const rules = parseMoveHazardCellSelectionRules({
    count: record.count,
    range: record.range,
    adjacency: record.adjacency,
    connectedness: record.connectedness,
    occupancy: record.occupancy,
    geometry: record.geometry,
  }, path)
  return Object.freeze({
    ...rules,
    origin: parseCell(record.origin, `${path}.origin`),
  })
}

/** Strictly parse, detach, and freeze one reviewed server declaration. */
export const parseMoveHazardCellSelectionDeclaration = (
  value: unknown,
  path = 'hazardCellSelection.declaration',
): MoveHazardCellSelectionDeclaration => {
  const record = exactRecord(value, DECLARATION_FIELDS, path)
  if (record.schemaVersion !== MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION) {
    return fail(
      'unsupported-schema-version',
      `${path}.schemaVersion`,
      `must equal ${MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION}.`,
    )
  }
  return Object.freeze({
    schemaVersion: MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION,
    windowId: stableId(record.windowId, `${path}.windowId`),
    promptKey: stableId(record.promptKey, `${path}.promptKey`),
    map: parseMapContext(record.map, `${path}.map`),
    move: parseMoveContext(record.move, `${path}.move`),
    constraints: parseConstraints(record.constraints, `${path}.constraints`),
  })
}

const stableNamespaceHash = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const optionNamespace = (value: OptionNamespace): string => (
  `${value.map.slug}:${value.map.revision}:${value.move.resolutionId}:`
  + `${value.move.actorPlacementId}:${value.move.canonicalMoveId}:${value.windowId}`
)

/** Stable ID bound to the map revision, durable resolution, window, and cell. */
export const moveHazardCellSelectionOptionId = (
  namespace: OptionNamespace,
  cell: GridAnchor,
): string => (
  `hazard.cell.${stableNamespaceHash(optionNamespace(namespace))}.`
  + `${cell.x}.${cell.y}.${cell.z}`
)

/** One bounded audit identity for a canonical multi-cell response. */
export const moveHazardCellSelectionResponseId = (
  windowId: string,
  optionIds: readonly string[],
): string => `hazard.selection.${stableNamespaceHash(`${windowId}:${optionIds.join(':')}`)}`

const parseOption = (
  value: unknown,
  path: string,
): MoveHazardCellSelectionOption => {
  const record = exactRecord(value, OPTION_FIELDS, path)
  return Object.freeze({
    id: stableId(record.id, `${path}.id`),
    cell: parseCell(record.cell, `${path}.cell`),
  })
}

const parseOptions = (
  value: unknown,
  namespace: OptionNamespace,
  path: string,
): readonly MoveHazardCellSelectionOption[] => {
  if (!Array.isArray(value)) {
    return fail('invalid-hazard-cell-selection', path, 'must be an array.')
  }
  if (value.length > MOVE_HAZARD_CELL_SELECTION_LIMITS.options) {
    return fail(
      'limit-exceeded',
      path,
      `must contain at most ${MOVE_HAZARD_CELL_SELECTION_LIMITS.options} options.`,
    )
  }
  const options = value.map((option, index) => parseOption(option, `${path}[${index}]`))
  if (new Set(options.map(option => option.id)).size !== options.length) {
    return fail('duplicate-id', path, 'must not contain duplicate option IDs.')
  }
  if (new Set(options.map(option => moveHazardCellSelectionCellKey(option.cell))).size !== options.length) {
    return fail('duplicate-id', path, 'must not contain duplicate option cells.')
  }
  options.forEach((option, index) => {
    if (option.id !== moveHazardCellSelectionOptionId(namespace, option.cell)) {
      fail(
        'inconsistent-window',
        `${path}[${index}].id`,
        'does not match its server-owned cell and window namespace.',
      )
    }
    if (
      index > 0
      && compareMoveHazardCellSelectionCells(options[index - 1]!.cell, option.cell) >= 0
    ) {
      fail(
        'inconsistent-window',
        path,
        'must use strict canonical elevation, row, then column order.',
      )
    }
  })
  return Object.freeze(options)
}

const minimumCount = (count: MoveHazardCellSelectionCount): number => (
  count.kind === 'exact' ? count.count : count.minimum
)

/** Strictly parse one private durable hazard-cell window. */
export const parseMoveHazardCellSelectionWindow = (
  value: unknown,
  path = 'hazardCellSelection.window',
): MoveHazardCellSelectionWindow => {
  const record = exactRecord(value, WINDOW_FIELDS, path)
  if (record.schemaVersion !== MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION) {
    return fail(
      'unsupported-schema-version',
      `${path}.schemaVersion`,
      `must equal ${MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION}.`,
    )
  }
  const declaration = parseMoveHazardCellSelectionDeclaration(
    record.declaration,
    `${path}.declaration`,
  )
  const options = parseOptions(record.options, declaration, `${path}.options`)
  if (options.length < minimumCount(declaration.constraints.count)) {
    return fail(
      'inconsistent-window',
      `${path}.options`,
      'does not contain enough legal options for the declared minimum count.',
    )
  }
  return Object.freeze({
    schemaVersion: MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION,
    declaration,
    options,
  })
}

const parsePublicGeometry = (
  value: unknown,
  path: string,
): MoveHazardCellSelectionPublicGeometry => {
  const record = exactRecord(value, PUBLIC_GEOMETRY_FIELDS, path)
  if (!GEOMETRY_KIND_SET.has(record.kind)) {
    return fail(
      'unknown-kind',
      `${path}.kind`,
      `must be one of: ${MOVE_HAZARD_CELL_SELECTION_GEOMETRY_KINDS.join(', ')}.`,
    )
  }
  return Object.freeze({ kind: record.kind as MoveHazardCellSelectionGeometryKind })
}

/** Strictly parse one authorized public hazard-cell prompt projection. */
export const parseMoveHazardCellSelectionPublicWindow = (
  value: unknown,
  path = 'hazardCellSelection.publicWindow',
): MoveHazardCellSelectionPublicWindow => {
  const record = exactRecord(value, PUBLIC_WINDOW_FIELDS, path)
  if (record.schemaVersion !== MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION) {
    return fail(
      'unsupported-schema-version',
      `${path}.schemaVersion`,
      `must equal ${MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION}.`,
    )
  }
  const windowId = stableId(record.windowId, `${path}.windowId`)
  const map = parseMapContext(record.map, `${path}.map`)
  const move = parsePublicMoveContext(record.move, `${path}.move`)
  const count = parseMoveHazardCellSelectionCount(record.count, `${path}.count`)
  const namespace = { windowId, map, move }
  const options = parseOptions(record.options, namespace, `${path}.options`)
  if (options.length < minimumCount(count)) {
    return fail(
      'inconsistent-window',
      `${path}.options`,
      'does not contain enough legal options for the declared minimum count.',
    )
  }
  if (!ADJACENCY_SET.has(record.adjacency)) {
    return fail('unknown-kind', `${path}.adjacency`, 'is unsupported.')
  }
  if (!CONNECTEDNESS_SET.has(record.connectedness)) {
    return fail('unknown-kind', `${path}.connectedness`, 'is unsupported.')
  }
  if (!OCCUPANCY_SET.has(record.occupancy)) {
    return fail('unknown-kind', `${path}.occupancy`, 'is unsupported.')
  }
  return Object.freeze({
    schemaVersion: MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION,
    windowId,
    promptKey: stableId(record.promptKey, `${path}.promptKey`),
    map,
    move,
    count,
    origin: parseCell(record.origin, `${path}.origin`),
    range: boundedInteger(
      record.range,
      `${path}.range`,
      0,
      MOVE_HAZARD_CELL_SELECTION_LIMITS.range,
    ),
    adjacency: record.adjacency as MoveHazardCellSelectionAdjacency,
    connectedness: record.connectedness as MoveHazardCellSelectionConnectedness,
    occupancy: record.occupancy as MoveHazardCellSelectionOccupancy,
    geometry: parsePublicGeometry(record.geometry, `${path}.geometry`),
    options,
  })
}

/** Remove private operation/cell-set bindings while preserving authorized choices. */
export const projectMoveHazardCellSelectionPublicWindow = (
  value: MoveHazardCellSelectionWindow,
): MoveHazardCellSelectionPublicWindow => {
  const parsedWindow = parseMoveHazardCellSelectionWindow(value)
  const { declaration } = parsedWindow
  return parseMoveHazardCellSelectionPublicWindow({
    schemaVersion: MOVE_HAZARD_CELL_SELECTION_SCHEMA_VERSION,
    windowId: declaration.windowId,
    promptKey: declaration.promptKey,
    map: declaration.map,
    move: {
      resolutionId: declaration.move.resolutionId,
      actorPlacementId: declaration.move.actorPlacementId,
      canonicalMoveId: declaration.move.canonicalMoveId,
    },
    count: declaration.constraints.count,
    origin: declaration.constraints.origin,
    range: declaration.constraints.range,
    adjacency: declaration.constraints.adjacency,
    connectedness: declaration.constraints.connectedness,
    occupancy: declaration.constraints.occupancy,
    geometry: { kind: declaration.constraints.geometry.kind },
    options: parsedWindow.options,
  })
}
