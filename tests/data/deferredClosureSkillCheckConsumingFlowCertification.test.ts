import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/skill-check-consuming-flow-certification.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const requiredScenarios = new Set([
  'all-three-rods-accepted-generic-check-link',
  'missing-and-unavailable-check-rejection',
  'pending-check-rejection',
  'wrong-skill-rejection',
  'predating-check-rejection',
  'one-check-one-fishing-settlement',
  'private-check-hook-and-note-projection',
  'exact-replay-with-linked-check',
  'terminal-rollback-with-linked-check',
  'legacy-integration-nonce-still-bound',
  'accepted-matching-check-selector',
  'hook-disabled-before-link',
  'server-total-and-outcome-label',
  'selected-check-intent-without-integration-nonce',
  'source-bound-integrated-and-retained-flow-matrix',
  'three-rod-integration-policy',
  'closure-review-and-private-terminal-boundary',
  'reviewed-fishing-check-link-target-state',
])

describe('P11-050 Skill Check consuming-flow certification', () => {
  it('binds its predecessor, authorities, evidence, and reviewed mockup through accepted bytes', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-skill-check-consuming-flows-v1',
      ticket: 'P11-050',
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
    }
  })

  it('certifies the complete integration, rejection, privacy, retry, rollback, policy, and presentation set', () => {
    expect(new Set(certification.evidence.flatMap(evidence => evidence.scenarioIds))).toEqual(requiredScenarios)
    expect(certification.acceptance).toEqual({
      oldRod: true,
      goodRod: true,
      superRod: true,
      acceptedGenericCheckRequired: true,
      exactActorSkillAndDeclarationBinding: true,
      oneUseLink: true,
      existingBespokeTransactionsPreserved: true,
      noNewDeferredFlow: true,
      remainingAccessibilityTicket: 'P11-051',
      remainingRecoveryAndHistoryTicket: 'P11-052',
    })
  })

  it('retains only the five reviewed atomic/document/activity families and records the no-leak boundary', () => {
    expect(certification.retainedBespokeFlows).toEqual([
      'first-aid-kit-medicine-healing',
      'move-embedded-skill-and-opposed-checks',
      'contest-stage-dice',
      'breeding-specific-check-ledgers',
      'route-lure-and-dowsing-exploration-rolls',
    ])
    expect(certification.privacy).toEqual({
      checkIdInOwnerOrPublicGuidedProjection: false,
      checkTotalOrOutcomeInOwnerOrPublicGuidedProjection: false,
      hookSpeciesLevelOrNoteInOwnerOrPublicProjection: false,
      exactActorSheetSlugOutsideGmResolution: false,
      acceptedCheckVisibleToGmSelector: true,
      privateTerminalCommandBindsCheckId: true,
    })
  })
})
