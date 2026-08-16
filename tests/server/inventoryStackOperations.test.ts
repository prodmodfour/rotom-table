import { describe, expect, it } from 'vitest'
import type { InventoryActionRevisionRequirementV1 } from '#shared/itemAutomation/inventoryActions'
import type { InventoryEntry } from '~/types/trainerSheet'
import {
  applyInventoryStackOperation,
  parseInventoryActionStackOperationCommand,
  type InventoryActionStackOperationCommandV1,
} from '../../server/domain/itemAutomation/inventoryStackOperations'
import { projectInventoryStackActionOffers } from '../../server/domain/itemAutomation/inventoryStackActionOffers'

const sourceRevision: InventoryActionRevisionRequirementV1 = {
  requirementId: `inventory-revision:v1:${'a'.repeat(32)}`,
  resourceKind: 'source-container',
  label: 'Trainer inventory revision',
  expectedRevision: 4,
}

const command = (overrides: Partial<InventoryActionStackOperationCommandV1> = {}): InventoryActionStackOperationCommandV1 => ({
  schemaVersion: 1,
  kind: 'inventory-stack-operation',
  action: 'split',
  containerKind: 'trainer',
  containerSlug: 'ash',
  expectedRevision: 4,
  section: 'medicalKit',
  sourceRowId: 'potion-source',
  sourceRowBefore: {
    id: 'potion-source',
    name: 'Potion',
    qty: 5,
    cost: '$200',
    description: 'Canonical restorative stack.',
  },
  destinationRowId: null,
  destinationRowBefore: null,
  splitRowId: 'potion-split',
  quantity: 2,
  ...overrides,
})

const serializedEquipment = {
  schemaVersion: 1 as const,
  instanceId: `equipped-item:v1:${'1'.repeat(32)}`,
  revision: 2,
  canonicalItemId: 'Light Armor',
  canonicalRecordSha256: 'b'.repeat(64),
  equipmentDefinitionSha256: 'c'.repeat(64),
  configuration: null,
  activity: { status: 'active' as const, reasons: [] },
  state: { durability: 5 },
}

describe('authoritative inventory stack operations', () => {
  it('splits one exact bounded quantity while retaining source identity and all stack metadata', () => {
    const input = {
      medicalKit: [{
        id: 'potion-source', name: 'Potion', qty: 5, cost: '$200',
        description: 'Canonical restorative stack.',
      }],
    }
    const applied = applyInventoryStackOperation({
      inventory: input,
      command: command(),
      reservedSourceQuantity: 1,
    })

    expect(applied).toMatchObject({
      sourceQuantityBefore: 5,
      sourceQuantityAfter: 3,
      splitRowId: 'potion-split',
    })
    expect(applied.inventory.medicalKit).toEqual([
      {
        id: 'potion-source', name: 'Potion', qty: 3, cost: '$200',
        description: 'Canonical restorative stack.',
      },
      {
        id: 'potion-split', name: 'Potion', qty: 2, cost: '$200',
        description: 'Canonical restorative stack.',
      },
    ])
    expect(input.medicalKit[0]).toMatchObject({ id: 'potion-source', qty: 5 })
  })

  it('merges only equal stack metadata, retains the selected destination identity, and rejects overflow', () => {
    const source: InventoryEntry = { id: 'potion-source', name: 'Potion', qty: 2, cost: '$200', mod: 'A' }
    const destination: InventoryEntry = { id: 'potion-target', name: 'Potion', qty: 3, cost: '$200', mod: 'A' }
    const mergeCommand = command({
      action: 'merge',
      sourceRowBefore: source,
      destinationRowId: 'potion-target',
      destinationRowBefore: destination,
      splitRowId: null,
      quantity: 2,
    })
    const applied = applyInventoryStackOperation({
      inventory: { medicalKit: [source, destination] },
      command: mergeCommand,
      reservedSourceQuantity: 0,
    })
    expect(applied).toMatchObject({
      sourceQuantityAfter: 0,
      destinationQuantityBefore: 3,
      destinationQuantityAfter: 5,
    })
    expect(applied.inventory.medicalKit).toEqual([
      { id: 'potion-target', name: 'Potion', qty: 5, cost: '$200', mod: 'A' },
    ])

    expect(() => parseInventoryActionStackOperationCommand({
      ...mergeCommand,
      destinationRowBefore: { ...destination, mod: 'B' },
    })).toThrow('does not bind one exact compatible destination stack')

    const overflowDestination = { ...destination, qty: Number.MAX_SAFE_INTEGER }
    expect(() => applyInventoryStackOperation({
      inventory: { medicalKit: [{ ...source, qty: 1 }, overflowDestination] },
      command: {
        ...mergeCommand,
        sourceRowBefore: { ...source, qty: 1 },
        destinationRowBefore: overflowDestination,
        quantity: 1,
      },
      reservedSourceQuantity: 0,
    })).toThrow('Merged inventory quantity exceeds the maximum safe integer')
  })

  it('fails closed on stale evidence, duplicate split identity, or any change that would spend a reservation', () => {
    expect(() => applyInventoryStackOperation({
      inventory: { medicalKit: [{ id: 'potion-source', name: 'Potion', qty: 4, cost: '$200', description: 'Canonical restorative stack.' }] },
      command: command(),
      reservedSourceQuantity: 0,
    })).toThrow('Inventory stack source changed after declaration')

    expect(() => applyInventoryStackOperation({
      inventory: {
        medicalKit: [
          { id: 'potion-source', name: 'Potion', qty: 5, cost: '$200', description: 'Canonical restorative stack.' },
          { id: 'potion-split', name: 'Antidote', qty: 1 },
        ],
      },
      command: command(),
      reservedSourceQuantity: 0,
    })).toThrow('Inventory split row identity is unavailable or duplicated')

    expect(() => applyInventoryStackOperation({
      inventory: { medicalKit: [{ id: 'potion-source', name: 'Potion', qty: 5, cost: '$200', description: 'Canonical restorative stack.' }] },
      command: command({ quantity: 3 }),
      reservedSourceQuantity: 3,
    })).toThrow('does not have enough unreserved quantity')
  })

  it('allows exact whole-item discard but never split or merge for serialized equipment', () => {
    const row: InventoryEntry = { id: 'armor-row', name: 'Light Armor', serializedEquipment }
    const discard = command({
      action: 'discard',
      section: 'equipment',
      sourceRowId: 'armor-row',
      sourceRowBefore: row,
      splitRowId: null,
      quantity: 1,
    })
    const applied = applyInventoryStackOperation({
      inventory: { equipment: [row] },
      command: discard,
      reservedSourceQuantity: 0,
    })
    expect(applied.inventory.equipment).toEqual([])
    expect(discard.sourceRowBefore.serializedEquipment).toEqual(serializedEquipment)

    expect(() => parseInventoryActionStackOperationCommand({
      ...discard,
      action: 'split',
      splitRowId: 'armor-split',
    })).toThrow('does not preserve one source unit and one new stack identity')
    expect(() => parseInventoryActionStackOperationCommand({ ...discard, quantity: 2 }))
      .toThrow('exceeds its exact source')
  })

  it('projects revision-bound split, merge, and destructive confirmation with reservation-aware bounds', () => {
    const rows: InventoryEntry[] = [
      { id: 'potion-source', name: 'Potion', qty: 5, cost: '$200' },
      { id: 'potion-target', name: 'Potion', qty: 2, cost: '$200' },
      { id: 'different-metadata', name: 'Potion', qty: 4, cost: '$300' },
    ]
    const projected = projectInventoryStackActionOffers({
      containerKind: 'trainer',
      containerSlug: 'ash',
      containerRevision: 4,
      locationKind: 'trainer-inventory',
      containerLabel: 'Trainer inventory',
      section: 'medicalKit',
      sectionLabel: 'Medical Kit',
      rows,
      row: rows[0]!,
      rowIndex: 0,
      sourceSelectionId: `inventory-source:v1:${'d'.repeat(32)}`,
      canonicalItemId: 'Potion',
      stableSource: true,
      reservedQuantity: 2,
      canManage: true,
      requiredRole: 'player-or-gm',
      sourceRevisionRequirement: sourceRevision,
    }).map(binding => binding.offer)

    expect(projected.map(offer => offer.action)).toEqual(['split', 'merge', 'discard'])
    expect(projected.find(offer => offer.action === 'split')).toMatchObject({
      enabled: true,
      quantity: { minimum: 1, maximum: 3 },
      destination: { mode: 'server-determined', options: [] },
    })
    expect(projected.find(offer => offer.action === 'merge')).toMatchObject({
      enabled: false,
      unavailableReason: { code: 'stack.reserved' },
      destination: { mode: 'required', options: [{ label: 'Medical Kit · Row 2 · Potion' }] },
    })
    expect(projected.find(offer => offer.action === 'discard')).toMatchObject({
      enabled: true,
      quantity: { minimum: 1, maximum: 3 },
      destination: { mode: 'none', options: [] },
      consequences: [{ kind: 'discard', reversibility: 'irreversible' }],
      confirmation: { mode: 'explicit-choice', optionId: expect.stringMatching(/^inventory-confirmation:v1:/u) },
      execution: { handoff: 'inventory-stack-operation' },
    })
    expect(JSON.stringify(projected)).not.toMatch(/potion-source|potion-target|different-metadata/u)
  })

  it('projects shared stack management as GM-only without hiding its reason from players', () => {
    const row: InventoryEntry = { id: 'potion-source', name: 'Potion', qty: 3 }
    const projected = projectInventoryStackActionOffers({
      containerKind: 'group',
      containerSlug: 'main',
      containerRevision: 2,
      locationKind: 'group-inventory',
      containerLabel: 'Group inventory',
      section: 'medicalKit',
      sectionLabel: 'Medical Kit',
      rows: [row],
      row,
      rowIndex: 0,
      sourceSelectionId: `inventory-source:v1:${'e'.repeat(32)}`,
      canonicalItemId: 'Potion',
      stableSource: true,
      reservedQuantity: 0,
      canManage: false,
      requiredRole: 'gm',
      sourceRevisionRequirement: { ...sourceRevision, expectedRevision: 2 },
    }).map(binding => binding.offer)

    expect(projected).toHaveLength(3)
    expect(projected.every(offer => !offer.enabled)).toBe(true)
    expect(projected.every(offer => offer.authority.requiredRole === 'gm')).toBe(true)
    expect(projected.every(offer => offer.unavailableReason?.label.includes('Only a GM'))).toBe(true)
  })
})
