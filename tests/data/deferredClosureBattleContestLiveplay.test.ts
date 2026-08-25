import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/battle-contest-liveplay-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { contestVariantIsNative } from '../../shared/contests/catalog'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const verifyBound = (row: { path: string, sha256: string }): void => {
  expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(repositoryFileSha256(row.path))
}

describe('P11-078 joined Battle Contest liveplay certification', () => {
  it('continues from atomic settlement and hash-binds the joined contract, coordinator, command gate, UI, documentation, and evidence', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      ticket: 'P11-078',
      status: 'certified',
      runtimeProseParsing: false,
    })
    expect(certification.predecessor.sha256).toBe(repositoryFileSha256(certification.predecessor.path))
    verifyBound(certification.canonicalVariantAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
    verifyBound(certification.designEvidence.flow)
    for (const frame of certification.designEvidence.frames) verifyBound(frame)
    verifyBound(certification.designEvidence.continuityReview)
    verifyBound(certification.designEvidence.contactSheet)
    for (const screenshot of certification.liveplayEvidence.screenshots) verifyBound(screenshot)
    verifyBound(certification.liveplayEvidence.review)
  })

  it('certifies one Encounter cockpit, role-safe blocking decisions, exact convergence, responsive accessibility, and structured status', () => {
    expect(contests.variants.find(row => row.id === 'battle')).toMatchObject({ completionState: 'native' })
    expect(contestVariantIsNative('battle')).toBe(true)
    expect(certification.acceptance).toEqual({
      encounterCockpits: 1,
      battleEnginesAdded: 0,
      contestScoringEnginesAdded: 0,
      trainerTeams: 2,
      declaredPokemonVoltageRows: 6,
      deployedInitiativeParticipants: 4,
      readyReservePokemon: 4,
      maximumTeamDiceSpendPerAppeal: 3,
      gmVisibleTeamPools: 2,
      actingOwnerVisibleTeamPools: 1,
      opposingOwnerVisibleTeamPools: 1,
      publicVisibleTeamPools: 0,
      ownerOpponentTeamPools: 0,
      ordinaryEncounterCommandsWhilePending: 0,
      exactRetryAdditionalRolls: 0,
      exactRetryAdditionalContestDiceSpent: 0,
      exactRetryAdditionalAppeals: 0,
      exactRetryAdditionalContestRevisions: 0,
      exactRetryAdditionalRealtimeRows: 0,
      publicPrivateAuthorityFields: 0,
      joinedProjectionSamplesWithinBudget: 100,
      joinedProjectionBudgetMilliseconds: 250,
      narrowViewportWidths: [320, 390],
      seriousOrCriticalAxeViolations: 0,
      hardVisualFailures: 0,
      productionLiveplayJourneys: 1,
      variantCompletionState: 'structured',
      nextTicket: 'P11-079',
    })
    expect(certification.liveplayEvidence).toMatchObject({
      mode: 'production-liveplay',
      project: 'chromium',
      status: 'passed',
      seriousOrCriticalAxeViolations: 0,
      publicPrivateAuthorityLeaks: 0,
    })
    expect(certification.designEvidence).toMatchObject({
      workflow: 'ui-design-workflow-storyboard',
      continuityReview: { status: 'accepted', hardFailures: 0 },
    })
  })

  it('keeps handoff discovery read-only and delegates every consequence to existing authorities', () => {
    const discovery = readFileSync('server/domain/contests/battleLiveplay.ts', 'utf8')
    const coordinator = readFileSync('server/useCases/battleContestLiveplay.ts', 'utf8')
    expect(discovery).not.toMatch(/\.replace\(|\.save\(|withTransaction|scoreContestAppealResults/u)
    expect(coordinator).toContain('scoreBattleContestAcceptedMoveUseCase')
    expect(coordinator).toContain('applyBattleContestVoltageLifecycleUseCase')
    expect(coordinator).toContain('endBattleContestUseCase')
    expect(coordinator).not.toContain('scoreContestAppealResults')
  })
})
