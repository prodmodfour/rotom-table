import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/campaign-attention-projection.v1.json'
import {
  CAMPAIGN_ATTENTION_PROJECTION_LIMIT,
  CAMPAIGN_ATTENTION_PROJECTION_SCHEMA_VERSION,
} from '../../shared/campaignAttention/projection'
import {
  CAMPAIGN_ATTENTION_INVALIDATION_SCHEMA_VERSION,
} from '../../server/realtime/campaignAttentionRealtime'
import { CAMPAIGN_ATTENTION_AUTHORITY_READ_LIMIT } from '../../server/useCases/loadCampaignAttention'
import {
  CAMPAIGN_ATTENTION_REALTIME_EVENT_TYPES,
  campaignAttentionChannel,
} from '../../shared/realtime'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

describe('P8-089 role- and Profile-projected attention evidence', () => {
  it('pins one complete bounded authority loader and detector merge', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P8-089', status: 'implemented' })
    expect(contract.endpoint).toEqual({
      method: 'GET', path: '/api/campaign/attention',
      requiresAuthenticatedRole: true,
      resolvesSelectedProfileOnServer: true,
      returnsCompleteSnapshot: true,
    })
    expect(contract.authority).toMatchObject({
      singleSqliteTransaction: true,
      recordLimitPerCollection: CAMPAIGN_ATTENTION_AUTHORITY_READ_LIMIT,
      strictOwningRepositoryHydration: true,
      duplicateIdentityFails: true,
      missingIdentityFails: true,
      changedSelectedProfileFails: true,
      partialProjectionForbidden: true,
    })
    expect(contract.providers).toEqual([
      'settlement-source', 'advancement', 'pokemon-choice', 'trainer-choice',
      'recovery', 'roster-ownership-equipment',
    ])
    expect(contract.mergePolicy).toMatchObject({
      maximumItems: CAMPAIGN_ATTENTION_PROJECTION_LIMIT,
      byteEqualDuplicateCollapsed: true,
      divergentDuplicateFails: true,
      decisionAuthorityMustMatchItem: true,
      actionAuthorityMustMatchItem: true,
    })
  })

  it('pins structured campaign relevance without treating every encounter sheet as owned work', () => {
    expect(contract.relevance.structuredSeeds).toEqual([
      'profile-link', 'player-sheet-flag', 'trainer-roster',
      'settlement-attention-source', 'immutable-capture-fact',
      'pokemon-egg', 'breeding-origin',
    ])
    expect(contract.relevance).toMatchObject({
      transitiveRosterClosure: true,
      namesOrFoldersAuthorize: false,
      unownedWildOrNpcSheetCreatesWork: false,
    })
  })

  it('pins strict GM and selected-Profile projection privacy', () => {
    expect(contract.projection).toMatchObject({
      schemaVersion: CAMPAIGN_ATTENTION_PROJECTION_SCHEMA_VERSION,
      onlyOpenItems: true,
      contentAddressedSnapshot: true,
      exactUrgencySummary: true,
      gm: 'all-open-gm-and-owner-items',
      player: 'owner-items-for-exact-selected-profile-authority',
      playerWithoutProfile: 'empty-valid-owner-snapshot',
      publicOrMapVisibilityGrantsOwnership: false,
      malformedRosterGrantsIndirectAccess: false,
      profileIdentityProjected: false,
      profileDisplayNameProjected: false,
      profileAuthorityIncludedOnlyAsOneWaySnapshotInput: true,
    })
    expect(contract.failClosed).toEqual(expect.arrayContaining([
      'terminal-row-in-active-snapshot', 'gm-item-in-owner-scope',
      'divergent-provider-identity', 'divergent-action-authority',
      'partial-authority-read', 'selected-profile-drift',
      'out-of-order-response', 'old-principal-response',
    ]))
  })

  it('pins snapshot replacement and payload-minimal realtime invalidation', () => {
    expect(contract.realtime).toEqual({
      strategy: 'complete-snapshot-reload',
      localItemMerge: false,
      localTombstones: false,
      latestRequestGenerationWins: true,
      principalContextChangeResetsState: true,
      equalSnapshotCannotDuplicate: true,
      sheetEventsInvalidate: true,
      channel: campaignAttentionChannel,
      eventType: CAMPAIGN_ATTENTION_REALTIME_EVENT_TYPES.INVALIDATED,
      profileUpdateAudiences: ['gm-only', 'exact-player-profile-access'],
      accessDescriptorOnWire: false,
      payloadContainsProfileIdentity: false,
      reconnectReloadsSnapshot: true,
    })
    expect(CAMPAIGN_ATTENTION_INVALIDATION_SCHEMA_VERSION).toBe(1)
  })

  it('pins every runtime, provider, test, and documentation source', () => {
    for (const source of Object.values(contract.sources)) {
      expect(source.sha256, source.path).toMatch(/^[a-f0-9]{64}$/)
      expect(acceptedSuccessorHead(source.path, source.sha256), source.path)
        .toBe(repositoryFileSha256(source.path))
    }
  })
})
