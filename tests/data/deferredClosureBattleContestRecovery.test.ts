import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/battle-contest-recovery-certification.v1.json'
import fixtures from '../../data/deferred-closure/failure-recovery-fixtures.v1.json'
import { contestVariantIsNative } from '../../shared/contests/catalog'
import { CONTEST_OPERATION_ATOMICITY } from '../../shared/contests/architecture'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verifyBound = (row: { path: string, sha256: string }): void => expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(sha256(row.path))

describe('P11-076 Battle Contest cross-engine recovery certification', () => {
  it('continues from P11-075 and hash-binds both document plans, the coordinator, pause gate, fixtures, documentation, and runtime evidence', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, ticket: 'P11-076', status: 'certified', runtimeProseParsing: false })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    verifyBound(certification.failureFixtureAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
  })

  it('preserves mirrored atomic recovery and all four dual-engine failure scenarios after native activation', () => {
    expect(certification.acceptance).toEqual({
      recoveryReceiptCopies: 2,
      contestRevisionDeltaPerRecovery: 1,
      encounterDocumentRevisionDeltaPerRecovery: 1,
      encounterMapWritesPerRecovery: 0,
      randomDrawsPerRecovery: 0,
      correctionRequiresBothPaused: true,
      newMapCommandsWhilePaused: 0,
      acceptedOperationRetriesWhilePaused: 'durable-result-without-replay',
      interruptedCommitContestWrites: 0,
      interruptedCommitEncounterWrites: 0,
      interruptedCommitOperationRows: 0,
      staleContestCode: 'battle-contest.contest-revision-stale',
      staleEncounterCode: 'battle-contest.encounter-revision-stale',
      orphanCode: 'battle-contest.recovery-orphaned',
      directRepairAllowed: false,
      publicRecoveryAuthorityFields: 0,
      variantCompletionState: 'structured',
      nextTicket: 'P11-077',
    })
    const fixturesById = new Map(fixtures.battleContestDualEngineFixtures.map(row => [row.scenarioId, row]))
    expect([...fixturesById.keys()]).toEqual(certification.failureFixtureAuthority.scenarioIds)
    expect(fixturesById.get('dual-engine-stale-contest')?.expected).toMatchObject({ validationCode: certification.acceptance.staleContestCode, writes: [], appealDelta: 0 })
    expect(fixturesById.get('dual-engine-stale-encounter')?.expected).toMatchObject({ validationCode: certification.acceptance.staleEncounterCode, writes: [], appealDelta: 0 })
    expect(fixturesById.get('dual-engine-duplicate-handoff')?.expected).toMatchObject({ exactRetry: true, appealApplications: 1, contestDiceSpend: 1, rollJournals: 1 })
    expect(fixturesById.get('dual-engine-interrupted-settlement')?.expected).toMatchObject({ contestRewards: 0, encounterRewards: 0, sheetWrites: 0, historyRows: 0 })
    for (const kind of ['set-paused', 'apply-correction', 'cancel-contest'] as const) expect(CONTEST_OPERATION_ATOMICITY[kind]).toMatchObject({
      atomicity: 'single-sqlite-transaction', exactRetry: true,
      readKinds: expect.arrayContaining(['contest-document', 'encounter-document', 'encounter-map', 'encounter-scene']),
      writeKinds: expect.arrayContaining(['contest-document', 'encounter-document']),
    })
    expect(contestVariantIsNative('battle')).toBe(true)
  })
})
