import {
  MOVE_ITEM_REFERENCE_KINDS,
  MOVE_ITEM_REFERENCE_LIMITS,
  isMoveCanonicalItemId,
  parseMoveItemReference,
  type MoveItemReference,
  type MoveItemReferenceKind,
} from './items'

/** Closed destination categories exposed by durable item-choice declarations. */
export const MOVE_ITEM_CHOICE_DESTINATION_KINDS = [
  'none',
  'actor-held',
  'target-held',
  'actor-inventory',
  'target-inventory',
  'group-inventory',
  'map-ground',
] as const

export const MOVE_ITEM_CHOICE_SELECTION_KINDS = [
  'move-item',
  'move-item-none',
] as const

export const MOVE_ITEM_CHOICE_LIMITS = Object.freeze({
  identifierChars: 160,
  destinations: 32,
  canonicalItemIds: 256,
  referenceKinds: MOVE_ITEM_REFERENCE_KINDS.length,
  minimumQuantity: Number.MAX_SAFE_INTEGER,
})

export type MoveItemChoiceDestinationKind =
  (typeof MOVE_ITEM_CHOICE_DESTINATION_KINDS)[number]
export type MoveItemChoiceSelectionKind =
  (typeof MOVE_ITEM_CHOICE_SELECTION_KINDS)[number]

/**
 * A reviewed destination branch. The stable ID is later consumed only by a
 * typed item operation; it is never itself an inventory patch.
 */
export interface MoveItemChoiceDestinationDeclaration {
  readonly id: string
  readonly kind: MoveItemChoiceDestinationKind
  readonly labelKey: string
}

export interface MoveItemChoiceFilter {
  readonly referenceKinds: readonly MoveItemReferenceKind[]
  /** Null means every canonical item in the reviewed resource requirement. */
  readonly canonicalItemIds: readonly string[] | null
  readonly minimumQuantity: number
}

export interface MoveItemChoiceNoneOption {
  readonly id: string
  readonly labelKey: string
}

/** Server-reviewed dynamic item option declaration embedded in a MoveSpec. */
export interface MoveItemChoiceDeclaration {
  readonly setId: string
  readonly requirementId: string
  readonly filter: MoveItemChoiceFilter
  readonly destinations: readonly MoveItemChoiceDestinationDeclaration[]
  /** A canonical "choose no item" branch, distinct from declining the window. */
  readonly noneOption: MoveItemChoiceNoneOption | null
}

/** Private durable selection. Owner identity/revision never enters a public view. */
export interface MoveItemChoiceSelection {
  readonly kind: 'move-item'
  readonly setId: string
  readonly requirementId: string
  readonly reference: MoveItemReference
  readonly destination: MoveItemChoiceDestinationDeclaration
}

export interface MoveItemNoneChoiceSelection {
  readonly kind: 'move-item-none'
  readonly setId: string
  /** Reviewed explicit-none option identity, distinct from an authorized pass. */
  readonly optionId: string
}

export type MoveItemResponseSelection =
  | MoveItemChoiceSelection
  | MoveItemNoneChoiceSelection

/** Presentation-safe item metadata available only in an authorized window. */
export interface MoveItemChoicePresentation {
  readonly canonicalItemId: string | null
  readonly destinationKind: MoveItemChoiceDestinationKind | null
  readonly destinationLabelKey: string | null
}

export type MoveItemChoiceValidationCode =
  | 'invalid-item-choice'
  | 'limit-exceeded'
  | 'duplicate-id'
  | 'inconsistent-item-choice'

export class MoveItemChoiceValidationError extends Error {
  readonly code: MoveItemChoiceValidationCode
  readonly path: string

  constructor(code: MoveItemChoiceValidationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'MoveItemChoiceValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const DECLARATION_FIELDS = [
  'setId',
  'requirementId',
  'filter',
  'destinations',
  'noneOption',
] as const
const FILTER_FIELDS = ['referenceKinds', 'canonicalItemIds', 'minimumQuantity'] as const
const DESTINATION_FIELDS = ['id', 'kind', 'labelKey'] as const
const NONE_OPTION_FIELDS = ['id', 'labelKey'] as const
const ITEM_SELECTION_FIELDS = [
  'kind',
  'setId',
  'requirementId',
  'reference',
  'destination',
] as const
const NONE_SELECTION_FIELDS = ['kind', 'setId', 'optionId'] as const
const PRESENTATION_FIELDS = [
  'canonicalItemId',
  'destinationKind',
  'destinationLabelKey',
] as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const DESTINATION_KIND_SET = new Set<unknown>(MOVE_ITEM_CHOICE_DESTINATION_KINDS)
const REFERENCE_KIND_SET = new Set<unknown>(MOVE_ITEM_REFERENCE_KINDS)

const fail = (
  code: MoveItemChoiceValidationCode,
  path: string,
  message: string,
): never => {
  throw new MoveItemChoiceValidationError(code, path, message)
}

const record = (value: unknown, path: string): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('invalid-item-choice', path, 'must be a plain object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return fail('invalid-item-choice', path, 'must be a plain object.')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('invalid-item-choice', path, 'symbol properties are not allowed.')
  }
  const detached: UnknownRecord = Object.create(null) as UnknownRecord
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      fail('invalid-item-choice', `${path}.${key}`, 'must be an enumerable data field.')
    }
    const dataDescriptor = descriptor as PropertyDescriptor & { value: unknown }
    detached[key] = dataDescriptor.value
  }
  return detached
}

const exactRecord = (
  value: unknown,
  fields: readonly string[],
  path: string,
): UnknownRecord => {
  const parsed = record(value, path)
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(parsed, field))
  const unknown = Object.keys(parsed).filter(field => !expected.has(field))
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'invalid-item-choice',
      path,
      `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
    )
  }
  return parsed
}

const stableId = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOVE_ITEM_CHOICE_LIMITS.identifierChars
    || !STABLE_ID_PATTERN.test(value)
  ) {
    return fail('invalid-item-choice', path, 'must be a bounded lowercase stable identifier.')
  }
  return value
}

const destination = (
  value: unknown,
  path: string,
): MoveItemChoiceDestinationDeclaration => {
  const input = exactRecord(value, DESTINATION_FIELDS, path)
  if (!DESTINATION_KIND_SET.has(input.kind)) {
    fail('invalid-item-choice', `${path}.kind`, 'must be a supported item destination kind.')
  }
  return Object.freeze({
    id: stableId(input.id, `${path}.id`),
    kind: input.kind as MoveItemChoiceDestinationKind,
    labelKey: stableId(input.labelKey, `${path}.labelKey`),
  })
}

const noneOption = (value: unknown, path: string): MoveItemChoiceNoneOption | null => {
  if (value === null) return null
  const input = exactRecord(value, NONE_OPTION_FIELDS, path)
  return Object.freeze({
    id: stableId(input.id, `${path}.id`),
    labelKey: stableId(input.labelKey, `${path}.labelKey`),
  })
}

const unique = (values: readonly string[], path: string): void => {
  const seen = new Set<string>()
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) fail('duplicate-id', `${path}[${index}]`, `duplicates ${value}.`)
    seen.add(value)
  }
}

/** Strictly validate one reviewed dynamic item-choice declaration. */
export const parseMoveItemChoiceDeclaration = (
  value: unknown,
  path = 'itemChoice',
): MoveItemChoiceDeclaration => {
  const input = exactRecord(value, DECLARATION_FIELDS, path)
  const filterInput = exactRecord(input.filter, FILTER_FIELDS, `${path}.filter`)
  const rawReferenceKinds = filterInput.referenceKinds
  if (
    !Array.isArray(rawReferenceKinds)
    || rawReferenceKinds.length === 0
    || rawReferenceKinds.length > MOVE_ITEM_CHOICE_LIMITS.referenceKinds
  ) {
    fail('limit-exceeded', `${path}.filter.referenceKinds`, 'must contain one bounded reference-kind set.')
  }
  const parsedRawReferenceKinds = rawReferenceKinds as readonly unknown[]
  const referenceKinds = parsedRawReferenceKinds.map((kind, index) => {
    if (!REFERENCE_KIND_SET.has(kind)) {
      return fail(
        'invalid-item-choice',
        `${path}.filter.referenceKinds[${index}]`,
        'must be a supported move item reference kind.',
      )
    }
    return kind as MoveItemReferenceKind
  })
  unique(referenceKinds, `${path}.filter.referenceKinds`)

  let canonicalItemIds: readonly string[] | null = null
  const rawCanonicalItemIds = filterInput.canonicalItemIds
  if (rawCanonicalItemIds !== null) {
    if (
      !Array.isArray(rawCanonicalItemIds)
      || rawCanonicalItemIds.length === 0
      || rawCanonicalItemIds.length > MOVE_ITEM_CHOICE_LIMITS.canonicalItemIds
    ) {
      fail(
        'limit-exceeded',
        `${path}.filter.canonicalItemIds`,
        'must be null or a non-empty bounded canonical item ID list.',
      )
    }
    const parsedRawCanonicalItemIds = rawCanonicalItemIds as readonly unknown[]
    const parsedCanonicalItemIds = parsedRawCanonicalItemIds.map((itemId, index) => {
      if (!isMoveCanonicalItemId(itemId)) {
        return fail(
          'invalid-item-choice',
          `${path}.filter.canonicalItemIds[${index}]`,
          'must be a canonical item ID.',
        )
      }
      return itemId
    })
    unique(parsedCanonicalItemIds, `${path}.filter.canonicalItemIds`)
    canonicalItemIds = Object.freeze(parsedCanonicalItemIds)
  }
  if (
    !Number.isSafeInteger(filterInput.minimumQuantity)
    || Number(filterInput.minimumQuantity) < 1
    || Number(filterInput.minimumQuantity) > MOVE_ITEM_CHOICE_LIMITS.minimumQuantity
  ) {
    fail('limit-exceeded', `${path}.filter.minimumQuantity`, 'must be a positive safe integer.')
  }

  const rawDestinations = input.destinations
  if (
    !Array.isArray(rawDestinations)
    || rawDestinations.length === 0
    || rawDestinations.length > MOVE_ITEM_CHOICE_LIMITS.destinations
  ) {
    fail('limit-exceeded', `${path}.destinations`, 'must contain one bounded destination set.')
  }
  const parsedRawDestinations = rawDestinations as readonly unknown[]
  const destinations = Object.freeze(parsedRawDestinations.map((entry, index) => (
    destination(entry, `${path}.destinations[${index}]`)
  )))
  unique(destinations.map(entry => entry.id), `${path}.destinations`)
  const parsedNoneOption = noneOption(input.noneOption, `${path}.noneOption`)
  if (parsedNoneOption && destinations.some(entry => entry.id === parsedNoneOption.id)) {
    fail('duplicate-id', `${path}.noneOption.id`, 'must not duplicate a destination ID.')
  }

  return Object.freeze({
    setId: stableId(input.setId, `${path}.setId`),
    requirementId: stableId(input.requirementId, `${path}.requirementId`),
    filter: Object.freeze({
      referenceKinds: Object.freeze(referenceKinds),
      canonicalItemIds,
      minimumQuantity: Number(filterInput.minimumQuantity),
    }),
    destinations,
    noneOption: parsedNoneOption,
  })
}

/** Strictly parse one private server-owned item or explicit-none selection. */
export const parseMoveItemResponseSelection = (
  value: unknown,
  path = 'itemSelection',
): MoveItemResponseSelection => {
  const candidate = record(value, path)
  if (candidate.kind === 'move-item-none') {
    const input = exactRecord(value, NONE_SELECTION_FIELDS, path)
    return Object.freeze({
      kind: 'move-item-none',
      setId: stableId(input.setId, `${path}.setId`),
      optionId: stableId(input.optionId, `${path}.optionId`),
    })
  }
  if (candidate.kind !== 'move-item') {
    return fail('invalid-item-choice', `${path}.kind`, 'must be move-item or move-item-none.')
  }
  const input = exactRecord(value, ITEM_SELECTION_FIELDS, path)
  return Object.freeze({
    kind: 'move-item',
    setId: stableId(input.setId, `${path}.setId`),
    requirementId: stableId(input.requirementId, `${path}.requirementId`),
    reference: parseMoveItemReference(input.reference, `${path}.reference`),
    destination: destination(input.destination, `${path}.destination`),
  })
}

/** Strictly parse the only item metadata allowed in an authorized client view. */
export const parseMoveItemChoicePresentation = (
  value: unknown,
  path = 'itemChoice',
): MoveItemChoicePresentation => {
  const input = exactRecord(value, PRESENTATION_FIELDS, path)
  const canonicalItemId = input.canonicalItemId
  if (canonicalItemId === null) {
    if (input.destinationKind !== null || input.destinationLabelKey !== null) {
      fail('inconsistent-item-choice', path, 'an explicit-none choice cannot expose a destination.')
    }
    return Object.freeze({
      canonicalItemId: null,
      destinationKind: null,
      destinationLabelKey: null,
    })
  }
  if (!isMoveCanonicalItemId(canonicalItemId)) {
    fail('invalid-item-choice', `${path}.canonicalItemId`, 'must be a canonical item ID or null.')
  }
  const parsedCanonicalItemId = canonicalItemId as string
  if (!DESTINATION_KIND_SET.has(input.destinationKind)) {
    fail('invalid-item-choice', `${path}.destinationKind`, 'must be a supported destination kind.')
  }
  return Object.freeze({
    canonicalItemId: parsedCanonicalItemId,
    destinationKind: input.destinationKind as MoveItemChoiceDestinationKind,
    destinationLabelKey: stableId(input.destinationLabelKey, `${path}.destinationLabelKey`),
  })
}

const ownerIdentity = (reference: MoveItemReference): string => {
  const owner = reference.owner
  return owner.kind === 'sheet'
    ? `${owner.kind}:${owner.sheetKind}:${owner.slug}`
    : `${owner.kind}:${owner.slug}`
}

/** Logical identity intentionally excludes mutable owner revision and quantity. */
export const moveItemChoiceSelectionKey = (
  selection: MoveItemResponseSelection,
): string => selection.kind === 'move-item-none'
  ? `${selection.kind}:${selection.setId}:${selection.optionId}`
  : [
      selection.kind,
      selection.setId,
      selection.requirementId,
      selection.reference.kind,
      ownerIdentity(selection.reference),
      selection.reference.itemId,
      selection.reference.canonicalItemId,
      selection.destination.kind,
      selection.destination.id,
    ].join(':')

const stableHash = (value: string, seed: number): string => {
  let hash = seed >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Opaque stable ID sent by clients instead of item identity or destination mechanics. */
export const moveItemChoiceSelectionOptionId = (
  selection: MoveItemResponseSelection,
): string => {
  const key = moveItemChoiceSelectionKey(selection)
  return selection.kind === 'move-item-none'
    ? selection.optionId
    : `item.choice.${stableHash(key, 0x811c9dc5)}${stableHash(key, 0x9e3779b9)}`
}

export const moveItemChoicePresentationForSelection = (
  selection: MoveItemResponseSelection,
): MoveItemChoicePresentation => selection.kind === 'move-item-none'
  ? Object.freeze({
      canonicalItemId: null,
      destinationKind: null,
      destinationLabelKey: null,
    })
  : Object.freeze({
      canonicalItemId: selection.reference.canonicalItemId,
      destinationKind: selection.destination.kind,
      destinationLabelKey: selection.destination.labelKey,
    })

export const isMatchingMoveItemChoicePresentation = (
  selection: MoveItemResponseSelection,
  presentation: MoveItemChoicePresentation,
): boolean => {
  const expected = moveItemChoicePresentationForSelection(selection)
  return expected.canonicalItemId === presentation.canonicalItemId
    && expected.destinationKind === presentation.destinationKind
    && expected.destinationLabelKey === presentation.destinationLabelKey
}

/** Bound reused by parsers that need to identify canonical item strings. */
export const MOVE_ITEM_CHOICE_CANONICAL_ITEM_ID_CHARS =
  MOVE_ITEM_REFERENCE_LIMITS.canonicalItemIdChars
