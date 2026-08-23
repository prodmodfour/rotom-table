import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/skill-check-subject-workflow-certification.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const requiredScenarios = new Set([
  'controlled-subject-only-projection',
  'skill-and-visible-modifier-transparency',
  'private-field-and-forged-projection-rejection',
  'group-acceptance-to-ready',
  'exact-response-replay-without-time',
  'gm-npc-subject-authority',
  'durable-legal-decline',
  'unauthorized-stale-expired-and-skill-conflicts',
  'operation-and-principal-conflicts',
  'response-transaction-rollback',
  'server-timeout-after-decline',
  'timeout-transaction-rollback',
  'own-accepted-result-and-dc-disclosure',
  'resolved-player-profile-read',
  'gm-subject-read-without-profile-spoofing',
  'bounded-query-rejection',
  'strict-player-and-gm-response-envelopes',
  'forged-dice-and-role-authority-rejection',
  'authority-free-expiry-trigger',
  'subject-prompt-modifier-and-concealed-dc-presentation',
  'no-roll-input-and-private-field-absence',
  'opaque-accept-and-exact-retry',
  'authorized-decline-control',
  'visible-or-withheld-own-result',
  'stale-expired-and-blocked-presentation',
  'frozen-finish-encounter-ui-authority-preserved-by-contiguous-successors',
])

describe('P11-048 Skill Check subject workflow certification', () => {
  it('binds the predecessor, every authority, and every evidence suite through accepted bytes', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-skill-check-subject-workflow-v1',
      ticket: 'P11-048',
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

  it('certifies every prompted, accepted, declined, timed-out, role, retry, and rollback scenario', () => {
    expect(new Set(certification.evidence.flatMap(evidence => evidence.scenarioIds))).toEqual(requiredScenarios)
    expect(certification.acceptance).toEqual({
      prompted: true,
      accepted: true,
      declinedWhereCurrentAndPending: true,
      timedOut: true,
      trainerAndPokemon: true,
      playerAndGmSubjectAuthority: true,
      modifierTransparency: true,
      serverRollOnly: true,
      durableReceipts: true,
      exactRetry: true,
      atomicWrites: true,
      roleProjectionExpansionDeferredTo: 'P11-049',
    })
  })

  it('records an allowlist that excludes every private GM, controller, sheet, dice, and operation field', () => {
    expect(certification.privacy).toEqual({
      gmNotesProjected: false,
      situationalModifierValueProjected: false,
      controllerProfileIdsProjected: false,
      sheetRevisionProjected: false,
      otherSubjectIdentitiesProjected: false,
      diceJournalsProjected: false,
      operationHashesProjected: false,
      ownVisibleContributorsProjected: true,
      privateGmAdjustmentPresenceOnly: true,
      ownAuthorizedResultOnly: true,
    })
  })
})
