import { isSlug } from '../paths'
import { isRevision } from '../sessionRevisions'
import type { SheetKind } from '~/types/map'
import {
  TRAINER_EQUIPMENT_SLOTS,
  TRAINER_INVENTORY_SECTIONS,
  type TrainerInventoryKey,
} from '~/utils/sheets/trainerInventorySections'

/** Versioned, JSON-only identity for an item consulted by move automation. */
export const MOVE_ITEM_REFERENCE_SCHEMA_VERSION = 1 as const

export const MOVE_ITEM_REFERENCE_KINDS = [
  'pokemon-held',
  'trainer-equipment-slot',
  'trainer-inventory-row',
  'group-inventory-row',
  'map-ground-item',
] as const

export const MOVE_ITEM_OWNER_KINDS = [
  'sheet',
  'group-inventory',
  'map',
] as const

/** A singleton is always quantity one; a stack may be partially mutated. */
export const MOVE_ITEM_STACK_KINDS = ['singleton', 'stackable'] as const

/** Explicit equipment state; display names and inventory sections never imply it. */
export const MOVE_ITEM_EQUIP_KINDS = [
  'pokemon-held',
  'trainer-slot',
  'unequipped',
] as const

export const MOVE_ITEM_TRAINER_EQUIPMENT_SLOTS = Object.freeze(
  TRAINER_EQUIPMENT_SLOTS.map(slot => slot.key),
)

export const MOVE_ITEM_TRAINER_INVENTORY_SECTIONS = Object.freeze(
  TRAINER_INVENTORY_SECTIONS.map(section => section.key),
)

export const MOVE_ITEM_REFERENCE_LIMITS = Object.freeze({
  itemIdChars: 200,
  canonicalItemIdChars: 160,
  resourceSlugChars: 160,
  quantity: Number.MAX_SAFE_INTEGER,
})

export type MoveItemReferenceKind = (typeof MOVE_ITEM_REFERENCE_KINDS)[number]
export type MoveItemOwnerKind = (typeof MOVE_ITEM_OWNER_KINDS)[number]
export type MoveItemStackKind = (typeof MOVE_ITEM_STACK_KINDS)[number]
export type MoveItemEquipKind = (typeof MOVE_ITEM_EQUIP_KINDS)[number]
export type MoveItemTrainerEquipmentSlot =
  (typeof MOVE_ITEM_TRAINER_EQUIPMENT_SLOTS)[number]
export type MoveItemTrainerInventorySection =
  (typeof MOVE_ITEM_TRAINER_INVENTORY_SECTIONS)[number]

interface MoveItemSheetOwnerReferenceBase {
  readonly kind: 'sheet'
  readonly sheetKind: SheetKind
  readonly slug: string
  readonly revision: number
}

export interface MoveItemPokemonSheetOwnerReference
  extends MoveItemSheetOwnerReferenceBase {
  readonly sheetKind: 'pokemon'
}

export interface MoveItemTrainerSheetOwnerReference
  extends MoveItemSheetOwnerReferenceBase {
  readonly sheetKind: 'trainer'
}

export type MoveItemSheetOwnerReference =
  | MoveItemPokemonSheetOwnerReference
  | MoveItemTrainerSheetOwnerReference

export interface MoveItemGroupInventoryOwnerReference {
  readonly kind: 'group-inventory'
  readonly slug: string
  readonly revision: number
}

export interface MoveItemMapOwnerReference {
  readonly kind: 'map'
  readonly slug: string
  readonly revision: number
}

/** The physical document whose revision owns the referenced item location. */
export type MoveItemOwnerReference =
  | MoveItemSheetOwnerReference
  | MoveItemGroupInventoryOwnerReference
  | MoveItemMapOwnerReference

interface MoveItemReferenceBase {
  readonly schemaVersion: typeof MOVE_ITEM_REFERENCE_SCHEMA_VERSION
  readonly kind: MoveItemReferenceKind
  /** Stable identity of this concrete item, slot contents, row, or ground stack within its owner. */
  readonly itemId: string
  /** Stable rules-data identity. Human-readable item names are deliberately absent. */
  readonly canonicalItemId: string
  readonly owner: MoveItemOwnerReference
  /** Current authoritative quantity represented by itemId, not a client-requested mutation amount. */
  readonly quantity: number
  readonly stack: MoveItemStackKind
  readonly equip: MoveItemEquipKind
}

export interface MovePokemonHeldItemReference extends MoveItemReferenceBase {
  readonly kind: 'pokemon-held'
  readonly owner: MoveItemPokemonSheetOwnerReference
  readonly quantity: 1
  readonly stack: 'singleton'
  readonly equip: 'pokemon-held'
}

export interface MoveTrainerEquipmentSlotItemReference extends MoveItemReferenceBase {
  readonly kind: 'trainer-equipment-slot'
  readonly owner: MoveItemTrainerSheetOwnerReference
  readonly slot: MoveItemTrainerEquipmentSlot
  readonly quantity: 1
  readonly stack: 'singleton'
  readonly equip: 'trainer-slot'
}

export interface MoveTrainerInventoryRowItemReference extends MoveItemReferenceBase {
  readonly kind: 'trainer-inventory-row'
  readonly owner: MoveItemTrainerSheetOwnerReference
  readonly section: MoveItemTrainerInventorySection
  readonly equip: 'unequipped'
}

export interface MoveGroupInventoryRowItemReference extends MoveItemReferenceBase {
  readonly kind: 'group-inventory-row'
  readonly owner: MoveItemGroupInventoryOwnerReference
  readonly section: MoveItemTrainerInventorySection
  readonly equip: 'unequipped'
}

export interface MoveMapGroundItemReference extends MoveItemReferenceBase {
  readonly kind: 'map-ground-item'
  readonly owner: MoveItemMapOwnerReference
  readonly equip: 'unequipped'
}

export type MoveItemReference =
  | MovePokemonHeldItemReference
  | MoveTrainerEquipmentSlotItemReference
  | MoveTrainerInventoryRowItemReference
  | MoveGroupInventoryRowItemReference
  | MoveMapGroundItemReference

export type MoveItemReferenceValidationCode =
  | 'invalid-item-reference'
  | 'unsupported-schema-version'
  | 'unknown-kind'
  | 'limit-exceeded'
  | 'inconsistent-item-reference'

export class MoveItemReferenceValidationError extends Error {
  readonly code: MoveItemReferenceValidationCode
  readonly path: string

  constructor(
    code: MoveItemReferenceValidationCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'MoveItemReferenceValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const REFERENCE_BASE_FIELDS = [
  'schemaVersion',
  'kind',
  'itemId',
  'canonicalItemId',
  'owner',
  'quantity',
  'stack',
  'equip',
] as const
const TRAINER_SLOT_REFERENCE_FIELDS = [...REFERENCE_BASE_FIELDS, 'slot'] as const
const INVENTORY_ROW_REFERENCE_FIELDS = [...REFERENCE_BASE_FIELDS, 'section'] as const
const SHEET_OWNER_FIELDS = ['kind', 'sheetKind', 'slug', 'revision'] as const
const RESOURCE_OWNER_FIELDS = ['kind', 'slug', 'revision'] as const

const REFERENCE_KIND_SET = new Set<unknown>(MOVE_ITEM_REFERENCE_KINDS)
const OWNER_KIND_SET = new Set<unknown>(MOVE_ITEM_OWNER_KINDS)
const STACK_KIND_SET = new Set<unknown>(MOVE_ITEM_STACK_KINDS)
const EQUIP_KIND_SET = new Set<unknown>(MOVE_ITEM_EQUIP_KINDS)
const EQUIPMENT_SLOT_SET = new Set<unknown>(MOVE_ITEM_TRAINER_EQUIPMENT_SLOTS)
const INVENTORY_SECTION_SET = new Set<unknown>(MOVE_ITEM_TRAINER_INVENTORY_SECTIONS)
const STABLE_ITEM_ID_PATTERN = /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/
const CANONICAL_ITEM_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const fail = (
  code: MoveItemReferenceValidationCode,
  path: string,
  message: string,
): never => {
  throw new MoveItemReferenceValidationError(code, path, message)
}

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Detach an untrusted record without invoking accessors or retaining mutable
 * caller-owned properties. Item references intentionally contain only scalar
 * fields plus one similarly parsed owner record.
 */
const detachRecord = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainRecord(value)) {
    return fail('invalid-item-reference', path, 'must be a plain object.')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('invalid-item-reference', path, 'symbol properties are not allowed.')
  }

  const detached: UnknownRecord = Object.create(null) as UnknownRecord
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      fail(
        'invalid-item-reference',
        `${path}.${key}`,
        'fields must be enumerable data properties.',
      )
    }
    const dataDescriptor = descriptor as PropertyDescriptor & { value: unknown }
    Object.defineProperty(detached, key, {
      value: dataDescriptor.value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return detached
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
    'invalid-item-reference',
    path,
    `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`,
  )
}

const parseStableId = (
  value: unknown,
  path: string,
  options: {
    readonly maximumChars: number
    readonly canonical?: boolean
  },
): string => {
  const pattern = options.canonical ? CANONICAL_ITEM_ID_PATTERN : STABLE_ITEM_ID_PATTERN
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > options.maximumChars
    || value.trim() !== value
    || CONTROL_CHARACTER_PATTERN.test(value)
    || !pattern.test(value)
  ) {
    return fail(
      'invalid-item-reference',
      path,
      options.canonical
        ? 'must be a lowercase bounded canonical item identifier.'
        : 'must be a bounded stable item identifier.',
    )
  }
  return value
}

const parseResourceSlug = (value: unknown, path: string): string => {
  if (
    typeof value !== 'string'
    || value.length > MOVE_ITEM_REFERENCE_LIMITS.resourceSlugChars
    || !isSlug(value)
  ) {
    return fail('invalid-item-reference', path, 'must be a bounded resource slug.')
  }
  return value
}

const parseResourceRevision = (value: unknown, path: string): number => {
  if (!isRevision(value)) {
    return fail('invalid-item-reference', path, 'must be a safe non-negative revision.')
  }
  return value
}

/** Strictly parse one physical item-owner identity and its observed revision. */
export const parseMoveItemOwnerReference = (
  value: unknown,
  path = 'moveItemOwner',
): MoveItemOwnerReference => {
  const owner = detachRecord(value, path)
  if (!OWNER_KIND_SET.has(owner.kind)) {
    return fail('unknown-kind', `${path}.kind`, 'must be a supported item owner kind.')
  }

  if (owner.kind === 'sheet') {
    assertExactFields(owner, SHEET_OWNER_FIELDS, path)
    if (owner.sheetKind !== 'pokemon' && owner.sheetKind !== 'trainer') {
      fail('invalid-item-reference', `${path}.sheetKind`, 'must be pokemon or trainer.')
    }
    return Object.freeze({
      kind: 'sheet',
      sheetKind: owner.sheetKind,
      slug: parseResourceSlug(owner.slug, `${path}.slug`),
      revision: parseResourceRevision(owner.revision, `${path}.revision`),
    }) as MoveItemSheetOwnerReference
  }

  assertExactFields(owner, RESOURCE_OWNER_FIELDS, path)
  const common = {
    slug: parseResourceSlug(owner.slug, `${path}.slug`),
    revision: parseResourceRevision(owner.revision, `${path}.revision`),
  }
  return owner.kind === 'group-inventory'
    ? Object.freeze({ kind: 'group-inventory' as const, ...common })
    : Object.freeze({ kind: 'map' as const, ...common })
}

const parseQuantity = (value: unknown, path: string): number => {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 1
    || Number(value) > MOVE_ITEM_REFERENCE_LIMITS.quantity
  ) {
    return fail(
      'limit-exceeded',
      path,
      `must be a safe integer from 1 through ${MOVE_ITEM_REFERENCE_LIMITS.quantity}.`,
    )
  }
  return Number(value)
}

const assertOwner = (
  owner: MoveItemOwnerReference,
  expectedKind: MoveItemOwnerKind,
  expectedSheetKind: SheetKind | null,
  path: string,
): void => {
  if (owner.kind !== expectedKind) {
    fail(
      'inconsistent-item-reference',
      path,
      `must be owned by a ${expectedKind} resource for this reference kind.`,
    )
  }
  if (
    expectedKind === 'sheet'
    && owner.kind === 'sheet'
    && owner.sheetKind !== expectedSheetKind
  ) {
    fail(
      'inconsistent-item-reference',
      `${path}.sheetKind`,
      `must be ${expectedSheetKind} for this reference kind.`,
    )
  }
}

const assertSemantics = (input: {
  readonly kind: MoveItemReferenceKind
  readonly quantity: number
  readonly stack: MoveItemStackKind
  readonly equip: MoveItemEquipKind
  readonly section?: MoveItemTrainerInventorySection
  readonly path: string
}): void => {
  if (input.stack === 'singleton' && input.quantity !== 1) {
    fail(
      'inconsistent-item-reference',
      `${input.path}.quantity`,
      'must be 1 for singleton item identity.',
    )
  }

  const expectedEquip: MoveItemEquipKind = input.kind === 'pokemon-held'
    ? 'pokemon-held'
    : input.kind === 'trainer-equipment-slot'
      ? 'trainer-slot'
      : 'unequipped'
  if (input.equip !== expectedEquip) {
    fail(
      'inconsistent-item-reference',
      `${input.path}.equip`,
      `must be ${expectedEquip} for ${input.kind}.`,
    )
  }

  const equipped = input.kind === 'pokemon-held' || input.kind === 'trainer-equipment-slot'
  if (equipped && (input.stack !== 'singleton' || input.quantity !== 1)) {
    fail(
      'inconsistent-item-reference',
      `${input.path}.stack`,
      'equipped item identity must be one singleton.',
    )
  }

  if (input.section !== undefined) {
    const expectedStack: MoveItemStackKind = input.section === 'equipment'
      ? 'singleton'
      : 'stackable'
    if (input.stack !== expectedStack) {
      fail(
        'inconsistent-item-reference',
        `${input.path}.stack`,
        `${input.section} inventory rows must use ${expectedStack} semantics.`,
      )
    }
  }
}

/**
 * Strictly parse one authoritative item reference.
 *
 * The contract has no display-name field: mutation identity is always the
 * stable item ID plus an exact owning document and observed revision.
 */
export const parseMoveItemReference = (
  value: unknown,
  path = 'moveItemReference',
): MoveItemReference => {
  const reference = detachRecord(value, path)
  if (!REFERENCE_KIND_SET.has(reference.kind)) {
    return fail('unknown-kind', `${path}.kind`, 'must be a supported item reference kind.')
  }

  const kind = reference.kind as MoveItemReferenceKind
  const fields = kind === 'trainer-equipment-slot'
    ? TRAINER_SLOT_REFERENCE_FIELDS
    : kind === 'trainer-inventory-row' || kind === 'group-inventory-row'
      ? INVENTORY_ROW_REFERENCE_FIELDS
      : REFERENCE_BASE_FIELDS
  assertExactFields(reference, fields, path)

  if (reference.schemaVersion !== MOVE_ITEM_REFERENCE_SCHEMA_VERSION) {
    fail(
      'unsupported-schema-version',
      `${path}.schemaVersion`,
      `must be ${MOVE_ITEM_REFERENCE_SCHEMA_VERSION}.`,
    )
  }

  const common = {
    schemaVersion: MOVE_ITEM_REFERENCE_SCHEMA_VERSION,
    itemId: parseStableId(reference.itemId, `${path}.itemId`, {
      maximumChars: MOVE_ITEM_REFERENCE_LIMITS.itemIdChars,
    }),
    canonicalItemId: parseStableId(reference.canonicalItemId, `${path}.canonicalItemId`, {
      maximumChars: MOVE_ITEM_REFERENCE_LIMITS.canonicalItemIdChars,
      canonical: true,
    }),
    owner: parseMoveItemOwnerReference(reference.owner, `${path}.owner`),
    quantity: parseQuantity(reference.quantity, `${path}.quantity`),
  }

  if (!STACK_KIND_SET.has(reference.stack)) {
    fail('unknown-kind', `${path}.stack`, 'must be singleton or stackable.')
  }
  if (!EQUIP_KIND_SET.has(reference.equip)) {
    fail('unknown-kind', `${path}.equip`, 'must be a supported item equip kind.')
  }
  const stack = reference.stack as MoveItemStackKind
  const equip = reference.equip as MoveItemEquipKind

  if (kind === 'pokemon-held') {
    assertOwner(common.owner, 'sheet', 'pokemon', `${path}.owner`)
    assertSemantics({ kind, quantity: common.quantity, stack, equip, path })
    return Object.freeze({
      ...common,
      kind,
      owner: common.owner as MoveItemPokemonSheetOwnerReference,
      quantity: 1,
      stack: 'singleton',
      equip: 'pokemon-held',
    })
  }

  if (kind === 'trainer-equipment-slot') {
    assertOwner(common.owner, 'sheet', 'trainer', `${path}.owner`)
    if (!EQUIPMENT_SLOT_SET.has(reference.slot)) {
      fail('invalid-item-reference', `${path}.slot`, 'must be a supported trainer equipment slot.')
    }
    assertSemantics({ kind, quantity: common.quantity, stack, equip, path })
    return Object.freeze({
      ...common,
      kind,
      owner: common.owner as MoveItemTrainerSheetOwnerReference,
      slot: reference.slot as MoveItemTrainerEquipmentSlot,
      quantity: 1,
      stack: 'singleton',
      equip: 'trainer-slot',
    })
  }

  if (kind === 'trainer-inventory-row' || kind === 'group-inventory-row') {
    if (!INVENTORY_SECTION_SET.has(reference.section)) {
      fail('invalid-item-reference', `${path}.section`, 'must be a supported inventory section.')
    }
    const section = reference.section as TrainerInventoryKey
    assertOwner(
      common.owner,
      kind === 'trainer-inventory-row' ? 'sheet' : 'group-inventory',
      kind === 'trainer-inventory-row' ? 'trainer' : null,
      `${path}.owner`,
    )
    assertSemantics({ kind, quantity: common.quantity, stack, equip, section, path })

    return kind === 'trainer-inventory-row'
      ? Object.freeze({
          ...common,
          kind,
          owner: common.owner as MoveItemTrainerSheetOwnerReference,
          section,
          stack,
          equip: 'unequipped' as const,
        })
      : Object.freeze({
          ...common,
          kind,
          owner: common.owner as MoveItemGroupInventoryOwnerReference,
          section,
          stack,
          equip: 'unequipped' as const,
        })
  }

  assertOwner(common.owner, 'map', null, `${path}.owner`)
  assertSemantics({ kind, quantity: common.quantity, stack, equip, path })
  return Object.freeze({
    ...common,
    kind,
    owner: common.owner as MoveItemMapOwnerReference,
    stack,
    equip: 'unequipped',
  })
}
