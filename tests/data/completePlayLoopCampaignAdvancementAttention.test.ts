import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/campaign-advancement-attention.v1.json'
import rules from '../../data/reference/rules.json'
import {
  CAMPAIGN_ADVANCEMENT_ATTENTION_SHEET_LIMIT,
} from '../../server/domain/campaignAttention/advancementDetector'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-084 campaign advancement attention evidence', () => {
  it('pins complete bounded current authority and only app-owned canonical advancement data', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P8-084', status: 'implemented' })
    expect(contract.limits).toEqual({
      sheets: CAMPAIGN_ADVANCEMENT_ATTENTION_SHEET_LIMIT,
      settlementSources: CAMPAIGN_ADVANCEMENT_ATTENTION_SHEET_LIMIT,
      projectedItems: CAMPAIGN_ADVANCEMENT_ATTENTION_SHEET_LIMIT,
    })
    expect(contract.authorities).toEqual({
      pokemonExperience: 'data/reference/pokemonExperienceChart.json',
      statPointRules: 'data/reference/rules.json',
      pokemonSpecies: 'data/reference/pokedex.json',
      settlementLevelEvents: 'encounter_settlement_attention_sources linked to immutable settlement history facts',
      sheetRead: ['kind', 'slug', 'revision', 'document'],
      campaignMinuteRequired: true,
    })
    expect(rules['Stat Point Advancement'].statPointFormulas).toMatchObject({
      pokemonAdded: { kind: 'levelOffset', offset: 10, minLevel: 1, maxLevel: 100 },
      trainerLevelUp: { kind: 'levelOffset', offset: 9, minLevel: 1, maxLevel: 50 },
    })
  })

  it('records event-backed thresholds, unspent points, and invalid advancement without writes or guesses', () => {
    expect(contract.detections.levelThreshold).toEqual({
      reason: 'level-threshold',
      urgencyWhenSheetIsBehindExperience: 'blocking',
      decisionWhenSheetIsBehindExperience: 'repair-advancement',
      eventBackedSettlementUrgency: 'normal',
      eventBackedSettlementDecision: 'allocate-advancement',
      automaticallyChangesLevel: false,
      guessesSpecificNewChoice: false,
    })
    expect(contract.detections.unspentAdvancement).toMatchObject({
      reason: 'unspent-advancement', urgency: 'normal', decision: 'allocate-advancement',
      pokemonSpentFields: 'stats.*.added',
      trainerSpentFields: 'stats.*.levelUp',
      copiesBudgetOrRemainingAmount: false,
    })
    expect(contract.detections.invalidAdvancement).toMatchObject({
      reason: 'invalid-advancement', urgency: 'blocking', decision: 'repair-advancement',
      normalizesInvalidValues: false,
    })
    expect(contract.detections.invalidAdvancement.causes).toEqual(expect.arrayContaining([
      'unsupported-species-authority', 'invalid-level', 'invalid-experience',
      'experience-below-level', 'malformed-or-negative-stat-points',
      'arithmetic-overflow', 'stat-point-overspend', 'base-relation-violation',
      'unavailable-canonical-calculation',
    ]))
  })

  it('forbids every irreversible build choice and mutable advancement snapshot', () => {
    expect(contract.noAutomaticBuildChoices).toEqual([
      'stat-allocation', 'move', 'ability', 'evolution',
      'feature', 'edge', 'class', 'skill-rank',
    ])
    expect(contract.doesNotCopy).toEqual(expect.arrayContaining([
      'experience-total', 'level', 'species-data', 'stats', 'budget',
      'spent-amount', 'remaining-amount', 'sheet-name', 'private-notes',
      'profile-evidence', 'operation-command',
    ]))
    expect(contract.identity).toMatchObject({
      itemStableAcrossUnrelatedSheetRevisions: true,
      sourceEventChangesWithSheetRevision: true,
      decisionAndActionBindExactSheetRevision: true,
      deterministicOrder: ['urgency', 'entityKind', 'entityId', 'itemId'],
      duplicateAuthorityFailsClosed: true,
      truncatedAuthorityFailsClosed: true,
    })
  })

  it('pins detector, canonical data, source integration, tests, and documentation byte-for-byte', () => {
    for (const source of Object.values(contract.sources)) {
      expect(source.sha256, source.path).toMatch(/^[a-f0-9]{64}$/)
      expect(sha256(source.path), source.path).toBe(source.sha256)
    }
  })
})
