import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/skill-check-projection-certification.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const requiredScenarios = new Set([
  'three-structurally-distinct-pending-projections',
  'private-modifier-note-controller-sheet-journal-and-operation-absence',
  'authorized-own-and-aggregate-public-accepted-results',
  'gm-only-result-and-dc-withholding',
  'cross-role-forgery-and-private-field-rejection',
  'authenticated-role-to-projection-authority',
  'profile-spoof-unknown-state-and-limit-rejection',
  'public-pending-count-and-generic-history',
  'aggregate-withheld-cancelled-and-timeout-presentation',
  'labeled-refresh-and-load-alert',
  'subject-history-and-own-result-presentation',
  'private-field-absence-at-decision-surface',
  'reviewed-spectator-event-feed-target-state',
])

describe('P11-049 Skill Check projection and privacy certification', () => {
  it('binds its predecessor, role authorities, evidence, and reviewed target image to accepted bytes', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-skill-check-projections-v1',
      ticket: 'P11-049',
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
  })

  it('certifies every structural, pending, accepted, history, route, privacy, and presentation scenario', () => {
    expect(new Set(certification.evidence.flatMap(evidence => evidence.scenarioIds))).toEqual(requiredScenarios)
    expect(certification.acceptance).toEqual({
      pendingGmSubjectAndSpectator: true,
      acceptedGmSubjectAndSpectator: true,
      cancelledAndTimedOutHistory: true,
      dcConcealment: true,
      publicAggregateResults: true,
      gmOnlyResultWithholding: true,
      strictStructuralSeparation: true,
      serverBuiltOnly: true,
      publicLiveplayFeed: true,
      remainingConsumingFlowIntegrationTicket: 'P11-050',
      remainingFinalAccessibilityTicket: 'P11-051',
      remainingRecoveryAndCampaignHistoryTicket: 'P11-052',
    })
  })

  it('records a fail-closed allowlist with full authority only in the GM projection', () => {
    expect(certification.privacy).toEqual({
      gmProjectionFullAuthority: true,
      subjectOwnIdentitySkillAndVisibleModifiersOnly: true,
      subjectOtherIdentityOrResultProjected: false,
      spectatorPromptOrSubjectIdentityProjected: false,
      spectatorPendingCountProjected: true,
      spectatorAcceptedAggregateOnlyWhenPublic: true,
      withheldStateExplicit: true,
      gmNotesProjectedOutsideGm: false,
      situationalModifierValueProjectedOutsideGm: false,
      controllerProfileIdsProjectedOutsideGm: false,
      sheetRevisionsProjectedOutsideGm: false,
      diceJournalsProjectedOutsideGm: false,
      operationIdsOrHashesProjectedOutsideGm: false,
      diagnosticsProjectedOutsideGm: false,
      responseIdentityProjectedToSpectator: false,
      privateCorrectionProjectedToSpectator: false,
    })
  })
})
