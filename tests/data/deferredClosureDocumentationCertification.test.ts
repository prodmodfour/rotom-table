import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/final-documentation-certification.v1.json'
import inventory from '../../data/deferred-closure/closure-inventory.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const read = (path: string): string => readFileSync(path, 'utf8')
const verify = (row: { path: string, sha256: string }): void => {
  expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(repositoryFileSha256(row.path))
}
const userFacingRows = inventory.rows.filter(row => (
  row.id.startsWith('weapon-profile.')
  || row.id.startsWith('weapon-move.')
  || row.id.startsWith('item-action.')
  || row.id === 'runtime.generic-skill-check'
  || row.id.startsWith('contest-variant.')
))

describe('P11-087 final documentation certification', () => {
  it('binds current contributor, operator, GM, and player entry points for every closed surface', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      certificationId: 'deferred-closure-final-documentation-v1',
      ticket: 'P11-087',
      status: 'certified',
      runtimeProseParsing: false,
    })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    expect(certification.audiences).toEqual({
      contributor: { path: 'docs/complete-play-loop-contributor-guide.md', status: 'current' },
      operator: { path: 'docs/complete-play-loop-operator-guide.md', status: 'current' },
      gm: { path: 'docs/complete-play-loop-gm-guide.md', status: 'current' },
      player: { path: 'docs/complete-play-loop-player-guide.md', status: 'current' },
    })
    expect(userFacingRows).toHaveLength(27)
    expect(certification.surfaceCoverage).toEqual({
      rangedWeaponProfiles: 6,
      supplementalWeaponMoves: 12,
      itemActions: 11,
      genericSkillCheckSurfaces: 1,
      trainerParticipantVariants: 1,
      battleContestVariants: 1,
      userFacingMechanicRows: 27,
    })
  })

  it('records current storage, liveplay, privacy, recovery, and no-prose claims', () => {
    expect(certification.claims).toEqual({
      currentStorageSchema: 50,
      liveplayOnly: true,
      appOwnedRuntimeReferencesOnly: true,
      runtimeProseParsing: false,
      browserOwnedRollsOrResults: false,
      directStorageRepair: false,
      exactRetryRequired: true,
      postCommitRealtime: true,
      linkedBattleIndependentFinishEncounter: false,
      roleSafeServerProjections: true,
      frozenHistoryUsesAcceptedSuccessors: true,
    })
    expect(certification.staleLanguageAudit).toEqual({
      scannedScope: 'current-non-archived-documentation',
      stalePlan11DeferralClaims: 0,
      stalePlan8TicketPointers: 0,
      staleContestUnavailabilityClaims: 0,
      staleSchema44CurrentClaims: 0,
      technicalDeferredTransactionTermsAllowed: true,
    })
    expect(certification.linkAndCommandAudit).toEqual({
      scopedBrokenLocalLinks: 0,
      undocumentedClaimedNpmScripts: 0,
      documentationGateRegistered: true,
    })
  })

  it('hash-binds current guides and executable link, claim, and historical-successor checks', () => {
    for (const row of certification.authorities) verify(row)
    for (const row of certification.evidence) verify(row)
    const paths = new Set([...certification.authorities, ...certification.evidence].map(row => row.path))
    for (const path of [
      'docs/deferred-mechanics-closure.md',
      'docs/complete-play-loop-contributor-guide.md',
      'docs/complete-play-loop-operator-guide.md',
      'docs/complete-play-loop-gm-guide.md',
      'docs/complete-play-loop-player-guide.md',
      'docs/skill-check-recovery-and-campaign-history.md',
      'docs/contests/player-and-gm-guide.md',
      'docs/contests/trainer-participant-runtime.md',
      'docs/contests/battle-contest-runtime.md',
      'docs/adrs/019-authoritative-pokemon-contest-runtime.md',
      'tests/docs/deferredMechanicsDocumentationClosure.test.ts',
      'tests/data/completePlayLoopDocumentationClosure.test.ts',
      'tests/data/deferredClosureDocumentationCertification.test.ts',
      'package.json',
    ]) expect(paths.has(path), path).toBe(true)
    expect(read('package.json')).toContain('check:deferred-closure-docs')
  })

  it('records zero documentation debt and advances only to drift closure', () => {
    expect(certification.acceptance).toEqual({
      documentedMechanicRows: 27,
      documentedAudiences: 4,
      brokenLocalLinks: 0,
      staleDeferralClaims: 0,
      staleTicketPointers: 0,
      unregisteredCommandClaims: 0,
      hardFailures: 0,
      nextTicket: 'P11-088',
    })
  })
})
