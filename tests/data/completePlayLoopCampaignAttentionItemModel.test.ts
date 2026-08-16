import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/campaign-attention-item-model.v1.json'
import {
  CAMPAIGN_ATTENTION_AUDIENCES,
  CAMPAIGN_ATTENTION_ITEM_SCHEMA_VERSION,
  CAMPAIGN_ATTENTION_LIMITS,
  CAMPAIGN_ATTENTION_RESOLUTION_STATES,
  CAMPAIGN_ATTENTION_URGENCIES,
} from '../../shared/campaignAttention/model'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-083 campaign attention-item evidence', () => {
  it('pins the strict authority-linked schema and bounded lifecycle', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P8-083', status: 'implemented' })
    expect(contract.model.schemaVersion).toBe(CAMPAIGN_ATTENTION_ITEM_SCHEMA_VERSION)
    expect(contract.model.fields).toEqual([
      'itemId', 'reason', 'audience', 'urgency', 'entity', 'sourceEvent',
      'authority', 'requiredDecision', 'legalActions', 'resolution',
      'createdAtCampaignMinute',
    ])
    expect(contract.model.audiences).toEqual(CAMPAIGN_ATTENTION_AUDIENCES)
    expect(contract.model.urgencies).toEqual(CAMPAIGN_ATTENTION_URGENCIES)
    expect(contract.model.resolutionStates).toEqual(CAMPAIGN_ATTENTION_RESOLUTION_STATES)
    expect(contract.model.maximumLegalActions).toBe(CAMPAIGN_ATTENTION_LIMITS.actions)
    expect(contract.model.maximumProjectedSettlementSources).toBe(10_000)
    expect(contract.model.authorityPointer).toEqual(['kind', 'id', 'revision'])
    expect(contract.model).toMatchObject({
      copiesMutableCharacterData: false,
      exactParser: true,
      deeplyFrozen: true,
    })
  })

  it('records fail-closed action, chronology, terminal, uniqueness, and reauthorization invariants', () => {
    expect(contract.invariants).toEqual(expect.arrayContaining([
      expect.stringContaining('open item has at least one'),
      expect.stringContaining('app-relative'),
      expect.stringContaining('clear required decisions and legal actions'),
      expect.stringContaining('non-retroactive campaign minute'),
      expect.stringContaining('freeform presentation copy fail closed'),
      expect.stringContaining('Duplicate item and action identities'),
      expect.stringContaining('reload and reauthorize authority'),
    ]))
  })

  it('adapts immutable settlement attention sources without a duplicate ledger or private snapshots', () => {
    expect(contract.settlementProvider).toMatchObject({
      sourceTable: 'encounter_settlement_attention_sources',
      introducesDuplicatePersistence: false,
      preservesExactAuthorityKind: true,
      deterministicOrder: ['urgency', 'createdAtCampaignMinute', 'itemId'],
    })
    expect(contract.settlementProvider.identity).toContain('SHA-256')
    expect(contract.settlementProvider.sourceEvent).toContain('immutable settlement history fact')
    expect(contract.settlementProvider.doesNotCopy).toEqual(expect.arrayContaining([
      'settlementId', 'finishOperationId', 'characterName', 'level', 'hp',
      'injuries', 'conditions', 'inventory', 'profileEvidence', 'privatePlan', 'sourceJson',
    ]))
    expect(contract.settlementProvider.reasonPolicies).toEqual({
      'level-threshold': ['normal', 'allocate-advancement', 'review-advancement'],
      'advancement-review': ['normal', 'allocate-advancement', 'review-advancement'],
      'capture-review': ['normal', 'review-capture', 'review-capture'],
      'medical-review': ['urgent', 'choose-treatment', 'start-treatment'],
      'equipment-review': ['normal', 'repair-equipment', 'review-equipment'],
      'continuation-review': ['informational', 'review-continuation', 'continue-campaign'],
    })
  })

  it('pins every model, provider, source, test, and operator document byte-for-byte', () => {
    for (const source of Object.values(contract.sources)) {
      expect(source.sha256, source.path).toMatch(/^[a-f0-9]{64}$/)
      expect(sha256(source.path), source.path).toBe(source.sha256)
    }
  })
})
