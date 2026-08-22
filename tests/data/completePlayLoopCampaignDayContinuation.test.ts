import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/campaign-day-continuation.v1.json'
import {
  CAMPAIGN_DAY_PREFLIGHT_AFFECTED_SHEET_LIMIT,
  CAMPAIGN_DAY_PREFLIGHT_BLOCKER_LIMIT,
  CAMPAIGN_DAY_PREFLIGHT_SCHEMA_VERSION,
} from '../../shared/campaignDayPreflight'
import { CAMPAIGN_DAY_PREFLIGHT_AUTHORITY_LIMIT } from '../../server/domain/campaignDay/preflightAuthority'
import { isLocalUiArtifactPath, readOptionalLocalUiArtifact } from '../helpers/localUiArtifacts'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

describe('P8-091 campaign-day continuation evidence', () => {
  it('pins strict GM-only preflight and reviewed commit boundaries', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P8-091', status: 'implemented' })
    expect(CAMPAIGN_DAY_PREFLIGHT_SCHEMA_VERSION).toBe(1)
    expect(contract.endpoints).toEqual({
      preflight: {
        method: 'POST', path: '/api/campaign/next-day/preflight', gmOnly: true,
        exactCommandFields: ['schemaVersion', 'operationId', 'kind', 'days'],
      },
      commit: {
        method: 'POST', path: '/api/campaign/next-day', gmOnly: true,
        exactCommandFields: ['schemaVersion', 'operationId', 'kind', 'days', 'preflightId', 'clientId'],
      },
    })
    expect(contract.authority).toMatchObject({
      collectionLimit: CAMPAIGN_DAY_PREFLIGHT_AUTHORITY_LIMIT,
      affectedSheetLimit: CAMPAIGN_DAY_PREFLIGHT_AFFECTED_SHEET_LIMIT,
      blockerLimit: CAMPAIGN_DAY_PREFLIGHT_BLOCKER_LIMIT,
      productionUseCaseRunsInsideSavepoint: true,
      dryRunPublishesRealtime: false,
      dryRunLeavesDurableWrites: false,
      commitRevalidatesInsideWriteTransaction: true,
      atomicRecoveryClockEggEffectAndOperationCommit: true,
    })
  })

  it('pins authoritative blocker and typed impact coverage', () => {
    expect(contract.blockers).toEqual([
      'active-encounter', 'unfinished-settlement', 'blocking-campaign-attention',
    ])
    expect(contract.impact).toMatchObject({
      aggregateRecoveryCounts: true,
      typedAffectedSheetChanges: [
        'hit-points', 'injury', 'conditions', 'daily-moves', 'trainer-ap', 'daily-resources',
      ],
      safeAppRelativeSheetHandoffs: true,
      postflightUsesAcceptedResult: true,
      remainingAttentionReloadsWholeDashboard: true,
    })
  })

  it('pins fail-closed retained-command recovery and privacy boundaries', () => {
    expect(contract.recovery).toEqual({
      strictPendingStorageSchema: true,
      explicitConfirmationRequired: true,
      mutationStartsOnlyFromReadyBoundary: true,
      unknownOutcomeRetainsExactCommand: true,
      reconnectNeverAutomaticallyReplays: true,
      acceptedStatusCheckIsExplicit: true,
      crossTabRetainedCommandLossFailsClosed: true,
      delayedResponsesAreGenerationGuarded: true,
      offlineCheckAndCommitDisabled: true,
      staleAuthorityRequiresFreshReview: true,
    })
    expect(contract.privacy).toMatchObject({
      preflightIdentityRendered: false,
      operationOrRequestIdentityRendered: false,
      profileIdentityOrDisplayNameRendered: false,
      eggIdentityRendered: false,
      sourceEventRevisionHashOrProvenanceRendered: false,
      privateTreatmentEvidenceRendered: false,
      canonicalChoiceListsRendered: false,
    })
    expect(contract.failClosed).toEqual(expect.arrayContaining([
      'unknown-command-or-projection-field', 'non-gm-role', 'authority-collection-overflow',
      'changed-preflight-authority', 'changed-clock-sheet-map-or-egg-revision',
      'cross-tab-command-loss', 'offline-commit', 'uncertain-result-without-status-check',
    ]))
  })

  it('pins the complete settlement-to-next-scene certification chain and visual acceptance', () => {
    expect(contract.continuationJourney).toEqual([
      'atomic-encounter-settlement', 'authoritative-decisions', 'authoritative-treatment',
      'reviewed-next-day', 'fresh-remaining-attention', 'next-scene-from-current-authority',
    ])
    expect(contract.accessibilityAndDesign).toMatchObject({
      selectedMockupScore: '9/10', generatedPortraitsImplemented: false,
      nativeModalFocusContainment: true, escapeAndCloseReturnOriginFocus: true,
      minimumControlPixels: 44, mobileMinimumWidthPixels: 320,
      pageHorizontalOverflow: false, seriousOrCriticalAxeViolations: 0,
    })
  })

  it('pins every runtime, test, document, journey, and local UI artifact reference', () => {
    for (const source of Object.values(contract.sources)) {
      expect(source.sha256, source.path).toMatch(/^[a-f0-9]{64}$/)
      const bytes = isLocalUiArtifactPath(source.path)
        ? readOptionalLocalUiArtifact(process.cwd(), source.path)
        : readFileSync(source.path)
      if (bytes) expect(sha256(bytes), source.path).toBe(source.sha256)
    }
  })
})
