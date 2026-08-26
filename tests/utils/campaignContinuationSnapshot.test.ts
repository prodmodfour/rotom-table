import { describe, expect, it } from 'vitest'
import {
  applyCampaignContinuationSnapshotResponse,
  beginCampaignContinuationSnapshotRequest,
  createCampaignContinuationSnapshotState,
  resetCampaignContinuationSnapshotContext,
} from '../../src/utils/campaignContinuationSnapshot'

const projection = (fingerprint: string, activeLabel: string) => ({
  schemaVersion: 1,
  snapshotId: `campaign-continuation-snapshot:v1:${fingerprint.repeat(64)}`,
  attention: {
    schemaVersion: 1,
    snapshotId: `campaign-attention-snapshot:v1:${fingerprint.repeat(64)}`,
    scope: 'owner', campaignMinute: 10, items: [],
    summary: { total: 0, blocking: 0, urgent: 0, normal: 0, informational: 0 },
  },
  activeEncounter: { label: activeLabel, state: 'active', round: 1, participantCount: 2, href: '/play/current' },
  additionalActiveEncounters: 0,
  unfinishedSettlement: null,
  additionalUnfinishedSettlements: 0,
  readyPreparation: null,
  additionalReadyPreparations: 0,
  eggs: { active: 0, incubating: 0, ready: 0, needsAdjudication: 0, hatching: 0, href: '/breeding' },
})

describe('campaign continuation complete-snapshot reconciliation', () => {
  it('lets only the latest whole-snapshot request generation replace dashboard state', () => {
    let state = createCampaignContinuationSnapshotState('player:profile-one')
    const first = beginCampaignContinuationSnapshotRequest(state)
    const second = beginCampaignContinuationSnapshotRequest(first.state)
    state = applyCampaignContinuationSnapshotResponse({
      current: second.state,
      contextKey: 'player:profile-one',
      requestGeneration: first.requestGeneration,
      projection: projection('a', 'Stale encounter'),
    })
    expect(state.projection).toBeNull()
    state = applyCampaignContinuationSnapshotResponse({
      current: state,
      contextKey: 'player:profile-one',
      requestGeneration: second.requestGeneration,
      projection: projection('b', 'Current encounter'),
    })
    expect(state.projection?.activeEncounter?.label).toBe('Current encounter')
  })

  it('drops old-Profile responses after context reset instead of merging attention or context rows', () => {
    const begun = beginCampaignContinuationSnapshotRequest(
      createCampaignContinuationSnapshotState('player:profile-one'),
    )
    const reset = resetCampaignContinuationSnapshotContext(begun.state, 'player:profile-two')
    const afterOld = applyCampaignContinuationSnapshotResponse({
      current: reset,
      contextKey: 'player:profile-one',
      requestGeneration: begun.requestGeneration,
      projection: projection('a', 'Private old encounter'),
    })
    expect(afterOld).toBe(reset)
    expect(afterOld.projection).toBeNull()
  })

  it('retains object identity for an equal content-addressed snapshot', () => {
    const begun = beginCampaignContinuationSnapshotRequest(createCampaignContinuationSnapshotState('gm'))
    const accepted = applyCampaignContinuationSnapshotResponse({
      current: begun.state, contextKey: 'gm', requestGeneration: begun.requestGeneration,
      projection: { ...projection('c', 'GM encounter'), attention: { ...projection('c', 'GM encounter').attention, scope: 'gm' } },
    })
    const next = beginCampaignContinuationSnapshotRequest(accepted)
    const equal = applyCampaignContinuationSnapshotResponse({
      current: next.state, contextKey: 'gm', requestGeneration: next.requestGeneration,
      projection: { ...projection('c', 'GM encounter'), attention: { ...projection('c', 'GM encounter').attention, scope: 'gm' } },
    })
    expect(equal.projection).toBe(accepted.projection)
  })
})
