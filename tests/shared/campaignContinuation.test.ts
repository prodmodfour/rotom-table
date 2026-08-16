import { describe, expect, it } from 'vitest'
import { parseCampaignContinuationProjection } from '../../shared/campaignContinuation'

const valid = () => ({
  schemaVersion: 1,
  snapshotId: `campaign-continuation-snapshot:v1:${'a'.repeat(64)}`,
  attention: {
    schemaVersion: 1,
    snapshotId: `campaign-attention-snapshot:v1:${'b'.repeat(64)}`,
    scope: 'gm',
    campaignMinute: 42,
    items: [],
    summary: { total: 0, blocking: 0, urgent: 0, normal: 0, informational: 0 },
  },
  activeEncounter: {
    label: 'Harbor duel', state: 'active', round: 3, participantCount: 4, href: '/play/harbor-duel',
  },
  additionalActiveEncounters: 0,
  unfinishedSettlement: {
    label: 'Harbor duel', state: 'needs-review', openWorkCount: 2, href: '/play/harbor-duel',
  },
  additionalUnfinishedSettlements: 0,
  eggs: { active: 2, incubating: 1, ready: 1, needsAdjudication: 0, hatching: 0, href: '/breeding' },
})

describe('campaign continuation projection contract', () => {
  it('accepts one exact privacy-safe complete dashboard snapshot', () => {
    const parsed = parseCampaignContinuationProjection(valid())
    expect(parsed.activeEncounter?.label).toBe('Harbor duel')
    expect(parsed.unfinishedSettlement?.openWorkCount).toBe(2)
    expect(parsed.eggs.active).toBe(2)
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it('rejects unknown fields, external routes, malformed snapshot identities, and divergent Egg totals', () => {
    expect(() => parseCampaignContinuationProjection({ ...valid(), operationId: 'private' })).toThrow('must contain exactly')
    expect(() => parseCampaignContinuationProjection({
      ...valid(),
      activeEncounter: { ...valid().activeEncounter, href: 'https://example.test/private' },
    })).toThrow('app-relative route')
    expect(() => parseCampaignContinuationProjection({ ...valid(), snapshotId: 'dashboard:1' })).toThrow('stable v1 continuation identity')
    expect(() => parseCampaignContinuationProjection({
      ...valid(),
      eggs: { ...valid().eggs, active: 3 },
    })).toThrow('must exactly count active Egg states')
  })

  it('keeps owner settlement gate counts nullable instead of inventing private detail', () => {
    const input = valid()
    const parsed = parseCampaignContinuationProjection({
      ...input,
      attention: { ...input.attention, scope: 'owner' },
      unfinishedSettlement: { ...input.unfinishedSettlement, openWorkCount: null },
    })
    expect(parsed.attention.scope).toBe('owner')
    expect(parsed.unfinishedSettlement?.openWorkCount).toBeNull()
  })
})
