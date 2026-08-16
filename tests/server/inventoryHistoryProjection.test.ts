import { describe, expect, it } from 'vitest'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { ItemOperationPlanV1 } from '#shared/itemAutomation/operations'
import { projectInventoryHistory } from '../../server/domain/itemAutomation/inventoryHistory'
import type {
  InventoryHistoryItemOperationSource,
  InventoryHistorySourceBatch,
} from '../../server/storage/inventoryHistorySourceRepository'

const internal = 'INTERNAL_OPERATION_ID_MUST_NOT_LEAK'
const profile = (trainerSlug: string): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_abcdefgh' as PlayerProfile['id'],
  displayName: 'Player' as PlayerProfile['displayName'],
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainerSlug }],
})
const plan = (
  operationId: string,
  canonicalItemId = 'Potion',
  receiptFacts: ItemOperationPlanV1['receiptFacts'] = [
    { factId: 'item-used', audience: 'public', label: `${canonicalItemId} was used.` },
    { factId: 'public-result', audience: 'public', label: 'Accepted public result.' },
    { factId: 'owner-result', audience: 'owner', label: 'Accepted owner result.' },
    { factId: 'gm-result', audience: 'gm', label: 'Private GM evidence must stay private.' },
  ],
): ItemOperationPlanV1 => ({
  schemaVersion: 1,
  operationId,
  canonicalItemId,
  canonicalDefinitionSha256: 'a'.repeat(64),
  readSet: [{ kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 2 }],
  operations: [{
    operationId: 'consume', ordinal: 0, kind: 'inventory',
    aggregate: { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 2 },
    subjectId: 'PRIVATE_ROW_ID', payload: { action: 'consume', quantity: 1 },
    label: 'Consume one item',
  }],
  receiptFacts,
})
const acceptedItem = (
  suffix: string,
  updatedAt: number,
  itemPlan = plan(`${internal}_${suffix}`),
): InventoryHistoryItemOperationSource => ({
  record: {
    operationId: `${internal}_${suffix}`,
    commandSha256: 'b'.repeat(64),
    command: {
      actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 2 },
      source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'PRIVATE_ROW_ID', expectedRevision: 2 },
    },
    status: 'accepted', canonicalItemId: itemPlan.canonicalItemId,
    plan: itemPlan,
    result: { status: 'accepted' },
    correctionOfOperationId: null,
    updatedAt,
  },
  guidedRequest: null,
  correctionOrigin: null,
} as unknown as InventoryHistoryItemOperationSource)
const emptySources = (): InventoryHistorySourceBatch => ({
  shopCheckouts: [], inventoryActions: [], equipmentOperations: [],
  itemOperations: [], guidedRequests: [], sourceTruncated: false,
})

describe('inventory history projection', () => {
  it('projects every structured category, orders newest first, deduplicates retries and delegated chains, and strips internal authority', () => {
    const genericItem = acceptedItem('USE', 6_000)
    const guidedRequest = {
      requestId: `${internal}_GUIDED_REQUEST`,
      status: 'accepted', itemOperationId: `${internal}_GUIDED_ITEM`, canonicalItemId: 'Revive',
      result: { acceptedSummary: 'The guided outcome was accepted.' }, updatedAt: 4_000,
    }
    const guidedItem = {
      ...acceptedItem('GUIDED_ITEM', 3_900, plan(`${internal}_GUIDED_ITEM`, 'Revive')),
      guidedRequest,
    } as unknown as InventoryHistoryItemOperationSource
    const correctionOrigin = acceptedItem('ORIGIN', 900).record
    const correction = {
      record: {
        ...acceptedItem('CORRECTION', 1_000).record,
        status: 'corrected', canonicalItemId: 'Potion',
        correctionOfOperationId: correctionOrigin.operationId,
      },
      guidedRequest: null,
      correctionOrigin,
    } as unknown as InventoryHistoryItemOperationSource
    const transfer = {
      status: 'accepted', accepted: {}, updatedAt: 7_000,
      declaration: { operationId: `${internal}_TRANSFER` },
      downstreamCommand: {
        kind: 'transfer-to-group', itemLabel: 'Antidote', quantity: 2,
      },
    }
    const discard = {
      status: 'accepted', accepted: {}, updatedAt: 2_000,
      declaration: { operationId: `${internal}_DISCARD` },
      downstreamCommand: {
        kind: 'inventory-stack-operation', action: 'discard', containerKind: 'trainer', quantity: 1,
        sourceRowBefore: { name: 'Old Rod', id: 'PRIVATE_DISCARD_ROW' },
      },
    }
    const delegatedEquipmentAction = {
      status: 'accepted', accepted: {}, updatedAt: 5_000,
      declaration: { operationId: `${internal}_DELEGATED_EQUIPMENT` },
      downstreamCommand: { kind: 'equipment-operation' },
    }
    const equipment = {
      operationId: `${internal}_EQUIPMENT`, createdAt: 5_000,
      command: {
        commandKind: 'equip',
        source: { kind: 'inventory', containerKind: 'trainer' },
        destination: { kind: 'equipment', ownerKind: 'trainer', slotIds: ['feet'] },
      },
      result: { canonicalItemId: 'Running Shoes', displacedCanonicalItemId: null },
      evidence: { sourceInventoryRow: { id: 'PRIVATE_EQUIPMENT_ROW', name: 'Running Shoes' } },
    }
    const checkout = {
      createdAt: 8_000, opId: `${internal}_CHECKOUT`,
      command: { payload: { deliveryTarget: { kind: 'trainer', slug: 'ash' } } },
      result: {
        ok: true,
        lines: [{ itemName: 'Potion', quantity: 3, lineTotal: 900 }],
      },
    }
    const sources: InventoryHistorySourceBatch = {
      ...emptySources(),
      shopCheckouts: [checkout] as InventoryHistorySourceBatch['shopCheckouts'],
      inventoryActions: [transfer, discard, delegatedEquipmentAction] as InventoryHistorySourceBatch['inventoryActions'],
      equipmentOperations: [equipment] as InventoryHistorySourceBatch['equipmentOperations'],
      // The repeated source represents an idempotent read/retry and must collapse.
      itemOperations: [genericItem, genericItem, guidedItem, correction],
      guidedRequests: [guidedRequest] as InventoryHistorySourceBatch['guidedRequests'],
    }
    const projection = projectInventoryHistory({
      role: 'player', playerProfile: profile('ash'),
      scope: { kind: 'trainer', label: 'Ash inventory' },
      sources,
      settlementAwards: [{
        sourceKey: `${internal}_SETTLEMENT_LINE`,
        occurredAt: 3_000, itemLabel: 'Poké Ball', quantity: 4,
        destinationLabel: 'Trainer inventory', details: ['Encounter reward allocated.'],
      }],
      generatedAt: 9_000,
      limit: 20,
    })

    expect(projection.facts.map(fact => fact.kind)).toEqual([
      'purchase', 'transfer', 'item-use', 'equipment-change',
      'guided-outcome', 'settlement-award', 'discard', 'gm-correction',
    ])
    expect(projection.facts.find(fact => fact.kind === 'guided-outcome')?.details)
      .toContain('The guided outcome was accepted.')
    expect(projection.facts.filter(fact => fact.kind === 'equipment-change')).toHaveLength(1)
    expect(projection.facts.filter(fact => fact.kind === 'item-use')).toHaveLength(1)
    expect(JSON.stringify(projection)).not.toContain(internal)
    expect(JSON.stringify(projection)).not.toMatch(/PRIVATE_(ROW|DISCARD|EQUIPMENT)/u)
    expect(JSON.stringify(projection)).not.toContain('Private GM evidence')
    expect(JSON.stringify(projection)).not.toContain('profile_abcdefgh')
  })

  it('limits shared player history to public receipt audiences and marks bounded truncation', () => {
    const source = acceptedItem('GROUP_USE', 100)
    const projection = projectInventoryHistory({
      role: 'player', playerProfile: profile('misty'),
      scope: { kind: 'group', label: 'Shared inventory' },
      sources: { ...emptySources(), itemOperations: [source], sourceTruncated: true },
      generatedAt: 200,
      limit: 1,
    })
    const serialized = JSON.stringify(projection)
    expect(serialized).toContain('Accepted public result.')
    expect(serialized).not.toContain('Accepted owner result.')
    expect(serialized).not.toContain('Private GM evidence')
    expect(projection.truncated).toBe(true)
  })

  it('fails closed when one source identity produces conflicting facts', () => {
    const first = acceptedItem('CONFLICT', 100)
    const second = acceptedItem('CONFLICT', 101)
    expect(() => projectInventoryHistory({
      role: 'gm', scope: { kind: 'trainer', label: 'Trainer inventory' },
      sources: { ...emptySources(), itemOperations: [first, second] },
      generatedAt: 200, limit: 20,
    })).toThrow('conflicting structured facts')
  })
})
