import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/campaign-continuation-dashboard.v1.json'
import { CAMPAIGN_CONTINUATION_SCHEMA_VERSION } from '../../shared/campaignContinuation'
import { CAMPAIGN_CONTINUATION_LIMIT } from '../../server/useCases/loadCampaignContinuation'
import { isLocalUiArtifactPath, readOptionalLocalUiArtifact } from '../helpers/localUiArtifacts'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

describe('P8-090 campaign continuation dashboard evidence', () => {
  it('pins one strict role/Profile-aware whole-dashboard endpoint', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P8-090', status: 'implemented' })
    expect(CAMPAIGN_CONTINUATION_SCHEMA_VERSION).toBe(1)
    expect(contract.endpoint).toEqual({
      method: 'GET', path: '/api/campaign/continuation',
      requiresAuthenticatedRole: true,
      acceptedQueryFields: ['profileId'],
      resolvesSelectedProfileOnServer: true,
      returnsWholeContentAddressedSnapshot: true,
    })
    expect(contract.authority).toMatchObject({
      recordLimitPerCollection: CAMPAIGN_CONTINUATION_LIMIT,
      singleSqliteTransaction: true,
      attentionUsesOneCompleteAuthoritySnapshot: true,
      settlementRequiresVisibleEncounterAuthority: true,
      playerEggsRequireDirectLinkedTrainerAuthority: true,
      playerSettlementGateCountProjected: false,
      duplicateCurrentIdentityFails: true,
    })
  })

  it('pins the continuation-first hierarchy and all required attention groups', () => {
    expect(contract.hierarchy).toEqual([
      'active-encounter-resumption', 'unfinished-settlement-resumption',
      'highest-priority-recommended-action', 'grouped-attention',
      'open-work-summary', 'gm-next-day-secondary-tool', 'gm-guided-item-queue',
    ])
    expect(contract.attentionGroups).toEqual([
      'needs-a-decision', 'recovery-and-care', 'growth-and-training',
      'team-captures-and-eggs', 'equipment',
    ])
    expect(contract.design).toMatchObject({
      context: 'workshop', selectedMockupScore: '10/10',
      desktopWorkToRailRatio: '2:1', singleNotchedRecommendation: true,
      redEmphasisReservedForRecommendedRoute: true, nextDayIsSecondary: true,
      minimumControlPixels: 44, mobileMinimumWidthPixels: 320,
    })
  })

  it('pins player Campaign access while keeping campaign-day and adjudication tools GM-only', () => {
    expect(contract.roleAccess).toEqual({
      campaignPageAvailableToGm: true,
      campaignPageAvailableToPlayer: true,
      playerWithoutProfileGetsSafeEmptyOwnerProjection: true,
      nextDayToolGmOnly: true,
      guidedAdjudicationGmOnly: true,
    })
    expect(contract.projectionPrivacy).toMatchObject({
      profileIdentityRendered: false,
      profileDisplayNameRendered: false,
      eggIdentityRendered: false,
      settlementIdentityRendered: false,
      operationOrRequestIdentityRendered: false,
      attentionActionDecisionOrSourceIdentityRendered: false,
      hashOrProvenanceRendered: false,
      privateCanonicalChoicesRendered: false,
      serverIssuedAppRelativeHandoffsOnly: true,
    })
  })

  it('pins latest-principal whole-snapshot replacement and fail-closed recovery', () => {
    expect(contract.realtime).toMatchObject({
      strategy: 'whole-dashboard-snapshot-reload',
      localRowOrCounterMerge: false,
      latestRequestGenerationWins: true,
      principalContextChangeClearsSnapshot: true,
      oldProfileResponseIgnored: true,
      equalSnapshotRetainsIdentity: true,
      burstReloadsCoalesced: true,
      reconnectReplayOrReconcileReloads: true,
      failedRefreshRetainsLastCompleteSnapshot: true,
    })
    expect(contract.failClosed).toEqual(expect.arrayContaining([
      'unknown-projection-field', 'external-route', 'divergent-egg-state-total',
      'authority-overflow', 'duplicate-authority-identity',
      'settlement-without-visible-encounter', 'selected-profile-drift',
      'role-scope-mismatch', 'out-of-order-response', 'old-principal-response',
    ]))
  })

  it('pins every runtime, test, document, and local UI artifact reference', () => {
    for (const source of Object.values(contract.sources)) {
      expect(source.sha256, source.path).toMatch(/^[a-f0-9]{64}$/)
      const bytes = isLocalUiArtifactPath(source.path)
        ? readOptionalLocalUiArtifact(process.cwd(), source.path)
        : readFileSync(source.path)
      if (bytes) expect(sha256(bytes), source.path).toBe(source.sha256)
    }
  })
})
