import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/battle-contest-settlement-certification.v1.json'
import fixtures from '../../data/deferred-closure/failure-recovery-fixtures.v1.json'
import contests from '../../data/reference/contests.json'
import reviewedMigration from '../../scripts/reviewed-data/deferred-closure-battle-contest-settlement.v1.json'
import { CONTEST_OPERATION_ATOMICITY } from '../../shared/contests/architecture'
import { battleContestVariant, contestVariantIsNative } from '../../shared/contests/catalog'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verifyBound = (row: { path: string, sha256: string }): void => expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(sha256(row.path))

describe('P11-077 Battle Contest settlement certification', () => {
  it('continues from P11-076 and hash-binds the reviewed policy, both settlement engines, coordinator, privacy, operations, documentation, and evidence', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, ticket: 'P11-077', status: 'certified', runtimeProseParsing: false })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    expect(certification.reviewedMigration.sha256).toBe(sha256(certification.reviewedMigration.path))
    expect(reviewedMigration).toMatchObject({ migrationId: 'deferred-closure:battle-contest-settlement:v1', ticket: 'P11-077', status: 'reviewed' })
    expect(acceptedSuccessorHead(reviewedMigration.target.path, reviewedMigration.target.afterSha256)).toBe(sha256(reviewedMigration.target.path))
    for (const source of reviewedMigration.sources) expect(source.sha256, source.path).toBe(sha256(source.path))
    verifyBound(certification.failureFixtureAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
  })

  it('preserves all-roster reward and exact-retry settlement certification after native activation', () => {
    const battle = contests.variants.find(row => row.id === 'battle')!
    expect(battle.settlementPolicy).toEqual(reviewedMigration.settlementPolicy)
    expect(battleContestVariant.settlementPolicy).toEqual(reviewedMigration.settlementPolicy)
    expect(certification.acceptance).toEqual({
      settlementEnginesReused: 2,
      newSettlementEngines: 0,
      contestants: 2,
      pokemonExperienceRecipientsPerTeamMinimum: 3,
      pokemonExperienceRecipientsPerTeamMaximum: 6,
      winningTeamRibbonRecipientsPerTeamMinimum: 3,
      winningTeamRibbonRecipientsPerTeamMaximum: 6,
      contestPlacementScore: 'appeal-points',
      independentEncounterSettlementAllowed: false,
      combinedSqliteTransactions: 1,
      contestRewardApplicationsPerAcceptedCommit: 1,
      encounterConsequenceApplicationsPerAcceptedCommit: 1,
      exactRetryAdditionalRewardApplications: 0,
      exactRetryAdditionalConsequenceApplications: 0,
      exactRetryAdditionalSheetWrites: 0,
      exactRetryAdditionalHistoryRows: 0,
      exactRetryAdditionalRealtimeRows: 0,
      interruptedCommitContestRewards: 0,
      interruptedCommitEncounterRewards: 0,
      interruptedCommitSheetWrites: 0,
      interruptedCommitHistoryRows: 0,
      publicCombinedAuthorityFields: 0,
      variantCompletionState: 'structured',
      nextTicket: 'P11-078',
    })
    expect(CONTEST_OPERATION_ATOMICITY['commit-settlement']).toMatchObject({
      atomicity: 'single-sqlite-transaction',
      exactRetry: true,
      readKinds: expect.arrayContaining(['contest-document', 'encounter-document', 'encounter-map', 'encounter-scene', 'encounter-settlement', 'trainer-sheet', 'pokemon-sheet', 'item-custody', 'group-inventory', 'campaign-clock']),
      writeKinds: expect.arrayContaining(['contest-document', 'encounter-document', 'encounter-map', 'encounter-settlement', 'trainer-sheet', 'pokemon-sheet', 'item-custody', 'group-inventory', 'campaign-history', 'campaign-attention']),
    })
    const interrupted = fixtures.battleContestDualEngineFixtures.find(row => row.scenarioId === certification.failureFixtureAuthority.scenarioId)
    expect(interrupted?.expected).toMatchObject({ contestRewards: 0, encounterRewards: 0, sheetWrites: 0, historyRows: 0 })
    expect(contestVariantIsNative('battle')).toBe(true)
  })
})
