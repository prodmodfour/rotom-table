import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/skill-check-recovery-certification.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const requiredScenarios = new Set([
  'single-real-sqlite-restart-reconnect-exact-replay-no-reroll-or-republication',
  'group-concurrent-stale-cas-rejection-reconnect-and-convergence',
  'single-request-and-group-response-resolution-two-boundary-rollback',
  'unresolved-owner-gm-attention-to-terminal-private-safe-history',
  'transient-attention-publication-failure-preserves-committed-command',
  'fresh-and-upgraded-storage-authority',
  'cas-operation-conflict-and-corruption-refusal',
  'file-close-reopen-document-and-operation-preservation',
  'server-roll-exact-replay-without-entropy',
  'single-group-opposed-authority',
  'stale-before-roll-and-two-boundary-resolution-rollback',
  'request-resolve-cancel-exact-replay',
  'stale-and-principal-conflict-no-write',
  'request-and-cancel-two-boundary-rollback',
  'group-response-convergence-and-exact-replay',
  'stale-expired-sheet-and-principal-conflict-no-write',
  'response-and-timeout-two-boundary-rollback',
  'pending-gm-and-exact-controller-owner-attention',
  'ready-or-declined-urgent-gm-review',
  'exact-owner-projection-and-profile-identity-redaction',
  'terminal-removal-and-incomplete-duplicate-over-limit-refusal',
  'newest-owner-safe-resolved-cancelled-timed-out-history',
  'unrelated-controller-and-private-authority-absence',
  'gm-only-outcome-withholding-and-generic-gm-resolution',
  'bounded-strict-cross-shape-rejection',
  'gm-or-exact-owner-route-authority',
  'missing-profile-spoof-extra-query-and-limit-rejection',
  'four-row-bounded-owner-safe-terminal-presentation',
  'explicit-history-expansion-and-live-encounter-action',
  'focus-stable-malformed-refresh-with-retained-complete-history',
  'profile-required-and-generic-gm-empty-state',
  'skill-check-response-copy-and-open-live-encounter-action',
  'reviewed-campaign-skill-check-history-target-state',
])

describe('P11-052 Skill Check recovery, concurrency, attention, and history certification', () => {
  it('binds the final Skill Check predecessor, runtime authorities, test evidence, and reviewed target image', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-skill-check-recovery-history-v1',
      ticket: 'P11-052',
      status: 'certified',
      runtimeProseParsing: false,
    })
    expect(acceptedSuccessorHead(certification.predecessor.path, certification.predecessor.sha256))
      .toBe(repositoryFileSha256(certification.predecessor.path))
    for (const authority of certification.authorities) {
      expect(acceptedSuccessorHead(authority.path, authority.sha256), authority.id)
        .toBe(repositoryFileSha256(authority.path))
      expect(authority.guarantees.length).toBeGreaterThan(0)
    }
    for (const evidence of certification.evidence) {
      expect(acceptedSuccessorHead(evidence.path, evidence.sha256), evidence.path)
        .toBe(repositoryFileSha256(evidence.path))
      expect(evidence.scenarioIds.length).toBeGreaterThan(0)
    }
    expect(new Set(certification.evidence.flatMap(evidence => evidence.scenarioIds))).toEqual(requiredScenarios)
  })

  it('certifies real restart, reconnect, duplicate, concurrency, stale, rollback, and transient publication recovery', () => {
    expect(certification.recoveryAcceptance).toEqual({
      singleReconnect: true,
      groupReconnect: true,
      realSqliteCloseReopen: true,
      duplicateDeliveryExactReceipt: true,
      duplicateRolls: 0,
      duplicateOperations: 0,
      duplicateAttentionInvalidations: 0,
      staleRevisionWrites: 0,
      documentBoundaryRollback: true,
      operationBoundaryRollback: true,
      rollbackAttentionInvalidations: 0,
      transientAttentionFailureChangesCommit: false,
    })
    expect(certification.acceptance).toEqual({
      singleAndGroupRecovery: true,
      concurrency: true,
      duplicateDelivery: true,
      staleRevisionRefusal: true,
      atomicRollback: true,
      campaignAttention: true,
      campaignHistory: true,
      strictRolePrivacy: true,
      boundedAccessiblePresentation: true,
      genericSkillCheckSurfaceComplete: true,
      remainingSkillCheckTicket: null,
    })
  })

  it('keeps unresolved work in attention, terminal work in bounded history, and private authority absent', () => {
    expect(certification.historyAndAttentionAcceptance).toEqual({
      pendingOwnerResponseAttention: true,
      pendingGmObservation: true,
      readyOrDeclinedUrgentGmReview: true,
      terminalAttention: false,
      terminalCampaignHistory: true,
      historyInitialRows: 4,
      historyMaximumRows: 20,
      explicitExpansion: true,
      exactOwnerAuthority: true,
      genericGmOutcome: true,
      gmOnlyOwnerOutcomeWithheld: true,
      profileIdentityProjectedToOwner: false,
    })
    expect(certification.privacy).toEqual({
      gmNotesInOwnerHistory: false,
      situationalModifierInOwnerHistory: false,
      diceOrTotalsInOwnerHistory: false,
      controllerIdsInOwnerHistory: false,
      sheetSlugsOrRevisionsInOwnerHistory: false,
      subjectIdsInOwnerHistory: false,
      operationIdsOrHashesInOwnerHistory: false,
      otherSubjectIdentityOrResultInOwnerHistory: false,
      unrelatedCheckInOwnerHistory: false,
      withheldOutcomeExplicit: true,
    })
  })
})
