import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/final-privacy-role-projection-certification.v1.json'
import inventory from '../../data/deferred-closure/closure-inventory.v1.json'
import skillCheck from '../../data/deferred-closure/skill-check-projection-certification.v1.json'
import trainerParticipant from '../../data/deferred-closure/trainer-participant-projection-certification.v1.json'
import battleLiveplay from '../../data/deferred-closure/battle-contest-liveplay-certification.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const source = (path: string): string => readFileSync(path, 'utf8')
const verify = (row: { path: string, sha256: string }): void => {
  expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(repositoryFileSha256(row.path))
}
const userFacingRows = inventory.rows.map(row => row.id).filter(id => (
  id.startsWith('weapon-profile.')
  || id.startsWith('weapon-move.')
  || id.startsWith('item-action.')
  || id === 'runtime.generic-skill-check'
  || id.startsWith('contest-variant.')
)).sort()

describe('P11-086 final privacy and role-projection certification', () => {
  it('partitions all 27 user-facing mechanics across five audited cohorts and six projection families', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-final-privacy-role-projections-v1',
      ticket: 'P11-086',
      status: 'certified',
      runtimeProseParsing: false,
      clientRedactionAuthorities: 0,
    })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    const auditedRows = certification.cohorts.flatMap(row => row.mechanicRowIds)
    expect(new Set(auditedRows).size).toBe(auditedRows.length)
    expect([...auditedRows].sort()).toEqual(userFacingRows)
    expect(auditedRows).toHaveLength(27)
    expect(certification.projectionFamilies.map(row => row.familyId)).toEqual([
      'encounter-action-offers',
      'equipment-action-lifecycle',
      'generic-skill-checks',
      'trainer-participant-contests',
      'battle-contest-joined-liveplay',
      'realtime-invalidation-events',
    ])
    for (const family of certification.projectionFamilies) {
      expect(family.strictServerProjection, family.familyId).toBe(true)
      expect(family.privateAuthorityLeaks, family.familyId).toBe(0)
      expect(family.executableEvidence.length, family.familyId).toBeGreaterThan(0)
    }
  })

  it('retains the focused Skill Check, paired Contest, and joined Battle privacy guarantees', () => {
    expect(skillCheck.privacy).toMatchObject({
      gmProjectionFullAuthority: true,
      subjectOtherIdentityOrResultProjected: false,
      spectatorPromptOrSubjectIdentityProjected: false,
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
    expect(trainerParticipant.acceptance).toMatchObject({
      publicSheetSlugs: 0,
      publicProviderLists: 0,
      publicDicePools: 0,
      ownerOpponentPrivateSnapshots: 0,
      gmCurrentLegalAuthority: true,
    })
    expect(battleLiveplay.acceptance).toMatchObject({
      gmVisibleTeamPools: 2,
      actingOwnerVisibleTeamPools: 1,
      opposingOwnerVisibleTeamPools: 1,
      publicVisibleTeamPools: 0,
      ownerOpponentTeamPools: 0,
      publicPrivateAuthorityFields: 0,
    })
    expect(certification.fieldAudit).toEqual({
      nonGmGmNotes: 0,
      nonGmDiagnostics: 0,
      publicSheetSlugs: 0,
      publicProfileIds: 0,
      publicProviderLists: 0,
      publicDicePoolsOrJournals: 0,
      publicOperationIdsOrSourceHashes: 0,
      publicPlacementsOrHandoffReceipts: 0,
      publicCombinedSettlementAuthority: 0,
      ownerOpponentSnapshots: 0,
      ownerOpponentPools: 0,
      realtimePrivatePayloadFields: 0,
    })
  })

  it('keeps structural role boundaries in production projection builders and strict parsers', () => {
    const encounter = source('server/domain/encounterPresentation/buildProjection.ts')
    expect(encounter).toContain('actorControlledMapPlacementIds')
    expect(encounter).toContain("input.role === 'gm'")
    expect(encounter).toContain("? 'responder-owner'")

    const equipment = source('server/domain/itemAutomation/equipmentActionPresentation.ts')
    expect(equipment).toContain('Exact custody and GM evidence remain absent.')
    expect(equipment).toContain("projection: 'public'")

    const checks = source('shared/skillChecks/projections.ts')
    expect(checks).toContain("readonly audience: 'gm'")
    expect(checks).toContain("readonly audience: 'subject'")
    expect(checks).toContain("readonly audience: 'spectator'")
    expect(checks).toContain('const exact = (value: Record<string, unknown>')

    const contests = source('shared/contests/projections.ts')
    expect(contests).toContain('export const projectContestPublic')
    expect(contests).toContain('export const projectContestOwner')
    expect(contests).toContain('export const projectContestGm')
    expect(contests).toContain('export const projectContestDiagnostic')
    expect(contests).toContain("row.visibility === 'owner' &&")

    const battle = source('server/useCases/battleContestLiveplay.ts')
    expect(battle).toContain("const audienceFor = (document: ContestDocumentV1, actor: ContestActorV1): 'gm' | 'owner' | 'public'")
    expect(battle).toContain("audience === 'gm'")
    expect(battle).toContain("audience === 'owner' && controlled ? [sanitizedPool(controlled)] : []")

    const realtime = source('server/realtime/contestRealtime.ts')
    expect(realtime).toContain('const payload = (document: ContestDocumentV1')
    expect(realtime).toContain('audience: input.audience, changedAt: input.changedAt')
    for (const privateField of ['gmNotes:', 'contestants:', 'diceJournal:', 'battleHandoffReceipts:']) {
      expect(realtime).not.toContain(privateField)
    }
  })

  it('hash-binds every current projection authority and executable no-leak check', () => {
    for (const row of certification.authorities) verify(row)
    for (const row of certification.evidence) verify(row)
    const paths = new Set([...certification.authorities, ...certification.evidence].map(row => row.path))
    for (const path of [
      'server/domain/encounterPresentation/buildProjection.ts',
      'server/domain/itemAutomation/equipmentActionPresentation.ts',
      'shared/skillChecks/projections.ts',
      'shared/contests/projections.ts',
      'server/useCases/battleContestLiveplay.ts',
      'server/realtime/contestRealtime.ts',
      'tests/server/encounterPresentationProjection.test.ts',
      'tests/server/equipmentGrantProjection.test.ts',
      'tests/server/equipmentActionPresentation.test.ts',
      'tests/server/skillCheckProjections.test.ts',
      'tests/server/skillCheckProjectionRoute.test.ts',
      'tests/server/contestTrainerParticipantRuntime.test.ts',
      'tests/server/contestTrainerParticipantVoltageRuntime.test.ts',
      'tests/server/contestBattleAcceptedMoveAppealsRuntime.test.ts',
      'tests/server/contestRealtimePrivacy.test.ts',
      'tests/components/contestBattleJoinedLiveplay.test.ts',
      'tests/data/deferredClosurePrivacyCertification.test.ts',
      'package.json',
    ]) expect(paths.has(path), path).toBe(true)
    expect(certification.acceptance).toEqual({
      auditedMechanicRows: 27,
      auditedCohorts: 5,
      projectionFamilies: 6,
      privacyLeaks: 0,
      crossRoleParserForgeriesAccepted: 0,
      clientRedactionAuthorities: 0,
      hardFailures: 0,
      nextTicket: 'P11-087',
    })
  })
})
