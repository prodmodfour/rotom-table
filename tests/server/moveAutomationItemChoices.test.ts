import { describe, expect, it } from 'vitest'
import {
  moveItemChoiceSelectionOptionId,
  parseMoveItemChoiceDeclaration,
  parseMoveItemChoicePresentation,
  parseMoveItemResponseSelection,
} from '#shared/moveAutomation/itemChoices'
import type { MoveItemReference } from '#shared/moveAutomation/items'
import {
  createAuthoritativeMoveItemResourceQueries,
  type AuthoritativeMoveItemResources,
} from '~~/server/domain/moveAutomation/itemResources'
import {
  AuthoritativeMoveItemChoiceError,
  enumerateAuthoritativeMoveItemChoices,
  revalidateAuthoritativeMoveItemChoice,
} from '~~/server/domain/moveAutomation/itemChoices'

const reference = (input: {
  readonly itemId: string
  readonly canonicalItemId: string
  readonly quantity: number
  readonly revision?: number
}): MoveItemReference => ({
  schemaVersion: 1,
  kind: 'trainer-inventory-row',
  itemId: input.itemId,
  canonicalItemId: input.canonicalItemId,
  owner: {
    kind: 'sheet',
    sheetKind: 'trainer',
    slug: 'item-choice-owner',
    revision: input.revision ?? 4,
  },
  section: 'medicalKit',
  quantity: input.quantity,
  stack: 'stackable',
  equip: 'unequipped',
})

const resources = (
  references: readonly MoveItemReference[],
): AuthoritativeMoveItemResources => ({
  requirements: [{
    id: 'test.legal-items',
    source: { kind: 'actor-trainer-inventory', sections: ['medicalKit'] },
  }],
  candidates: references.map(item => ({
    requirementId: 'test.legal-items',
    reference: item,
  })),
  sheetReads: [{ kind: 'trainer', slug: 'item-choice-owner', revision: 4 }],
  groupInventoryReads: [],
  groupInventories: new Map(),
  consumedItems: [],
})

const declaration = () => ({
  setId: 'test.item-set',
  requirementId: 'test.legal-items',
  owner: 'recipients',
  emptyPolicy: 'reject',
  filter: {
    referenceKinds: ['trainer-inventory-row'],
    canonicalItemIds: ['potion', 'antidote'],
    trainerEquipmentSlots: null,
    minimumQuantity: 2,
  },
  destinations: [
    { id: 'use.actor', kind: 'actor-inventory', labelKey: 'move.item.destination.actor' },
    { id: 'give.target', kind: 'target-held', labelKey: 'move.item.destination.target' },
  ],
  noneOption: { id: 'item.none.reviewed', labelKey: 'move.item.none' },
} as const)

describe('authoritative durable item choices', () => {
  it('strictly parses reviewed filters, destinations, and explicit-none identity', () => {
    const parsed = parseMoveItemChoiceDeclaration(declaration())
    expect(parsed).toEqual(declaration())
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.destinations)).toBe(true)

    expect(() => parseMoveItemChoiceDeclaration({
      ...declaration(),
      clientDestination: { kind: 'map-ground', x: 1, z: 2 },
    })).toThrowError(expect.objectContaining({ code: 'invalid-item-choice' }))
    expect(() => parseMoveItemChoiceDeclaration({
      ...declaration(),
      filter: { ...declaration().filter, referenceKinds: ['private-sheet'] },
    })).toThrowError(expect.objectContaining({ code: 'invalid-item-choice' }))
    expect(() => parseMoveItemChoiceDeclaration({
      ...declaration(),
      owner: 'client',
    })).toThrowError(expect.objectContaining({ code: 'invalid-item-choice' }))
    expect(() => parseMoveItemChoiceDeclaration({
      ...declaration(),
      filter: {
        ...declaration().filter,
        trainerEquipmentSlots: ['accessory'],
      },
    })).toThrowError(expect.objectContaining({ code: 'inconsistent-item-choice' }))
    expect(() => parseMoveItemChoiceDeclaration({
      ...declaration(),
      filter: {
        ...declaration().filter,
        referenceKinds: ['trainer-equipment-slot'],
        trainerEquipmentSlots: ['backpack'],
      },
    })).toThrowError(expect.objectContaining({ code: 'invalid-item-choice' }))
  })

  it('offers only filtered authoritative references in deterministic destination order', () => {
    const itemResources = resources([
      reference({ itemId: 'row-potion', canonicalItemId: 'potion', quantity: 3 }),
      reference({ itemId: 'row-antidote', canonicalItemId: 'antidote', quantity: 1 }),
      reference({ itemId: 'row-ether', canonicalItemId: 'ether', quantity: 9 }),
    ])
    const set = enumerateAuthoritativeMoveItemChoices({
      declaration: declaration(),
      items: createAuthoritativeMoveItemResourceQueries(itemResources),
    })

    expect(set.choices).toHaveLength(3)
    expect(set.choices.map(choice => ({
      id: choice.option.id,
      item: choice.reference?.canonicalItemId ?? null,
      destination: choice.destination?.id ?? null,
    }))).toEqual([
      {
        id: expect.stringMatching(/^item\.choice\.[a-f0-9]{16}$/),
        item: 'potion',
        destination: 'use.actor',
      },
      {
        id: expect.stringMatching(/^item\.choice\.[a-f0-9]{16}$/),
        item: 'potion',
        destination: 'give.target',
      },
      { id: 'item.none.reviewed', item: null, destination: null },
    ])
    expect(set.choices[0]?.option.itemChoice).toEqual({
      canonicalItemId: 'potion',
      destinationKind: 'actor-inventory',
      destinationLabelKey: 'move.item.destination.actor',
    })
    expect(Object.isFrozen(set)).toBe(true)
    expect(Object.isFrozen(set.choices[0]?.option.itemSelection)).toBe(true)
  })

  it('revalidates the opaque option against a fresh item snapshot and keeps IDs revision-stable', () => {
    const initial = enumerateAuthoritativeMoveItemChoices({
      declaration: declaration(),
      items: createAuthoritativeMoveItemResourceQueries(resources([
        reference({ itemId: 'row-potion', canonicalItemId: 'potion', quantity: 3 }),
      ])),
    })
    const option = initial.choices[0]!.option
    const selection = parseMoveItemResponseSelection(option.itemSelection)
    expect(moveItemChoiceSelectionOptionId(selection)).toBe(option.id)
    expect(parseMoveItemChoicePresentation(option.itemChoice)).toEqual(option.itemChoice)

    const freshReference = reference({
      itemId: 'row-potion',
      canonicalItemId: 'potion',
      quantity: 3,
      revision: 5,
    })
    const fresh = revalidateAuthoritativeMoveItemChoice({
      declaration: declaration(),
      items: createAuthoritativeMoveItemResourceQueries({
        ...resources([freshReference]),
        sheetReads: [{ kind: 'trainer', slug: 'item-choice-owner', revision: 5 }],
      }),
      optionId: option.id,
    })
    expect(fresh.option.id).toBe(option.id)
    expect(fresh.reference?.owner.revision).toBe(5)

    expect(() => revalidateAuthoritativeMoveItemChoice({
      declaration: declaration(),
      items: createAuthoritativeMoveItemResourceQueries(resources([])),
      optionId: option.id,
    })).toThrowError(expect.objectContaining({
      name: AuthoritativeMoveItemChoiceError.name,
      code: 'item-choice-option-unknown',
    }))
  })
})
