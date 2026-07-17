import {
  MovePredicateValidationError,
  parseMovePredicate,
  type MovePredicate,
} from './predicates'

export const MOVE_RANDOM_TABLE_DISTRIBUTIONS = ['equal', 'weighted'] as const
export const MOVE_RANDOM_MOVE_POOL_SOURCE_KINDS = [
  'explicit',
  'authoritative-move-lists',
] as const
export const MOVE_RANDOM_MOVE_POOL_OWNER_KINDS = [
  'actor',
  'operation-recipients',
  'actor-and-operation-recipients',
] as const

export const MOVE_RANDOM_SELECTION_LIMITS = Object.freeze({
  tableEntries: 64,
  operationReferences: 128,
  moveCandidates: 256,
  weight: 10_000,
  totalWeight: 1_000_000,
  maximumRerolls: 16,
  identifierLength: 160,
  rollIdLength: 128,
  canonicalMoveLength: 160,
})

export type MoveRandomTableDistribution =
  (typeof MOVE_RANDOM_TABLE_DISTRIBUTIONS)[number]
export type MoveRandomMovePoolSourceKind =
  (typeof MOVE_RANDOM_MOVE_POOL_SOURCE_KINDS)[number]
export type MoveRandomMovePoolOwnerKind =
  (typeof MOVE_RANDOM_MOVE_POOL_OWNER_KINDS)[number]

/** One reviewed table outcome and the later typed operations it enables. */
export interface MoveRandomTableEntry {
  readonly id: string
  /** Null for equal tables; a positive integer for weighted tables. */
  readonly weight: number | null
  readonly operationIds: readonly string[]
  /** A selected inapplicable entry may be rerolled within the reviewed bound. */
  readonly predicate: MovePredicate | null
}

export interface MoveRandomTableDefinition {
  readonly tableId: string
  readonly distribution: MoveRandomTableDistribution
  readonly entries: readonly MoveRandomTableEntry[]
  /** Additional attempts after the first selected entry is inapplicable. */
  readonly maximumRerolls: number
}

export interface MoveRandomExplicitPoolSource {
  readonly kind: 'explicit'
  readonly canonicalIds: readonly string[]
}

export interface MoveRandomAuthoritativeMoveListsPoolSource {
  readonly kind: 'authoritative-move-lists'
  readonly owners: MoveRandomMovePoolOwnerKind
}

export type MoveRandomMovePoolSource =
  | MoveRandomExplicitPoolSource
  | MoveRandomAuthoritativeMoveListsPoolSource

export interface MoveRandomMovePoolDefinition {
  readonly poolId: string
  readonly rollId: string
  readonly source: MoveRandomMovePoolSource
  /** Empty means every source candidate is allowed. */
  readonly allowCanonicalIds: readonly string[]
  /** Denial always wins over source membership and the allow set. */
  readonly denyCanonicalIds: readonly string[]
  readonly maximumRerolls: number
}

export type MoveRandomSelectionValidationCode =
  | 'invalid-random-selection'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'not-json'

export class MoveRandomSelectionValidationError extends Error {
  readonly code: MoveRandomSelectionValidationCode
  readonly path: string

  constructor(code: MoveRandomSelectionValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'MoveRandomSelectionValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const TABLE_FIELDS = ['tableId', 'distribution', 'entries', 'maximumRerolls'] as const
const TABLE_ENTRY_FIELDS = ['id', 'weight', 'operationIds', 'predicate'] as const
const MOVE_POOL_FIELDS = [
  'poolId',
  'rollId',
  'source',
  'allowCanonicalIds',
  'denyCanonicalIds',
  'maximumRerolls',
] as const
const EXPLICIT_POOL_SOURCE_FIELDS = ['kind', 'canonicalIds'] as const
const AUTHORITATIVE_POOL_SOURCE_FIELDS = ['kind', 'owners'] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ARRAY_INDEX_PATTERN = /^(0|[1-9][0-9]*)$/
const TABLE_DISTRIBUTION_SET = new Set<string>(MOVE_RANDOM_TABLE_DISTRIBUTIONS)
const MOVE_POOL_SOURCE_KIND_SET = new Set<string>(MOVE_RANDOM_MOVE_POOL_SOURCE_KINDS)
const MOVE_POOL_OWNER_KIND_SET = new Set<string>(MOVE_RANDOM_MOVE_POOL_OWNER_KINDS)

const fail = (
  code: MoveRandomSelectionValidationCode,
  path: string,
  message: string,
): never => {
  throw new MoveRandomSelectionValidationError(code, path, message)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const parseRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) return fail('not-json', path, 'must be a plain JSON object.')
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('not-json', path, 'symbol properties are not allowed.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
      ?? fail('not-json', `${path}.${key}`, 'must have a property descriptor.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail('not-json', `${path}.${key}`, 'fields must be enumerable data properties.')
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
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(record, field))
  const unknown = Object.keys(record).filter(field => !expected.has(field))
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'invalid-random-selection',
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
  return record
}

const parseArray = (
  value: unknown,
  path: string,
  maximumLength: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) return fail('invalid-random-selection', path, 'must be an array.')
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} entries.`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('not-json', path, 'symbol properties are not allowed.')
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === 'length') continue
    const index = Number(key)
    if (!ARRAY_INDEX_PATTERN.test(key) || !Number.isSafeInteger(index) || index >= value.length) {
      fail('not-json', `${path}.${key}`, 'arrays cannot contain named properties.')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
      ?? fail('not-json', `${path}[${key}]`, 'must have a property descriptor.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail('not-json', `${path}[${key}]`, 'entries must be enumerable data properties.')
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      fail('not-json', `${path}[${index}]`, 'sparse arrays are not allowed.')
    }
  }
  return value
}

const parseText = (
  value: unknown,
  path: string,
  maximumLength: number,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail(
      'invalid-random-selection',
      path,
      'must be a non-empty, trimmed string without control characters.',
    )
  }
  if (value.length > maximumLength) {
    fail('limit-exceeded', path, `must contain at most ${maximumLength} characters.`)
  }
  return value
}

const parseStableId = (
  value: unknown,
  path: string,
  maximumLength: number = MOVE_RANDOM_SELECTION_LIMITS.identifierLength,
): string => {
  const id = parseText(value, path, maximumLength)
  if (!STABLE_ID_PATTERN.test(id)) {
    fail('invalid-random-selection', path, 'must be a lowercase stable identifier.')
  }
  return id
}

const parseInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    return fail(
      'invalid-random-selection',
      path,
      `must be a safe integer from ${minimum} through ${maximum}.`,
    )
  }
  return Number(value)
}

const parseEnum = <Value extends string>(
  value: unknown,
  values: ReadonlySet<string>,
  path: string,
  description: string,
): Value => {
  if (typeof value !== 'string' || !values.has(value)) {
    return fail('invalid-random-selection', path, `must be ${description}.`)
  }
  return value as Value
}

const parseUniqueTextList = (
  value: unknown,
  path: string,
  maximumLength: number,
  parseEntry: (entry: unknown, path: string) => string,
): readonly string[] => {
  const entries = parseArray(value, path, maximumLength).map((entry, index) => (
    parseEntry(entry, `${path}[${index}]`)
  ))
  if (new Set(entries).size !== entries.length) {
    fail('duplicate-id', path, 'must not contain duplicate entries.')
  }
  return entries
}

const parseOperationIds = (value: unknown, path: string): readonly string[] => (
  parseUniqueTextList(
    value,
    path,
    MOVE_RANDOM_SELECTION_LIMITS.operationReferences,
    parseStableId,
  )
)

const parseCanonicalIds = (value: unknown, path: string): readonly string[] => (
  parseUniqueTextList(
    value,
    path,
    MOVE_RANDOM_SELECTION_LIMITS.moveCandidates,
    (entry, entryPath) => parseText(
      entry,
      entryPath,
      MOVE_RANDOM_SELECTION_LIMITS.canonicalMoveLength,
    ),
  )
)

const parsePredicate = (value: unknown, path: string): MovePredicate | null => {
  if (value === null) return null
  try {
    return parseMovePredicate(value, path)
  }
  catch (error) {
    if (!(error instanceof MovePredicateValidationError)) throw error
    const detailPrefix = `${error.path}: `
    const detail = error.message.startsWith(detailPrefix)
      ? error.message.slice(detailPrefix.length)
      : error.message
    return fail(
      error.code === 'limit-exceeded'
        ? 'limit-exceeded'
        : error.code === 'not-json'
          ? 'not-json'
          : 'invalid-random-selection',
      error.path,
      detail,
    )
  }
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

export const randomSelectionRollId = (
  baseRollId: string,
  attempt: number,
): string => attempt === 1 ? baseRollId : `${baseRollId}.reroll-${attempt - 1}`

/** Strictly parse one reviewed equal/weighted operation table. */
export const parseMoveRandomTableDefinition = (
  value: unknown,
  path = 'randomTable',
): MoveRandomTableDefinition => {
  const input = parseExactRecord(value, TABLE_FIELDS, path)
  const distribution = parseEnum<MoveRandomTableDistribution>(
    input.distribution,
    TABLE_DISTRIBUTION_SET,
    `${path}.distribution`,
    'equal or weighted',
  )
  const entriesPath = `${path}.entries`
  const entries = parseArray(
    input.entries,
    entriesPath,
    MOVE_RANDOM_SELECTION_LIMITS.tableEntries,
  ).map((value, index): MoveRandomTableEntry => {
    const entryPath = `${entriesPath}[${index}]`
    const entry = parseExactRecord(value, TABLE_ENTRY_FIELDS, entryPath)
    const weight = entry.weight === null
      ? null
      : parseInteger(
          entry.weight,
          `${entryPath}.weight`,
          1,
          MOVE_RANDOM_SELECTION_LIMITS.weight,
        )
    if ((distribution === 'equal') !== (weight === null)) {
      fail(
        'invalid-random-selection',
        `${entryPath}.weight`,
        distribution === 'equal'
          ? 'must be null for an equal table.'
          : 'must be a positive integer for a weighted table.',
      )
    }
    return {
      id: parseStableId(entry.id, `${entryPath}.id`),
      weight,
      operationIds: parseOperationIds(entry.operationIds, `${entryPath}.operationIds`),
      predicate: parsePredicate(entry.predicate, `${entryPath}.predicate`),
    }
  })
  if (entries.length === 0) {
    fail('invalid-random-selection', entriesPath, 'must contain at least one entry.')
  }
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) {
    fail('duplicate-id', `${entriesPath}.id`, 'must not contain duplicate entry IDs.')
  }
  const operationReferenceCount = entries.reduce(
    (total, entry) => total + entry.operationIds.length,
    0,
  )
  if (operationReferenceCount > MOVE_RANDOM_SELECTION_LIMITS.operationReferences) {
    fail(
      'limit-exceeded',
      entriesPath,
      `must contain at most ${MOVE_RANDOM_SELECTION_LIMITS.operationReferences} operation references in total.`,
    )
  }
  const totalWeight = entries.reduce(
    (total, entry) => total + (entry.weight ?? 1),
    0,
  )
  if (!Number.isSafeInteger(totalWeight) || totalWeight > MOVE_RANDOM_SELECTION_LIMITS.totalWeight) {
    fail(
      'limit-exceeded',
      entriesPath,
      `total weight must not exceed ${MOVE_RANDOM_SELECTION_LIMITS.totalWeight}.`,
    )
  }
  return deepFreeze({
    tableId: parseStableId(input.tableId, `${path}.tableId`),
    distribution,
    entries,
    maximumRerolls: parseInteger(
      input.maximumRerolls,
      `${path}.maximumRerolls`,
      0,
      MOVE_RANDOM_SELECTION_LIMITS.maximumRerolls,
    ),
  })
}

const parseMovePoolSource = (
  value: unknown,
  path: string,
): MoveRandomMovePoolSource => {
  const input = parseRecord(value, path)
  const kind = parseEnum<MoveRandomMovePoolSourceKind>(
    input.kind,
    MOVE_POOL_SOURCE_KIND_SET,
    `${path}.kind`,
    'explicit or authoritative-move-lists',
  )
  if (kind === 'explicit') {
    const source = parseExactRecord(input, EXPLICIT_POOL_SOURCE_FIELDS, path)
    const canonicalIds = parseCanonicalIds(source.canonicalIds, `${path}.canonicalIds`)
    if (canonicalIds.length === 0) {
      fail('invalid-random-selection', `${path}.canonicalIds`, 'must contain at least one move.')
    }
    return { kind, canonicalIds }
  }
  const source = parseExactRecord(input, AUTHORITATIVE_POOL_SOURCE_FIELDS, path)
  return {
    kind,
    owners: parseEnum<MoveRandomMovePoolOwnerKind>(
      source.owners,
      MOVE_POOL_OWNER_KIND_SET,
      `${path}.owners`,
      'actor, operation-recipients, or actor-and-operation-recipients',
    ),
  }
}

/** Strictly parse one reviewed random child-move pool declaration. */
export const parseMoveRandomMovePoolDefinition = (
  value: unknown,
  path = 'movePool',
): MoveRandomMovePoolDefinition => {
  const input = parseExactRecord(value, MOVE_POOL_FIELDS, path)
  return deepFreeze({
    poolId: parseStableId(input.poolId, `${path}.poolId`),
    rollId: parseStableId(
      input.rollId,
      `${path}.rollId`,
      MOVE_RANDOM_SELECTION_LIMITS.rollIdLength,
    ),
    source: parseMovePoolSource(input.source, `${path}.source`),
    allowCanonicalIds: parseCanonicalIds(
      input.allowCanonicalIds,
      `${path}.allowCanonicalIds`,
    ),
    denyCanonicalIds: parseCanonicalIds(
      input.denyCanonicalIds,
      `${path}.denyCanonicalIds`,
    ),
    maximumRerolls: parseInteger(
      input.maximumRerolls,
      `${path}.maximumRerolls`,
      0,
      MOVE_RANDOM_SELECTION_LIMITS.maximumRerolls,
    ),
  })
}
