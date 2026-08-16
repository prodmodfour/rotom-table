import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import budgets from '../../data/complete-play-loop/performance-scale-budgets.v1.json'
import {
  parseInventoryActionProjection,
  type InventoryActionOfferV1,
} from '../../shared/itemAutomation/inventoryActions'
import {
  encounterPresentationStableJson,
  parseEncounterPresentationProjection,
  type EncounterActionOffer,
} from '../../shared/encounterPresentation'
import {
  createEmptySheetEquipmentState,
  parseSheetEquipmentStateForOwner,
} from '../../shared/itemAutomation/equipment'
import { itemInventoryInstanceId } from '../../shared/itemAutomation/inventory'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
} from '../../shared/encounterSettlement/document'
import {
  campaignAttentionProjectionSummary,
  parseCampaignAttentionProjection,
} from '../../shared/campaignAttention/projection'
import { createOpenCampaignAttentionItem } from '../../shared/campaignAttention/model'
import type { PersistedRealtimeEvent } from '../../shared/realtimeEventLog'
import {
  equipmentDefinitionFor,
  equipmentDefinitionSha256,
} from '../../server/domain/itemAutomation/equipmentDefinitionRegistry'
import { resolveEquipmentContributions } from '../../server/domain/itemAutomation/equipmentContributions'
import {
  filterRealtimeEventsForPrincipal,
  type RealtimeEventAccessDependencies,
} from '../../server/realtime/realtimeEventAccessPolicy'

const digest = (value: string, length = 32): string => createHash('sha256').update(value).digest('hex').slice(0, length)
const id32 = (index: number): string => index.toString(16).padStart(32, '0')
const id64 = (index: number): string => index.toString(16).padStart(64, '0')
const elapsed = (startedAt: number): number => performance.now() - startedAt

const inventoryOffer = (index: number): InventoryActionOfferV1 => ({
  schemaVersion: 1,
  offerId: `inventory-action-offer:v1:${id32(index)}`,
  action: 'inspect',
  label: `Inspect item ${index}`,
  source: {
    sourceSelectionId: `inventory-source:v1:${id32(index)}`,
    locationKind: 'trainer-inventory',
    containerLabel: 'Scale Pack',
    section: 'medicalKit',
    sectionLabel: 'Medical Kit',
    rowLabel: `Row ${index + 1}`,
    itemLabel: `Item ${index + 1}`,
    canonicalItemId: 'Potion',
    availableQuantity: 1,
    itemForm: 'stack',
  },
  authority: {
    requiredRole: 'player-or-gm',
    checks: [
      { kind: 'authenticated-session', label: 'Signed in', satisfied: true },
      { kind: 'source-control', label: 'Controls source', satisfied: true },
    ],
  },
  revisionRequirements: [{
    requirementId: `inventory-revision:v1:${id32(index)}`,
    resourceKind: 'source-container',
    label: 'Trainer inventory revision',
    expectedRevision: 4,
  }],
  quantity: { mode: 'none', minimum: null, maximum: null, defaultValue: null, unitLabel: null },
  destination: { mode: 'none', allowedKinds: [], rules: [], options: [] },
  consequences: [{ kind: 'none', label: 'No mutation.', reversibility: 'reversible' }],
  confirmation: { mode: 'none', label: null, optionId: null },
  execution: { mode: 'navigation', handoff: 'inspect-navigation', href: '/items/Potion' },
  enabled: true,
  unavailableReason: null,
})

const actionOffer = (index: number): EncounterActionOffer => ({
  schemaVersion: 1,
  offerId: `offer:scale:${index}`,
  mapSlug: 'scale-arena',
  mapRevision: 42,
  actor: {
    participantId: `actor:${index % 64}`,
    displayName: `Participant ${index % 64}`,
    portraitUrl: null,
    sideId: null,
    sideLabel: null,
    sideAccent: null,
    sheetKind: 'pokemon',
    statusLabels: [],
  },
  source: {
    sourceKind: index % 2 ? 'move' : 'ability',
    canonicalId: `Source ${index}`,
    instanceId: index % 2 ? null : `ability:${index}`,
    displayName: `Source ${index}`,
    referenceHref: null,
  },
  roles: ['activated-action'],
  group: index % 2 ? 'attack' : 'support',
  groupOrder: index % 2,
  offerOrder: index,
  timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
  costs: [],
  targeting: [],
  usage: { frequencyLabel: null, remaining: null, maximum: null, cooldownLabel: null, resetLabel: null },
  availability: { status: 'available', reasons: [] },
  presentation: { label: `Source ${index}`, description: null, iconKey: null, tone: 'neutral' },
  intent: { actionId: 'action.declare', input: 'choices' },
})

const equipmentState = (ownerSlug: string) => {
  const base = createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug })
  const items = [
    { canonicalItemId: 'Light Armor', slotId: 'body' as const },
    { canonicalItemId: 'Running Shoes', slotId: 'feet' as const },
  ]
  const instances = items.map((item, index) => {
    const definition = equipmentDefinitionFor(item.canonicalItemId)!
    const rowId = `row-${index}`
    const instanceId = `equipped-item:v1:${digest(`${ownerSlug}:${item.canonicalItemId}`)}`
    return {
      instanceId,
      revision: 1,
      canonicalItemId: item.canonicalItemId,
      canonicalRecordSha256: definition.canonicalRecordSha256,
      equipmentDefinitionSha256: equipmentDefinitionSha256(item.canonicalItemId),
      source: {
        kind: 'inventory' as const,
        containerKind: 'trainer' as const,
        containerSlug: ownerSlug,
        section: 'equipment' as const,
        rowId,
        sourceInstanceId: itemInventoryInstanceId({
          containerKind: 'trainer', containerSlug: ownerSlug, section: 'equipment', rowId,
        }),
        sourceRevision: 1,
        quantity: 1 as const,
      },
      configuration: null,
      serializedState: {},
      activity: { status: 'active' as const, reasons: [] },
      equippedByOperationId: `equipment-operation:v1:${digest(`operation:${ownerSlug}:${index}`)}`,
      equippedAt: 1,
    }
  })
  return parseSheetEquipmentStateForOwner({
    ...base,
    revision: 2,
    slots: base.slots.map(slot => ({
      ...slot,
      instanceId: instances.find((_instance, index) => items[index]!.slotId === slot.slotId)?.instanceId ?? null,
    })),
    instances,
  }, { kind: 'trainer', slug: ownerSlug })
}

const attentionItem = (index: number) => {
  const suffix = id64(index + 1)
  const slug = `trainer-${index.toString().padStart(5, '0')}`
  const authority = { kind: 'sheet' as const, id: slug, revision: 2 }
  return createOpenCampaignAttentionItem({
    itemId: `campaign-attention:v1:${suffix}`,
    reason: 'recovery-review',
    audience: 'owner',
    urgency: 'normal',
    entity: { kind: 'trainer-sheet', id: slug },
    sourceEvent: { kind: 'sheet-authority', eventId: `campaign-attention-source:v1:${suffix}`, campaignMinute: 20 },
    authority,
    requiredDecision: { decisionId: `campaign-attention-decision:v1:${suffix}`, kind: 'review-recovery', authority },
    legalActions: [{
      actionId: `campaign-attention-action:v1:${suffix}`,
      intent: 'review-recovery',
      href: `/sheets/trainers/${slug}?attention=recovery`,
      authority,
      requiresConfirmation: false,
    }],
    createdAtCampaignMinute: 20,
  })
}

const realtimeDependencies: RealtimeEventAccessDependencies = {
  getMap: () => null,
  getSheet: () => null,
  getGroupInventory: () => null,
  getShop: () => null,
  getPendingMoveResolution: () => null,
  listTrainerSheets: () => [],
  playerVisibleMapSheetAccessKeys: () => new Set(),
}

describe('P8-095 Complete Play Loop scale budgets', () => {
  it('strictly parses the maximum 512 unified inventory offers within the lower-end laptop budget', () => {
    const scale = budgets.scenarios.largeInventory.projectionOffers
    const startedAt = performance.now()
    const projection = parseInventoryActionProjection({
      schemaVersion: 1,
      generatedAt: 100,
      offers: Array.from({ length: scale }, (_, index) => inventoryOffer(index + 1)),
    })
    const duration = elapsed(startedAt)
    const bytes = Buffer.byteLength(JSON.stringify(projection))

    expect(projection.offers).toHaveLength(scale)
    expect(duration).toBeLessThan(budgets.scenarios.largeInventory.maximumDurationMs)
    expect(bytes).toBeLessThanOrEqual(budgets.scenarios.largeInventory.maximumProjectionBytes)
  })

  it('resolves more than one thousand equipment provider instances across a large campaign', () => {
    const ownerCount = budgets.scenarios.equipmentProviders.ownerCount
    const startedAt = performance.now()
    let activeProviderCount = 0
    for (let index = 0; index < ownerCount; index += 1) {
      const slug = `trainer-${index}`
      const result = resolveEquipmentContributions({
        equipmentState: equipmentState(slug),
        owner: { kind: 'trainer', slug, speciesId: null, transformed: false },
      })
      activeProviderCount += result.active.length
    }
    const duration = elapsed(startedAt)

    expect(activeProviderCount).toBeGreaterThanOrEqual(budgets.scenarios.equipmentProviders.minimumResolvedContributions)
    expect(duration).toBeLessThan(budgets.scenarios.equipmentProviders.maximumDurationMs)
  })

  it('parses and serializes a dense 512-offer Action Dock projection within bounded payload and latency', () => {
    const count = budgets.scenarios.actionDock.offerCount
    const startedAt = performance.now()
    const projection = parseEncounterPresentationProjection({
      schemaVersion: 1,
      projectionId: 'projection:scale-arena:42:gm',
      audience: 'gm',
      mapSlug: 'scale-arena',
      mapRevision: 42,
      generatedAt: 100,
      offers: Array.from({ length: count }, (_, index) => actionOffer(index)),
      passives: [],
      affordances: [],
      pending: [],
      accepted: [],
      diagnostics: [],
    })
    const bytes = Buffer.byteLength(encounterPresentationStableJson(projection))
    const duration = elapsed(startedAt)

    expect(projection.offers).toHaveLength(count)
    expect(duration).toBeLessThan(budgets.scenarios.actionDock.maximumDurationMs)
    expect(bytes).toBeLessThanOrEqual(budgets.scenarios.actionDock.maximumProjectionBytes)
  })

  it('strictly validates a maximum-size reward package without an unbounded scan', () => {
    const count = budgets.scenarios.rewardPackage.rewardLines
    const base = createEncounterSettlementDocument({
      settlementId: 'settlement:scale',
      rewardPackageId: 'reward-package:scale',
      encounter: {
        encounterId: 'encounter:scale',
        encounterRevision: 12,
        linkedMapSlug: 'map:scale',
        linkedMapRevision: 20,
        campaignMinute: 480,
      },
    })
    const lines = Array.from({ length: count }, (_, index) => ({
      rewardId: `reward:scale:${index}`,
      visibility: 'public' as const,
      sourceAuthority: { kind: 'encounter-document' as const, id: 'encounter:scale', revision: 12 },
      disposition: 'pending' as const,
      payload: { kind: 'money' as const, amount: 1 },
    }))
    const allocations = lines.map((line, index) => ({
      allocationId: `allocation:scale:${index}`,
      rewardId: line.rewardId,
      destination: { kind: 'group' as const, id: 'party:scale', revision: 12 },
      method: 'fixed' as const,
      amount: 1,
      weight: null,
      state: 'proposed' as const,
      decisionId: null,
      receiptId: null,
    }))
    const candidate = {
      ...base,
      rewardPackage: { ...base.rewardPackage, lines },
      allocations,
    }
    const startedAt = performance.now()
    const parsed = parseEncounterSettlementDocument(candidate)
    const duration = elapsed(startedAt)
    const bytes = Buffer.byteLength(JSON.stringify(parsed))

    expect(parsed.rewardPackage.lines).toHaveLength(count)
    expect(parsed.allocations).toHaveLength(count)
    expect(duration).toBeLessThan(budgets.scenarios.rewardPackage.maximumDurationMs)
    expect(bytes).toBeLessThanOrEqual(budgets.scenarios.rewardPackage.maximumDocumentBytes)
  })

  it('strictly validates a complete 10,000-item attention queue within its bounded-read budget', () => {
    const count = budgets.scenarios.attentionQueue.itemCount
    const items = Array.from({ length: count }, (_, index) => attentionItem(index))
    const startedAt = performance.now()
    const projection = parseCampaignAttentionProjection({
      schemaVersion: 1,
      snapshotId: `campaign-attention-snapshot:v1:${'f'.repeat(64)}`,
      scope: 'owner',
      campaignMinute: 30,
      items,
      summary: campaignAttentionProjectionSummary(items),
    })
    const duration = elapsed(startedAt)
    const bytes = Buffer.byteLength(JSON.stringify(projection))

    expect(projection.items).toHaveLength(count)
    expect(duration).toBeLessThan(budgets.scenarios.attentionQueue.maximumDurationMs)
    expect(bytes).toBeLessThanOrEqual(budgets.scenarios.attentionQueue.maximumProjectionBytes)
  })

  it('filters one bounded realtime batch for 32 clients without duplicate delivery growth', () => {
    const eventCount = budgets.scenarios.multiClientRealtime.eventsPerBatch
    const clientCount = budgets.scenarios.multiClientRealtime.clientCount
    const events: PersistedRealtimeEvent[] = Array.from({ length: eventCount }, (_, index) => ({
      sequence: index + 1,
      access: { kind: 'gm-only' },
      event: {
        channel: 'campaign:scale',
        type: 'campaign.updated',
        sequence: index + 1,
        timestamp: index + 1,
        data: { revision: index + 1 },
      },
    }))
    const startedAt = performance.now()
    let delivered = 0
    for (let client = 0; client < clientCount; client += 1) {
      const result = filterRealtimeEventsForPrincipal({
        events,
        principal: { role: 'gm' },
        dependencies: realtimeDependencies,
      })
      expect(result.denied).toHaveLength(0)
      delivered += result.allowed.length
    }
    const duration = elapsed(startedAt)

    expect(delivered).toBe(eventCount * clientCount)
    expect(duration).toBeLessThan(budgets.scenarios.multiClientRealtime.maximumDurationMs)
  })
})
