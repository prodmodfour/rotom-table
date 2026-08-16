import { describe, expect, it } from 'vitest'
import { createOpenCampaignAttentionItem, resolveCampaignAttentionItem } from '../../shared/campaignAttention/model'
import {
  campaignAttentionProjectionSummary,
  parseCampaignAttentionProjection,
} from '../../shared/campaignAttention/projection'

const item = (input: {
  id?: string
  audience?: 'gm' | 'owner'
  urgency?: 'blocking' | 'urgent' | 'normal' | 'informational'
  entity?: string
  minute?: number
} = {}) => {
  const authority = { kind: 'sheet' as const, id: input.entity ?? 'ash', revision: 2 }
  const id = input.id ?? 'campaign-attention:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  return createOpenCampaignAttentionItem({
    itemId: id,
    reason: 'recovery-review',
    audience: input.audience ?? 'owner',
    urgency: input.urgency ?? 'normal',
    entity: { kind: 'trainer-sheet', id: input.entity ?? 'ash' },
    sourceEvent: {
      kind: 'sheet-authority',
      eventId: `campaign-attention-source:v1:${id.slice(-64)}`,
      campaignMinute: input.minute ?? 20,
    },
    authority,
    requiredDecision: {
      decisionId: `campaign-attention-decision:v1:${id.slice(-64)}`,
      kind: 'review-recovery',
      authority,
    },
    legalActions: [{
      actionId: `campaign-attention-action:v1:${id.slice(-64)}`,
      intent: 'review-recovery',
      href: `/sheets/trainers/${input.entity ?? 'ash'}?attention=recovery`,
      authority,
      requiresConfirmation: false,
    }],
    createdAtCampaignMinute: input.minute ?? 20,
  })
}

const projection = (items = [item()], scope: 'gm' | 'owner' = 'owner') => ({
  schemaVersion: 1,
  snapshotId: `campaign-attention-snapshot:v1:${'f'.repeat(64)}`,
  scope,
  campaignMinute: 30,
  items,
  summary: campaignAttentionProjectionSummary(items),
})

describe('campaign attention projection contract', () => {
  it('parses a complete deterministic open owner snapshot', () => {
    const parsed = parseCampaignAttentionProjection(projection())
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      scope: 'owner',
      campaignMinute: 30,
      summary: { total: 1, blocking: 0, urgent: 0, normal: 1, informational: 0 },
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.items)).toBe(true)
  })

  it('rejects duplicate, terminal, unordered, future, and GM-only owner rows', () => {
    const first = item({ id: `campaign-attention:v1:${'1'.repeat(64)}`, urgency: 'normal' })
    const blocking = item({ id: `campaign-attention:v1:${'2'.repeat(64)}`, urgency: 'blocking' })
    expect(() => parseCampaignAttentionProjection(projection([first, first]))).toThrow('unique attention identities')
    const terminal = resolveCampaignAttentionItem({
      current: first,
      code: 'completed',
      resolutionEventId: 'campaign-attention-resolution:v1:terminal',
      resolvedAtCampaignMinute: 25,
    })
    expect(() => parseCampaignAttentionProjection(projection([terminal]))).toThrow('only current open attention')
    expect(() => parseCampaignAttentionProjection(projection([first, blocking]))).toThrow('deterministic campaign attention order')
    expect(() => parseCampaignAttentionProjection(projection([
      item({ id: `campaign-attention:v1:${'3'.repeat(64)}`, minute: 31 }),
    ]))).toThrow('future campaign authority')
    expect(() => parseCampaignAttentionProjection(projection([
      item({ id: `campaign-attention:v1:${'4'.repeat(64)}`, audience: 'gm' }),
    ]))).toThrow('may not expose GM attention')
  })

  it('rejects summary drift, unknown fields, malformed snapshots, and overflow', () => {
    expect(() => parseCampaignAttentionProjection({
      ...projection(), summary: { total: 2, blocking: 0, urgent: 0, normal: 1, informational: 0 },
    })).toThrow('must exactly count')
    expect(() => parseCampaignAttentionProjection({ ...projection(), privateProfileId: 'profile_private0001' }))
      .toThrow('must contain exactly')
    expect(() => parseCampaignAttentionProjection({ ...projection(), snapshotId: 'snapshot' }))
      .toThrow('stable v1 snapshot identity')
    expect(() => parseCampaignAttentionProjection({
      ...projection([]), items: Array.from({ length: 10_001 }, () => null),
    })).toThrow('bounded to 10000')
  })
})
