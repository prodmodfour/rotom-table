import { describe, expect, it } from 'vitest'
import {
  campaignAttentionItemFromSettlementSource,
  campaignAttentionItemsFromSettlementSources,
} from '../../server/domain/campaignAttention/settlementProvider'
import type { StoredEncounterSettlementAttentionSource } from '../../server/storage/encounterSettlementRepository'

const source = (
  reason: StoredEncounterSettlementAttentionSource['reason'] = 'level-threshold',
  overrides: Partial<StoredEncounterSettlementAttentionSource> = {},
): StoredEncounterSettlementAttentionSource => ({
  sourceId: `settlement-attention:v1:${reason}`,
  settlementId: 'settlement-duel',
  operationId: 'finish-operation-0001',
  reason,
  audience: 'owner',
  entityKind: 'pokemon-sheet',
  entityId: 'sprig',
  sourceFactId: `settlement-fact:v1:${reason}`,
  authority: { kind: 'sheet', id: 'sprig', revision: 5 },
  status: 'open',
  revision: 0,
  createdAtCampaignMinute: 500,
  resolvedAtCampaignMinute: null,
  resolutionOperationId: null,
  ...overrides,
})

describe('settlement campaign-attention provider', () => {
  it.each([
    ['level-threshold', 'normal', 'allocate-advancement', 'review-advancement'],
    ['advancement-review', 'normal', 'allocate-advancement', 'review-advancement'],
    ['capture-review', 'normal', 'review-capture', 'review-capture'],
    ['medical-review', 'urgent', 'choose-treatment', 'start-treatment'],
    ['equipment-review', 'normal', 'repair-equipment', 'review-equipment'],
    ['continuation-review', 'informational', 'review-continuation', 'continue-campaign'],
  ] as const)('maps %s without copying mutable character state', (reason, urgency, decision, action) => {
    const item = campaignAttentionItemFromSettlementSource(source(reason))
    expect(item).toMatchObject({
      reason,
      audience: 'owner',
      urgency,
      entity: { kind: 'pokemon-sheet', id: 'sprig' },
      sourceEvent: {
        kind: 'encounter-settlement',
        eventId: `settlement-fact:v1:${reason}`,
        campaignMinute: 500,
      },
      authority: { kind: 'sheet', id: 'sprig', revision: 5 },
      requiredDecision: { kind: decision, authority: { kind: 'sheet', id: 'sprig', revision: 5 } },
      legalActions: [{
        intent: action,
        href: '/sheets/pokemon/sprig',
        authority: { kind: 'sheet', id: 'sprig', revision: 5 },
      }],
      resolution: { state: 'open', revision: 0 },
    })
    expect(JSON.stringify(item)).not.toContain('settlement-duel')
    expect(JSON.stringify(item)).not.toContain('finish-operation-0001')
    expect(Object.keys(item)).toEqual([
      'schemaVersion', 'itemId', 'reason', 'audience', 'urgency', 'entity',
      'sourceEvent', 'authority', 'requiredDecision', 'legalActions',
      'resolution', 'createdAtCampaignMinute',
    ])
  })

  it('preserves exact authority kinds and creates stable identities and app-relative sheet destinations', () => {
    const input = source('equipment-review', {
      entityKind: 'trainer-sheet',
      entityId: 'ash/trainer',
      authority: { kind: 'equipment-operation', id: 'equipment-operation-0001', revision: 2 },
    })
    const first = campaignAttentionItemFromSettlementSource(input)
    const second = campaignAttentionItemFromSettlementSource(input)
    expect(first).toEqual(second)
    expect(first.itemId).toMatch(/^campaign-attention:v1:[a-f0-9]{64}$/)
    expect(first.authority).toEqual({ kind: 'equipment-operation', id: 'equipment-operation-0001', revision: 2 })
    expect(first.legalActions[0]?.href).toBe('/sheets/trainers/ash%2Ftrainer')
  })

  it('projects complete terminal resolution evidence without making another mutable copy', () => {
    const item = campaignAttentionItemFromSettlementSource(source('capture-review', {
      status: 'resolved',
      revision: 3,
      resolvedAtCampaignMinute: 530,
      resolutionOperationId: 'capture-resolution-0001',
    }))
    expect(item.resolution).toEqual({
      state: 'resolved', revision: 3, code: 'completed',
      resolutionEventId: 'capture-resolution-0001', resolvedAtCampaignMinute: 530,
    })
  })

  it('orders urgent work first and rejects duplicate or malformed settlement source evidence', () => {
    const items = campaignAttentionItemsFromSettlementSources([
      source('continuation-review', { sourceId: 'attention-continuation-0001' }),
      source('medical-review', { sourceId: 'attention-medical-0001' }),
      source('capture-review', { sourceId: 'attention-capture-0001' }),
    ])
    expect(items.map(item => item.reason)).toEqual([
      'medical-review', 'capture-review', 'continuation-review',
    ])
    expect(Object.isFrozen(items)).toBe(true)

    const duplicate = source('level-threshold')
    expect(() => campaignAttentionItemsFromSettlementSources([duplicate, duplicate]))
      .toThrow('unique campaign attention identities')
    expect(() => campaignAttentionItemFromSettlementSource(source('medical-review', {
      status: 'resolved', revision: 1,
    }))).toThrow('missing complete resolution evidence')
    expect(() => campaignAttentionItemFromSettlementSource(source('medical-review', {
      revision: 1,
    }))).toThrow('Open settlement attention source contains terminal resolution evidence')
  })
})
