import { describe, expect, it } from 'vitest'
import {
  MOVE_ITEM_REFERENCE_LIMITS,
  MOVE_ITEM_REFERENCE_SCHEMA_VERSION,
  MoveItemReferenceValidationError,
  parseMoveItemOwnerReference,
  parseMoveItemReference,
  type MoveItemReference,
} from '#shared/moveAutomation/items'

const referenceSources = (): Record<string, any>[] => [
  {
    schemaVersion: MOVE_ITEM_REFERENCE_SCHEMA_VERSION,
    kind: 'pokemon-held',
    itemId: 'held-item-1',
    canonicalItemId: 'bright-powder',
    owner: {
      kind: 'sheet',
      sheetKind: 'pokemon',
      slug: 'partner-pikachu',
      revision: 4,
    },
    quantity: 1,
    stack: 'singleton',
    equip: 'pokemon-held',
  },
  {
    schemaVersion: MOVE_ITEM_REFERENCE_SCHEMA_VERSION,
    kind: 'trainer-equipment-slot',
    itemId: 'equipment-slot.accessory',
    canonicalItemId: 'safety-goggles',
    owner: {
      kind: 'sheet',
      sheetKind: 'trainer',
      slug: 'ace-trainer',
      revision: 9,
    },
    slot: 'accessory',
    quantity: 1,
    stack: 'singleton',
    equip: 'trainer-slot',
  },
  {
    schemaVersion: MOVE_ITEM_REFERENCE_SCHEMA_VERSION,
    kind: 'trainer-inventory-row',
    itemId: 'trainer-row-potion',
    canonicalItemId: 'potion',
    owner: {
      kind: 'sheet',
      sheetKind: 'trainer',
      slug: 'ace-trainer',
      revision: 9,
    },
    section: 'medicalKit',
    quantity: 3,
    stack: 'stackable',
    equip: 'unequipped',
  },
  {
    schemaVersion: MOVE_ITEM_REFERENCE_SCHEMA_VERSION,
    kind: 'group-inventory-row',
    itemId: 'group-item-lava-cookie',
    canonicalItemId: 'lava-cookie',
    owner: {
      kind: 'group-inventory',
      slug: 'main',
      revision: 12,
    },
    section: 'foodStuff',
    quantity: 6,
    stack: 'stackable',
    equip: 'unequipped',
  },
  {
    schemaVersion: MOVE_ITEM_REFERENCE_SCHEMA_VERSION,
    kind: 'map-ground-item',
    itemId: 'ground-item-3',
    canonicalItemId: 'iron-ball',
    owner: {
      kind: 'map',
      slug: 'route-one',
      revision: 18,
    },
    quantity: 2,
    stack: 'stackable',
    equip: 'unequipped',
  },
]

const expectItemError = (
  run: () => unknown,
  code: MoveItemReferenceValidationError['code'],
  path?: string,
): void => {
  try {
    run()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveItemReferenceValidationError)
    expect(error).toMatchObject({ code, ...(path ? { path } : {}) })
  }
}

describe('authoritative move item references', () => {
  it('strictly parses all five stable item locations with owning revisions', () => {
    const sources = referenceSources()
    const references: MoveItemReference[] = sources.map(source => parseMoveItemReference(source))

    expect(references.map(reference => reference.kind)).toEqual([
      'pokemon-held',
      'trainer-equipment-slot',
      'trainer-inventory-row',
      'group-inventory-row',
      'map-ground-item',
    ])
    expect(references.map(reference => reference.owner.revision)).toEqual([4, 9, 9, 12, 18])
    expect(references).toEqual(sources)
    expect(references.every(Object.isFrozen)).toBe(true)
    expect(references.every(reference => Object.isFrozen(reference.owner))).toBe(true)
    expect(structuredClone(references)).toEqual(references)
    expect(JSON.parse(JSON.stringify(references))).toEqual(references)
  })

  it('detaches item and owner identity from mutable parser inputs', () => {
    const source = referenceSources()[2]!
    const parsed = parseMoveItemReference(source)

    source.itemId = 'changed-row'
    source.owner.slug = 'changed-trainer'
    source.owner.revision = 999

    expect(parsed.itemId).toBe('trainer-row-potion')
    expect(parsed.owner).toEqual({
      kind: 'sheet',
      sheetKind: 'trainer',
      slug: 'ace-trainer',
      revision: 9,
    })
    expect(parseMoveItemOwnerReference({
      kind: 'map',
      slug: 'route-one',
      revision: 18,
    })).toEqual({ kind: 'map', slug: 'route-one', revision: 18 })
  })

  it('rejects display-name-only or otherwise unstable mutation identity', () => {
    const displayNameOnly = referenceSources()[0]!
    delete displayNameOnly.itemId
    delete displayNameOnly.canonicalItemId
    displayNameOnly.displayName = 'Bright Powder'
    expectItemError(
      () => parseMoveItemReference(displayNameOnly),
      'invalid-item-reference',
      'moveItemReference',
    )

    const displayNameAlongsideIds = referenceSources()[0]!
    displayNameAlongsideIds.displayName = 'Bright Powder'
    expectItemError(
      () => parseMoveItemReference(displayNameAlongsideIds),
      'invalid-item-reference',
      'moveItemReference',
    )

    const unstableItemId = referenceSources()[0]!
    unstableItemId.itemId = 'Bright Powder'
    expectItemError(
      () => parseMoveItemReference(unstableItemId),
      'invalid-item-reference',
      'moveItemReference.itemId',
    )

    const displayCanonicalId = referenceSources()[0]!
    displayCanonicalId.canonicalItemId = 'Bright Powder'
    expectItemError(
      () => parseMoveItemReference(displayCanonicalId),
      'invalid-item-reference',
      'moveItemReference.canonicalItemId',
    )
  })

  it('requires the reference kind to match its physical owning resource', () => {
    const heldByTrainer = referenceSources()[0]!
    heldByTrainer.owner.sheetKind = 'trainer'
    expectItemError(
      () => parseMoveItemReference(heldByTrainer),
      'inconsistent-item-reference',
      'moveItemReference.owner.sheetKind',
    )

    const trainerRowOnMap = referenceSources()[2]!
    trainerRowOnMap.owner = { kind: 'map', slug: 'route-one', revision: 9 }
    expectItemError(
      () => parseMoveItemReference(trainerRowOnMap),
      'inconsistent-item-reference',
      'moveItemReference.owner',
    )

    const groupRowOnTrainer = referenceSources()[3]!
    groupRowOnTrainer.owner = {
      kind: 'sheet', sheetKind: 'trainer', slug: 'ace-trainer', revision: 12,
    }
    expectItemError(
      () => parseMoveItemReference(groupRowOnTrainer),
      'inconsistent-item-reference',
      'moveItemReference.owner',
    )

    const groundItemInGroup = referenceSources()[4]!
    groundItemInGroup.owner = { kind: 'group-inventory', slug: 'main', revision: 18 }
    expectItemError(
      () => parseMoveItemReference(groundItemInGroup),
      'inconsistent-item-reference',
      'moveItemReference.owner',
    )
  })

  it('enforces quantity, stack, and equip semantics for every location family', () => {
    const stackedHeldItem = referenceSources()[0]!
    stackedHeldItem.quantity = 2
    stackedHeldItem.stack = 'stackable'
    expectItemError(
      () => parseMoveItemReference(stackedHeldItem),
      'inconsistent-item-reference',
      'moveItemReference.stack',
    )

    const unequippedSlot = referenceSources()[1]!
    unequippedSlot.equip = 'unequipped'
    expectItemError(
      () => parseMoveItemReference(unequippedSlot),
      'inconsistent-item-reference',
      'moveItemReference.equip',
    )

    const singletonStack = referenceSources()[4]!
    singletonStack.stack = 'singleton'
    singletonStack.quantity = 2
    expectItemError(
      () => parseMoveItemReference(singletonStack),
      'inconsistent-item-reference',
      'moveItemReference.quantity',
    )

    const stackableEquipmentRow = referenceSources()[2]!
    stackableEquipmentRow.section = 'equipment'
    stackableEquipmentRow.quantity = 1
    expectItemError(
      () => parseMoveItemReference(stackableEquipmentRow),
      'inconsistent-item-reference',
      'moveItemReference.stack',
    )

    const singletonEquipmentRow = referenceSources()[2]!
    singletonEquipmentRow.section = 'equipment'
    singletonEquipmentRow.quantity = 1
    singletonEquipmentRow.stack = 'singleton'
    expect(parseMoveItemReference(singletonEquipmentRow)).toMatchObject({
      section: 'equipment', quantity: 1, stack: 'singleton', equip: 'unequipped',
    })

    const zeroQuantity = referenceSources()[3]!
    zeroQuantity.quantity = 0
    expectItemError(
      () => parseMoveItemReference(zeroQuantity),
      'limit-exceeded',
      'moveItemReference.quantity',
    )

    const excessiveQuantity = referenceSources()[3]!
    excessiveQuantity.quantity = MOVE_ITEM_REFERENCE_LIMITS.quantity + 1
    expectItemError(
      () => parseMoveItemReference(excessiveQuantity),
      'limit-exceeded',
      'moveItemReference.quantity',
    )
  })

  it('rejects unsupported slots, sections, versions, owners, and revisions', () => {
    const badSlot = referenceSources()[1]!
    badSlot.slot = 'belt'
    expectItemError(
      () => parseMoveItemReference(badSlot),
      'invalid-item-reference',
      'moveItemReference.slot',
    )

    const badSection = referenceSources()[2]!
    badSection.section = 'client-bag'
    expectItemError(
      () => parseMoveItemReference(badSection),
      'invalid-item-reference',
      'moveItemReference.section',
    )

    const unsupportedVersion = referenceSources()[0]!
    unsupportedVersion.schemaVersion = 2
    expectItemError(
      () => parseMoveItemReference(unsupportedVersion),
      'unsupported-schema-version',
      'moveItemReference.schemaVersion',
    )

    const badOwnerKind = referenceSources()[4]!
    badOwnerKind.owner.kind = 'client-inventory'
    expectItemError(
      () => parseMoveItemReference(badOwnerKind),
      'unknown-kind',
      'moveItemReference.owner.kind',
    )

    const badRevision = referenceSources()[3]!
    badRevision.owner.revision = -1
    expectItemError(
      () => parseMoveItemReference(badRevision),
      'invalid-item-reference',
      'moveItemReference.owner.revision',
    )

    const badSlug = referenceSources()[3]!
    badSlug.owner.slug = '../private'
    expectItemError(
      () => parseMoveItemReference(badSlug),
      'invalid-item-reference',
      'moveItemReference.owner.slug',
    )
  })

  it('does not execute accessors while rejecting non-data identity fields', () => {
    let accessed = false
    const input = referenceSources()[0]!
    Object.defineProperty(input, 'itemId', {
      enumerable: true,
      get: () => {
        accessed = true
        return 'held-item-1'
      },
    })

    expectItemError(
      () => parseMoveItemReference(input),
      'invalid-item-reference',
      'moveItemReference.itemId',
    )
    expect(accessed).toBe(false)
  })
})
