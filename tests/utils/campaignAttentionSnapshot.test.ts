import { describe, expect, it } from 'vitest'
import { createOpenCampaignAttentionItem } from '../../shared/campaignAttention/model'
import { campaignAttentionProjectionSummary } from '../../shared/campaignAttention/projection'
import {
  applyCampaignAttentionSnapshotResponse,
  beginCampaignAttentionSnapshotRequest,
  createCampaignAttentionSnapshotState,
  resetCampaignAttentionSnapshotContext,
} from '../../src/utils/campaignAttentionSnapshot'

const projection = (suffix: string) => {
  const authority = { kind: 'sheet' as const, id: 'ash', revision: 1 }
  const items = [createOpenCampaignAttentionItem({
    itemId: `campaign-attention:v1:${suffix.repeat(64).slice(0, 64)}`,
    reason: 'recovery-review', audience: 'owner', urgency: 'normal',
    entity: { kind: 'trainer-sheet', id: 'ash' },
    sourceEvent: {
      kind: 'sheet-authority',
      eventId: `campaign-attention-source:v1:${suffix.repeat(64).slice(0, 64)}`,
      campaignMinute: 10,
    },
    authority,
    requiredDecision: {
      decisionId: `campaign-attention-decision:v1:${suffix.repeat(64).slice(0, 64)}`,
      kind: 'review-recovery', authority,
    },
    legalActions: [{
      actionId: `campaign-attention-action:v1:${suffix.repeat(64).slice(0, 64)}`,
      intent: 'review-recovery', href: '/sheets/trainers/ash', authority,
      requiresConfirmation: false,
    }],
    createdAtCampaignMinute: 10,
  })]
  return {
    schemaVersion: 1,
    snapshotId: `campaign-attention-snapshot:v1:${suffix.repeat(64).slice(0, 64)}`,
    scope: 'owner',
    campaignMinute: 10,
    items,
    summary: campaignAttentionProjectionSummary(items),
  }
}

describe('campaign attention snapshot reconciliation', () => {
  it('atomically replaces a complete latest response instead of merging local rows', () => {
    const initial = createCampaignAttentionSnapshotState('player:profile_ash00001')
    const first = beginCampaignAttentionSnapshotRequest(initial)
    const applied = applyCampaignAttentionSnapshotResponse({
      current: first.state,
      contextKey: first.state.contextKey,
      requestGeneration: first.requestGeneration,
      projection: projection('a'),
    })
    expect(applied.projection?.items).toHaveLength(1)

    const second = beginCampaignAttentionSnapshotRequest(applied)
    const empty = {
      ...projection('b'), items: [], summary: {
        total: 0, blocking: 0, urgent: 0, normal: 0, informational: 0,
      },
    }
    const cleared = applyCampaignAttentionSnapshotResponse({
      current: second.state,
      contextKey: second.state.contextKey,
      requestGeneration: second.requestGeneration,
      projection: empty,
    })
    expect(cleared.projection?.items).toEqual([])
    expect(cleared.appliedRequestGeneration).toBe(2)
  })

  it('ignores out-of-order and old-principal responses', () => {
    const initial = createCampaignAttentionSnapshotState('player:profile_ash00001')
    const first = beginCampaignAttentionSnapshotRequest(initial)
    const second = beginCampaignAttentionSnapshotRequest(first.state)
    expect(applyCampaignAttentionSnapshotResponse({
      current: second.state,
      contextKey: second.state.contextKey,
      requestGeneration: first.requestGeneration,
      projection: projection('a'),
    })).toBe(second.state)
    expect(applyCampaignAttentionSnapshotResponse({
      current: second.state,
      contextKey: 'player:profile_misty002',
      requestGeneration: second.requestGeneration,
      projection: projection('b'),
    })).toBe(second.state)
  })

  it('preserves a byte-equivalent accepted snapshot and resets all state on principal change', () => {
    const request = beginCampaignAttentionSnapshotRequest(
      createCampaignAttentionSnapshotState('gm'),
    )
    const applied = applyCampaignAttentionSnapshotResponse({
      current: request.state,
      contextKey: 'gm',
      requestGeneration: request.requestGeneration,
      projection: { ...projection('a'), scope: 'gm' },
    })
    const repeat = beginCampaignAttentionSnapshotRequest(applied)
    const repeated = applyCampaignAttentionSnapshotResponse({
      current: repeat.state,
      contextKey: 'gm',
      requestGeneration: repeat.requestGeneration,
      projection: { ...projection('a'), scope: 'gm' },
    })
    expect(repeated.projection).toBe(applied.projection)
    expect(resetCampaignAttentionSnapshotContext(repeated, 'gm')).toBe(repeated)
    expect(resetCampaignAttentionSnapshotContext(repeated, 'player:profile_ash00001')).toEqual({
      contextKey: 'player:profile_ash00001',
      latestRequestGeneration: 0,
      appliedRequestGeneration: 0,
      projection: null,
    })
  })
})
